import { PAGE_SIZE_DEFAULT, type AuditEventSummary } from '@susu/shared';
import type { Queryable } from '../db/types.js';
import type { Actor } from '../lib/actor.js';
import { branchScope, decodeCursor, iso, pageOf } from './scope.js';

/**
 * Newest first. Head office (SUPER_ADMIN, COMPLIANCE) sees everything, including company-level
 * events with no branch; a branch manager sees only their branches' events.
 */
export async function listAuditEvents(
  q: Queryable,
  actor: Actor,
  input: { entityKind?: string; entityId?: string; branchId?: string; cursor?: string | null; limit?: number },
): Promise<{ events: AuditEventSummary[]; nextCursor: string | null }> {
  const scope = branchScope(actor, input.branchId, ['SUPER_ADMIN', 'COMPLIANCE', 'BRANCH_MANAGER']);
  const limit = input.limit ?? PAGE_SIZE_DEFAULT;
  const after = decodeCursor(input.cursor);
  const result = await q.query<{
    id: number;
    at: Date;
    actor_uid: string;
    action: string;
    entity_kind: string;
    entity_id: string;
    channel: string;
    branch_id: string | null;
    data: Record<string, unknown>;
  }>(
    `select id, at, actor_uid, action, entity_kind, entity_id, channel, branch_id, data
       from audit_events
      where ($1::uuid[] is null or branch_id = any($1::uuid[]))
        and ($2::text is null or entity_kind = $2)
        and ($3::text is null or entity_id = $3)
        and ($4::bigint is null or id < $4)
      order by id desc
      limit $5`,
    [scope, input.entityKind ?? null, input.entityId ?? null, after ? Number(after.k) : null, limit + 1],
  );
  const page = pageOf(result.rows, limit, (r) => ({ k: String(r.id), id: String(r.id) }));
  return {
    events: page.items.map((r) => ({
      at: iso(r.at)!,
      actorUid: r.actor_uid,
      action: r.action,
      entityKind: r.entity_kind,
      entityId: r.entity_id,
      channel: r.channel,
      branchId: r.branch_id,
      data: r.data,
    })),
    nextCursor: page.nextCursor,
  };
}
