import {
  registerMemberRequestSchema,
  type ApproveMemberRequest,
  type CreateSusuProductRequest,
  type OpenSusuAccountRequest,
  type RegisterMemberRequest,
} from '@susu/shared';
import type { Queryable } from '../db/types.js';
import { ensureLedgerAccount } from '../ledger/accounts.js';
import type { Actor } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';
import { DomainError } from '../lib/errors.js';
import { requireBranch, requireRole } from '../lib/permissions.js';

const MEMBER_MAKERS = ['SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER', 'SUPERVISOR', 'AGENT'] as const;
const MEMBER_CHECKERS = ['SUPER_ADMIN', 'COMPLIANCE', 'BRANCH_MANAGER'] as const;

export async function registerMember(
  tx: Queryable,
  actor: Actor,
  raw: RegisterMemberRequest,
): Promise<{ memberId: string }> {
  const input = registerMemberRequestSchema.parse(raw);
  requireRole(actor, MEMBER_MAKERS);
  requireBranch(actor, input.branchId);

  const duplicate = await tx.query<{ id: string }>('select id from members where ghana_card_number = $1', [
    input.ghanaCardNumber,
  ]);
  if (duplicate.rows[0]) {
    throw new DomainError('CONFLICT', 'A member with this Ghana Card is already registered', {
      memberId: duplicate.rows[0].id,
    });
  }

  const created = await tx.query<{ id: string }>(
    `insert into members (branch_id, full_name, phone, ghana_card_number, date_of_birth, photo_paths, consent_at, created_by)
     values ($1, $2, $3, $4, $5, $6::text[], now(), $7) returning id`,
    [input.branchId, input.fullName, input.phone, input.ghanaCardNumber, input.dateOfBirth, input.photoPaths, actor.uid],
  );
  const memberId = created.rows[0]!.id;

  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'member.registered',
    entityKind: 'member',
    entityId: memberId,
    branchId: input.branchId,
    deviceId: actor.deviceId,
    channel: actor.channel,
    data: { fullName: input.fullName },
  });
  return { memberId };
}

/** Maker-checker: the person who registered a member cannot approve them (also database-enforced). */
export async function approveMember(tx: Queryable, actor: Actor, input: ApproveMemberRequest): Promise<void> {
  requireRole(actor, MEMBER_CHECKERS);

  const result = await tx.query<{ branch_id: string; status: string; created_by: string }>(
    'select branch_id, status, created_by from members where id = $1 for update',
    [input.memberId],
  );
  const member = result.rows[0];
  if (!member) throw new DomainError('MEMBER_NOT_FOUND', 'Member not found');
  requireBranch(actor, member.branch_id);
  if (member.created_by === actor.uid) {
    throw new DomainError('SELF_APPROVAL_FORBIDDEN', 'You registered this member, so someone else must approve them');
  }
  if (member.status !== 'PENDING_APPROVAL') {
    throw new DomainError('CONFLICT', `Member is ${member.status}, not awaiting approval`);
  }

  await tx.query(`update members set status = 'ACTIVE', approved_at = now(), approved_by = $2 where id = $1`, [
    input.memberId,
    actor.uid,
  ]);
  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'member.approved',
    entityKind: 'member',
    entityId: input.memberId,
    branchId: member.branch_id,
    channel: actor.channel,
  });
}

export async function createSusuProduct(
  tx: Queryable,
  actor: Actor,
  input: CreateSusuProductRequest,
): Promise<{ productId: string; version: number }> {
  requireRole(actor, ['SUPER_ADMIN']);
  const latest = await tx.query<{ version: number }>(
    'select max(version)::int as version from susu_products where code = $1',
    [input.code],
  );
  const version = (latest.rows[0]?.version ?? 0) + 1;
  if (version > 1) {
    await tx.query(`update susu_products set status = 'RETIRED' where code = $1 and status = 'ACTIVE'`, [input.code]);
  }
  const created = await tx.query<{ id: string }>(
    `insert into susu_products (code, version, name, frequency, created_by) values ($1, $2, $3, $4, $5) returning id`,
    [input.code, version, input.name, input.frequency, actor.uid],
  );
  const productId = created.rows[0]!.id;
  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'susu_product.created',
    entityKind: 'susu_product',
    entityId: productId,
    channel: actor.channel,
    data: { ...input, version },
  });
  return { productId, version };
}

export async function openSusuAccount(
  tx: Queryable,
  actor: Actor,
  input: OpenSusuAccountRequest,
): Promise<{ susuAccountId: string }> {
  requireRole(actor, ['SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER']);

  const memberResult = await tx.query<{ branch_id: string; status: string; full_name: string }>(
    'select branch_id, status, full_name from members where id = $1',
    [input.memberId],
  );
  const member = memberResult.rows[0];
  if (!member) throw new DomainError('MEMBER_NOT_FOUND', 'Member not found');
  requireBranch(actor, member.branch_id);
  if (member.status !== 'ACTIVE') throw new DomainError('MEMBER_NOT_ACTIVE', `Member is ${member.status}`);

  const product = await tx.query<{ status: string; code: string }>('select status, code from susu_products where id = $1', [
    input.productId,
  ]);
  if (!product.rows[0] || product.rows[0].status !== 'ACTIVE') {
    throw new DomainError('NOT_FOUND', 'Active Susu product not found');
  }

  const accountId = (await tx.query<{ id: string }>('select gen_random_uuid() as id')).rows[0]!.id;
  const ledgerAccountId = await ensureLedgerAccount(tx, {
    kind: 'MEMBER_SUSU',
    ownerId: accountId,
    branchId: member.branch_id,
    name: `${member.full_name} — ${product.rows[0].code}`,
  });

  await tx.query(
    `insert into susu_accounts (id, member_id, product_id, branch_id, ledger_account_id, opened_by)
     values ($1, $2, $3, $4, $5, $6)`,
    [accountId, input.memberId, input.productId, member.branch_id, ledgerAccountId, actor.uid],
  );
  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'susu_account.opened',
    entityKind: 'susu_account',
    entityId: accountId,
    branchId: member.branch_id,
    channel: actor.channel,
    data: { memberId: input.memberId, productId: input.productId },
  });
  return { susuAccountId: accountId };
}
