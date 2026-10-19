import type { Database, Queryable } from '../db/types.js';
import type { SmsProvider } from './providers.js';
import { renderSms, smsOutboxPayloadSchema } from './templates.js';

/** Give up after this many attempts (about 2 days with the backoff below) and open an exception. */
export const MAX_ATTEMPTS = 10;
/** How long a claimed row stays ours before another run may take it. */
export const LEASE_SECONDS = 120;

/** 1 min, 2, 4, 8 … capped at 6 hours. */
export function backoffSeconds(attempt: number): number {
  return Math.min(60 * 2 ** Math.max(0, attempt - 1), 6 * 60 * 60);
}

interface ClaimedRow {
  id: string;
  dedupe_key: string;
  payload: unknown;
  attempts: number;
}

export interface GaveUp {
  outboxId: string;
  dedupeKey: string;
  error: string;
}

export interface DispatchReport {
  claimed: number;
  sent: number;
  retrying: number;
  /** Rows that just became FAILED; the caller opens an exception for each. */
  gaveUp: GaveUp[];
}

/**
 * Claim due SMS rows (PENDING and due, or SENDING with an expired lease), send each through the
 * provider, and record the outcome. Each row's claim and outcome are separate short transactions,
 * so a slow provider never holds a database lock.
 */
export async function dispatchSmsOutbox(
  db: Database,
  provider: SmsProvider,
  options: { brand: string; limit?: number; dedupeKeys?: string[] },
): Promise<DispatchReport> {
  const limit = options.limit ?? 50;
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx.query<ClaimedRow>(
      `update outbox o
          set status = 'SENDING',
              attempts = o.attempts + 1,
              lease_until = now() + make_interval(secs => $2),
              provider = $3
        where o.id in (
          select id from outbox
           where kind = 'SMS'
             and ((status = 'PENDING' and next_attempt_at <= now()) or (status = 'SENDING' and lease_until < now()))
             and ($4::text[] is null or dedupe_key = any($4::text[]))
           order by next_attempt_at, id
           limit $1
           for update skip locked)
        returning o.id, o.dedupe_key, o.payload, o.attempts`,
      [limit, LEASE_SECONDS, provider.name, options.dedupeKeys ?? null],
    );
    return rows.rows;
  });

  const report: DispatchReport = { claimed: claimed.length, sent: 0, retrying: 0, gaveUp: [] };
  for (const row of claimed) {
    const parsed = smsOutboxPayloadSchema.safeParse(typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload);
    const result = parsed.success
      ? await provider
          .send({ to: parsed.data.to, text: renderSms(parsed.data, options.brand), reference: row.dedupe_key })
          .catch((error: unknown) => ({ ok: false as const, permanent: false, error: error instanceof Error ? error.message : String(error) }))
      : ({ ok: false as const, permanent: true, error: `invalid payload: ${parsed.error.issues[0]?.message ?? 'unknown'}` });

    if (result.ok) {
      await db.query(
        `update outbox set status = 'SENT', sent_at = now(), lease_until = null, last_error = null, provider_message_id = $2
          where id = $1 and status = 'SENDING'`,
        [row.id, result.providerMessageId],
      );
      report.sent += 1;
    } else if (result.permanent || row.attempts >= MAX_ATTEMPTS) {
      await db.query(
        `update outbox set status = 'FAILED', lease_until = null, last_error = $2 where id = $1 and status = 'SENDING'`,
        [row.id, result.error.slice(0, 1000)],
      );
      report.gaveUp.push({ outboxId: String(row.id), dedupeKey: row.dedupe_key, error: result.error });
    } else {
      await db.query(
        `update outbox set status = 'PENDING', lease_until = null, last_error = $2,
                next_attempt_at = now() + make_interval(secs => $3)
          where id = $1 and status = 'SENDING'`,
        [row.id, result.error.slice(0, 1000), backoffSeconds(row.attempts)],
      );
      report.retrying += 1;
    }
  }
  return report;
}

/** Counts for the head-office view and alerts. */
export async function outboxBacklog(q: Queryable): Promise<{ pending: number; failed: number; oldestPendingAt: string | null }> {
  const r = await q.query<{ pending: number; failed: number; oldest: Date | null }>(
    `select count(*) filter (where status in ('PENDING','SENDING'))::int as pending,
            count(*) filter (where status = 'FAILED')::int as failed,
            min(created_at) filter (where status in ('PENDING','SENDING')) as oldest
       from outbox where kind = 'SMS'`,
  );
  const row = r.rows[0]!;
  return { pending: row.pending, failed: row.failed, oldestPendingAt: row.oldest ? new Date(row.oldest).toISOString() : null };
}
