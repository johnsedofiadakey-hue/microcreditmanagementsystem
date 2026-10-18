import { isPesewas, type Channel } from '@susu/shared';
import type { Queryable } from '../db/types.js';
import { DomainError } from '../lib/errors.js';
import { sha256 } from '../lib/hash.js';

export type Side = 'DEBIT' | 'CREDIT';

export interface PostingLine {
  accountId: string;
  side: Side;
  amountPesewas: number;
}

export interface PostingRequest {
  /** Same key ⇒ same batch. Retries and duplicate syncs return the original posting. */
  idempotencyKey: string;
  kind: string;
  description: string;
  branchId: string | null;
  actorUid: string;
  /** Second person for maker-checker postings. Must differ from actorUid (database-enforced). */
  approvedBy?: string | null;
  deviceId?: string | null;
  channel: Channel;
  lines: PostingLine[];
  reversesBatchId?: string | null;
}

export interface PostingResult {
  batchId: string;
  postedAt: string;
  /** True when this call matched an earlier posting with the same idempotency key. */
  replayed: boolean;
}

interface LockedAccount {
  id: string;
  normal_side: Side;
  allow_negative: boolean;
  status: string;
  balance_pesewas: number;
}

function validateLines(lines: PostingLine[]): void {
  if (lines.length < 2) {
    throw new DomainError('INVALID_COMMAND', 'A journal batch needs at least two lines');
  }
  let debits = 0;
  let credits = 0;
  const seen = new Set<string>();
  for (const line of lines) {
    if (!isPesewas(line.amountPesewas) || line.amountPesewas === 0) {
      throw new DomainError('INVALID_COMMAND', `Invalid amount ${line.amountPesewas}`);
    }
    const key = `${line.accountId}:${line.side}`;
    if (seen.has(key)) {
      throw new DomainError('INVALID_COMMAND', `Account ${line.accountId} appears twice on the ${line.side} side`);
    }
    seen.add(key);
    if (line.side === 'DEBIT') debits += line.amountPesewas;
    else credits += line.amountPesewas;
  }
  if (debits !== credits) {
    throw new DomainError('INVALID_COMMAND', `Debits ${debits} do not equal credits ${credits}`);
  }
}

function requestHash(request: PostingRequest): string {
  return sha256({
    kind: request.kind,
    branchId: request.branchId,
    reversesBatchId: request.reversesBatchId ?? null,
    lines: [...request.lines]
      .map((l) => ({ a: l.accountId, s: l.side, p: l.amountPesewas }))
      .sort((x, y) => (x.a + x.s < y.a + y.s ? -1 : 1)),
  });
}

/**
 * The only way money moves. Must run inside a transaction opened by the caller, so the posting
 * commits or fails together with the business record that caused it (collection, payout, …).
 *
 * 1. Claim the idempotency key (a replay returns the original batch).
 * 2. Lock the affected balance rows in a fixed order (no deadlocks between concurrent postings).
 * 3. Reject if any non-negative account would go below zero.
 * 4. Append lines and move balances. The database re-checks that the batch balances at commit.
 */
export async function postJournal(tx: Queryable, request: PostingRequest): Promise<PostingResult> {
  validateLines(request.lines);
  const hash = requestHash(request);

  const inserted = await tx.query<{ id: string; posted_at: Date }>(
    `insert into journal_batches
       (idempotency_key, request_hash, kind, description, branch_id, actor_uid, approved_by, device_id, channel, reverses_batch_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (idempotency_key) do nothing
     returning id, posted_at`,
    [
      request.idempotencyKey,
      hash,
      request.kind,
      request.description,
      request.branchId,
      request.actorUid,
      request.approvedBy ?? null,
      request.deviceId ?? null,
      request.channel,
      request.reversesBatchId ?? null,
    ],
  );

  if (!inserted.rows[0]) {
    const existing = await tx.query<{ id: string; posted_at: Date; request_hash: string }>(
      'select id, posted_at, request_hash from journal_batches where idempotency_key = $1',
      [request.idempotencyKey],
    );
    const row = existing.rows[0];
    if (!row) throw new Error(`Idempotency key ${request.idempotencyKey} conflicted but no batch was found`);
    if (row.request_hash !== hash) {
      throw new DomainError(
        'IDEMPOTENCY_CONFLICT',
        'This request ID was already used for a different posting',
        { batchId: row.id },
      );
    }
    return { batchId: row.id, postedAt: new Date(row.posted_at).toISOString(), replayed: true };
  }

  const batch = inserted.rows[0];
  const accountIds = [...new Set(request.lines.map((l) => l.accountId))].sort();

  const locked = await tx.query<LockedAccount>(
    `select a.id, a.normal_side, a.allow_negative, a.status, b.balance_pesewas
       from ledger_accounts a
       join account_balances b on b.account_id = a.id
      where a.id = any($1::uuid[])
      order by a.id
        for update of b`,
    [accountIds],
  );
  const byId = new Map(locked.rows.map((row) => [row.id, row]));

  const deltas = new Map<string, number>();
  for (const line of request.lines) {
    const account = byId.get(line.accountId);
    if (!account) throw new DomainError('ACCOUNT_NOT_FOUND', `Ledger account ${line.accountId} not found`);
    if (account.status !== 'ACTIVE' && !request.reversesBatchId) {
      throw new DomainError('ACCOUNT_NOT_ACTIVE', `Ledger account ${line.accountId} is ${account.status}`);
    }
    const signed = line.side === account.normal_side ? line.amountPesewas : -line.amountPesewas;
    deltas.set(line.accountId, (deltas.get(line.accountId) ?? 0) + signed);
  }

  for (const [accountId, delta] of deltas) {
    const account = byId.get(accountId)!;
    const next = account.balance_pesewas + delta;
    if (next < 0 && !account.allow_negative) {
      throw new DomainError('INSUFFICIENT_BALANCE', 'This would take the account below zero', {
        accountId,
        balancePesewas: account.balance_pesewas,
        requestedChangePesewas: delta,
      });
    }
  }

  const values: string[] = [];
  const params: unknown[] = [batch.id];
  request.lines.forEach((line, i) => {
    values.push(`($1, $${i * 3 + 2}, $${i * 3 + 3}, $${i * 3 + 4})`);
    params.push(line.accountId, line.side, line.amountPesewas);
  });
  await tx.query(
    `insert into journal_lines (batch_id, account_id, side, amount_pesewas) values ${values.join(', ')}`,
    params,
  );

  for (const [accountId, delta] of deltas) {
    await tx.query(
      `update account_balances
          set balance_pesewas = balance_pesewas + $2, version = version + 1, updated_at = now()
        where account_id = $1`,
      [accountId, delta],
    );
  }

  return { batchId: batch.id, postedAt: new Date(batch.posted_at).toISOString(), replayed: false };
}
