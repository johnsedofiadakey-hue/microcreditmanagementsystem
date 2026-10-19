import type { AuthClaims, CreateStaffUserRequest } from '@susu/shared';
import type { Database, Queryable } from '../db/types.js';
import type { Actor } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';
import { DomainError } from '../lib/errors.js';
import { requireBranch, requireRole } from '../lib/permissions.js';

/** The slice of Firebase Auth the staff flow needs; the callable passes the Admin SDK, tests pass a fake. */
export interface StaffAuth {
  /** Must throw `{ code: 'auth/email-already-exists' }` for a duplicate email, like the Admin SDK. */
  createUser(input: { email: string; displayName: string }): Promise<{ uid: string }>;
  deleteUser(uid: string): Promise<void>;
  setClaims(uid: string, claims: AuthClaims): Promise<void>;
  passwordSetupLink(email: string): Promise<string>;
}

/**
 * Every rule about who may create whom. Runs before anything is created, so a refused caller
 * learns nothing about which emails exist and leaves no Auth user behind.
 */
export async function authoriseStaffCreation(tx: Queryable, actor: Actor, input: CreateStaffUserRequest): Promise<void> {
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
}

/** Database half of creating a staff user: authorise again inside the write transaction, insert, audit. */
export async function recordStaffUser(
  tx: Queryable,
  actor: Actor,
  uid: string,
  input: CreateStaffUserRequest,
): Promise<void> {
  await authoriseStaffCreation(tx, actor, input);

  const clash = await tx.query('select 1 from staff_users where email = $1', [input.email.toLowerCase()]);
  if (clash.rowCount > 0) throw new DomainError('CONFLICT', 'A staff account with this email already exists');

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

/**
 * Authorise → create the Auth user → record in Postgres → set claims. If recording fails the Auth
 * user is deleted again, so nobody exists with a role the ledger doesn't know about.
 */
export async function createStaffUserFlow(
  db: Database,
  auth: StaffAuth,
  actor: Actor,
  input: CreateStaffUserRequest,
): Promise<{ uid: string; passwordSetupLink: string }> {
  await db.transaction((tx) => authoriseStaffCreation(tx, actor, input));

  let uid: string;
  try {
    ({ uid } = await auth.createUser({ email: input.email, displayName: input.displayName }));
  } catch (error) {
    if ((error as { code?: string }).code === 'auth/email-already-exists') {
      throw new DomainError('CONFLICT', 'A staff account with this email already exists');
    }
    throw error;
  }

  try {
    await db.transaction((tx) => recordStaffUser(tx, actor, uid, input));
  } catch (error) {
    await auth.deleteUser(uid).catch(() => undefined);
    throw error;
  }

  await auth.setClaims(uid, { role: input.role, branchIds: input.branchIds });
  return { uid, passwordSetupLink: await auth.passwordSetupLink(input.email) };
}

/**
 * Token claims can be up to an hour old. Every staff call also checks the live record: the person
 * must be ACTIVE and hold exactly the role and branches their token claims.
 */
export async function assertStaffActive(q: Queryable, actor: Actor): Promise<void> {
  const result = await q.query<{ role: string; branch_ids: string[]; status: string }>(
    'select role, branch_ids, status from staff_users where uid = $1',
    [actor.uid],
  );
  const row = result.rows[0];
  if (!row || row.status !== 'ACTIVE') {
    throw new DomainError('STAFF_NOT_ACTIVE', 'Your account is not active. Contact your administrator.');
  }
  const sameBranches =
    row.branch_ids.length === actor.claims.branchIds.length &&
    [...row.branch_ids].sort().every((id, i) => id === [...actor.claims.branchIds].sort()[i]);
  if (row.role !== actor.claims.role || !sameBranches) {
    throw new DomainError('STAFF_NOT_ACTIVE', 'Your access has changed. Sign out and sign in again.');
  }
}
