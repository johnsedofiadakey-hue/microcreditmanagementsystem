import type { ResolveCaseRequest, Role } from '@susu/shared';
import type { Queryable } from '../db/types.js';
import type { Actor } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';
import { DomainError } from '../lib/errors.js';
import { requireBranch, requireRole } from '../lib/permissions.js';

export const CASE_RESOLVERS: readonly Role[] = ['SUPER_ADMIN', 'FINANCE', 'COMPLIANCE', 'BRANCH_MANAGER'];

/**
 * Close a case with a written explanation. The money already moved when the case opened (variance
 * account); resolving records what happened. Never by the person who opened it.
 */
export async function resolveCase(tx: Queryable, actor: Actor, input: ResolveCaseRequest): Promise<void> {
  requireRole(actor, CASE_RESOLVERS);
  const found = (
    await tx.query<{ branch_id: string; status: string; opened_by: string; kind: string }>(
      'select branch_id, status, opened_by, kind from cases where id = $1 for update',
      [input.caseId],
    )
  ).rows[0];
  if (!found) throw new DomainError('NOT_FOUND', 'Case not found');
  requireBranch(actor, found.branch_id);
  if (found.status !== 'OPEN') throw new DomainError('CONFLICT', 'This case is already resolved');
  if (found.opened_by === actor.uid) {
    throw new DomainError('SELF_APPROVAL_FORBIDDEN', 'You opened this case, so a different person must resolve it');
  }
  await tx.query(`update cases set status = 'RESOLVED', resolved_by = $2, resolved_at = now(), resolution = $3 where id = $1`, [
    input.caseId,
    actor.uid,
    input.resolution,
  ]);
  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'case.resolved',
    entityKind: 'case',
    entityId: input.caseId,
    branchId: found.branch_id,
    channel: actor.channel,
    data: { kind: found.kind, resolution: input.resolution },
  });
}
