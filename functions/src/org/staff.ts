import type { CreateStaffUserRequest } from '@susu/shared';
import type { Queryable } from '../db/types.js';
import type { Actor } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';
import { DomainError } from '../lib/errors.js';
import { requireBranch, requireRole } from '../lib/permissions.js';

/**
 * Database half of creating a staff user. The callable creates the Firebase Auth user and sets
 * custom claims; this records the person, their role and branch scope, and audits it.
 */
export async function recordStaffUser(
  tx: Queryable,
  actor: Actor,
  uid: string,
  input: CreateStaffUserRequest,
): Promise<void> {
  requireRole(actor, ['SUPER_ADMIN', 'BRANCH_MANAGER']);

  if (actor.claims.role === 'BRANCH_MANAGER') {
    // Managers may add field and counter staff to their own branches only.
    if (!['CASHIER', 'SUPERVISOR', 'AGENT'].includes(input.role)) {
      throw new DomainError('NOT_PERMITTED', `A branch manager cannot create ${input.role} users`);
    }
    for (const branchId of input.branchIds) requireBranch(actor, branchId);
  }

  if (input.role === 'AGENT' && input.branchIds.length !== 1) {
    throw new DomainError('INVALID_COMMAND', 'An agent belongs to exactly one branch');
  }

  if (input.branchIds.length > 0) {
    const found = await tx.query<{ id: string }>('select id from branches where id = any($1::uuid[])', [input.branchIds]);
    if (found.rowCount !== new Set(input.branchIds).size) {
      throw new DomainError('NOT_FOUND', 'One or more branches do not exist');
    }
  }

  await tx.query(
    `insert into staff_users (uid, email, display_name, role, branch_ids, created_by)
     values ($1, $2, $3, $4, $5::uuid[], $6)`,
    [uid, input.email.toLowerCase(), input.displayName, input.role, input.branchIds, actor.uid],
  );

  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'staff.created',
    entityKind: 'staff_user',
    entityId: uid,
    channel: actor.channel,
    data: { role: input.role, branchIds: input.branchIds, email: input.email.toLowerCase() },
  });
}
