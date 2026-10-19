import {
  WITHDRAWAL_HEAD_OFFICE_THRESHOLD_PESEWAS,
  formatCedis,
  type DecideWithdrawalRequest,
  type RejectWithdrawalRequest,
  type RequestWithdrawalRequest,
  type Role,
  type WithdrawalStatus,
} from '@susu/shared';
import type { Queryable } from '../db/types.js';
import { postJournal } from '../ledger/post.js';
import type { Actor } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';
import { DomainError } from '../lib/errors.js';
import { requireBranch, requireRole } from '../lib/permissions.js';
import { assertDayOpen, lockBranch, lockedBalance, requireLedgerAccount, today } from './common.js';

/** Start a withdrawal for a member (the maker). Starting it moves no money. */
export const WITHDRAWAL_MAKERS: readonly Role[] = ['SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER', 'SUPERVISOR'];
/** May approve or reject; a BRANCH_MANAGER only up to WITHDRAWAL_HEAD_OFFICE_THRESHOLD_PESEWAS. */
export const WITHDRAWAL_CHECKERS: readonly Role[] = ['SUPER_ADMIN', 'FINANCE', 'BRANCH_MANAGER'];
const HEAD_OFFICE_CHECKERS: readonly Role[] = ['SUPER_ADMIN', 'FINANCE'];
/** Hand over the cash. Never the requester or the approver. */
export const WITHDRAWAL_PAYERS: readonly Role[] = ['CASHIER', 'BRANCH_MANAGER'];

interface LockedAccount {
  branch_id: string;
  member_id: string;
  status: string;
  member_status: string;
  full_name: string;
  phone: string;
  ledger_account_id: string;
}

async function lockAccount(tx: Queryable, susuAccountId: string): Promise<LockedAccount> {
  const result = await tx.query<LockedAccount>(
    `select s.branch_id, s.member_id, s.status, s.ledger_account_id, m.status as member_status, m.full_name, m.phone
       from susu_accounts s join members m on m.id = s.member_id
      where s.id = $1
      for update of s`,
    [susuAccountId],
  );
  const account = result.rows[0];
  if (!account) throw new DomainError('ACCOUNT_NOT_FOUND', 'Susu account not found');
  return account;
}

function assertPayable(account: LockedAccount): void {
  // RESTRICTED members can't withdraw until compliance resolves their case (BUILD_PLAN Step 8).
  if (account.member_status !== 'ACTIVE') throw new DomainError('MEMBER_NOT_ACTIVE', `Member is ${account.member_status}`);
  if (account.status !== 'ACTIVE') throw new DomainError('ACCOUNT_NOT_ACTIVE', `Susu account is ${account.status}`);
}

/** Balance minus withdrawals already requested or approved (but not yet paid) on the account. */
async function availablePesewas(tx: Queryable, account: LockedAccount, susuAccountId: string, excludeId?: string): Promise<number> {
  const balance = await lockedBalance(tx, account.ledger_account_id);
  const reserved = await tx.query<{ amount: number }>(
    `select coalesce(sum(amount_pesewas), 0)::bigint as amount from withdrawal_requests
      where susu_account_id = $1 and status in ('PENDING_APPROVAL', 'APPROVED') and ($2::uuid is null or id <> $2::uuid)`,
    [susuAccountId, excludeId ?? null],
  );
  return balance - reserved.rows[0]!.amount;
}

interface LockedRequest {
  id: string;
  branch_id: string;
  susu_account_id: string;
  amount_pesewas: number;
  needs_head_office: boolean;
  status: WithdrawalStatus;
  requested_by: string;
  decided_by: string | null;
}

async function lockRequest(tx: Queryable, withdrawalId: string): Promise<LockedRequest> {
  const result = await tx.query<LockedRequest>(
    `select id, branch_id, susu_account_id, amount_pesewas, needs_head_office, status, requested_by, decided_by
       from withdrawal_requests where id = $1 for update`,
    [withdrawalId],
  );
  const request = result.rows[0];
  if (!request) throw new DomainError('NOT_FOUND', 'Withdrawal request not found');
  return request;
}

export async function requestWithdrawal(
  tx: Queryable,
  actor: Actor,
  input: RequestWithdrawalRequest,
): Promise<{ withdrawalId: string; needsHeadOffice: boolean }> {
  requireRole(actor, WITHDRAWAL_MAKERS);
  const account = await lockAccount(tx, input.susuAccountId);
  requireBranch(actor, account.branch_id);
  assertPayable(account);

  const available = await availablePesewas(tx, account, input.susuAccountId);
  if (input.amountPesewas > available) {
    throw new DomainError('INSUFFICIENT_BALANCE', `Only ${formatCedis(Math.max(0, available))} is available to withdraw`, {
      availablePesewas: Math.max(0, available),
    });
  }

  const needsHeadOffice = input.amountPesewas > WITHDRAWAL_HEAD_OFFICE_THRESHOLD_PESEWAS;
  const created = await tx.query<{ id: string }>(
    `insert into withdrawal_requests (branch_id, member_id, susu_account_id, amount_pesewas, reason, needs_head_office, requested_by)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [account.branch_id, account.member_id, input.susuAccountId, input.amountPesewas, input.reason, needsHeadOffice, actor.uid],
  );
  const withdrawalId = created.rows[0]!.id;
  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'withdrawal.requested',
    entityKind: 'withdrawal',
    entityId: withdrawalId,
    branchId: account.branch_id,
    channel: actor.channel,
    data: { susuAccountId: input.susuAccountId, amountPesewas: input.amountPesewas, needsHeadOffice },
  });
  return { withdrawalId, needsHeadOffice };
}

/** The checker: not the maker, and head office for amounts above the threshold. */
function assertChecker(actor: Actor, request: LockedRequest, enforceLimit: boolean): void {
  requireRole(actor, WITHDRAWAL_CHECKERS);
  requireBranch(actor, request.branch_id);
  if (request.requested_by === actor.uid) {
    throw new DomainError('SELF_APPROVAL_FORBIDDEN', 'You requested this withdrawal, so a different person must decide it');
  }
  if (enforceLimit && request.needs_head_office && !HEAD_OFFICE_CHECKERS.includes(actor.claims.role)) {
    throw new DomainError(
      'APPROVAL_LIMIT_EXCEEDED',
      `Withdrawals above ${formatCedis(WITHDRAWAL_HEAD_OFFICE_THRESHOLD_PESEWAS)} need head-office approval`,
    );
  }
}

function assertStatus(request: LockedRequest, expected: WithdrawalStatus): void {
  if (request.status !== expected) {
    throw new DomainError('CONFLICT', `This withdrawal is ${request.status.toLowerCase().replace('_', ' ')}`);
  }
}

export async function approveWithdrawal(tx: Queryable, actor: Actor, input: DecideWithdrawalRequest): Promise<void> {
  const request = await lockRequest(tx, input.withdrawalId);
  assertChecker(actor, request, true);
  assertStatus(request, 'PENDING_APPROVAL');

  const account = await lockAccount(tx, request.susu_account_id);
  assertPayable(account);
  const available = await availablePesewas(tx, account, request.susu_account_id, request.id);
  if (request.amount_pesewas > available) {
    throw new DomainError('INSUFFICIENT_BALANCE', `Only ${formatCedis(Math.max(0, available))} is available to withdraw`, {
      availablePesewas: Math.max(0, available),
    });
  }

  await tx.query(`update withdrawal_requests set status = 'APPROVED', decided_by = $2, decided_at = now() where id = $1`, [
    request.id,
    actor.uid,
  ]);
  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'withdrawal.approved',
    entityKind: 'withdrawal',
    entityId: request.id,
    branchId: request.branch_id,
    channel: actor.channel,
    data: { amountPesewas: request.amount_pesewas, requestedBy: request.requested_by },
  });
}

/** Any checker of the branch may reject, whatever the amount; still never the maker. */
export async function rejectWithdrawal(tx: Queryable, actor: Actor, input: RejectWithdrawalRequest): Promise<void> {
  const request = await lockRequest(tx, input.withdrawalId);
  assertChecker(actor, request, false);
  assertStatus(request, 'PENDING_APPROVAL');
  await tx.query(
    `update withdrawal_requests set status = 'REJECTED', decided_by = $2, decided_at = now(), reject_reason = $3 where id = $1`,
    [request.id, actor.uid, input.reason],
  );
  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'withdrawal.rejected',
    entityKind: 'withdrawal',
    entityId: request.id,
    branchId: request.branch_id,
    channel: actor.channel,
    data: { amountPesewas: request.amount_pesewas, reason: input.reason },
  });
}

/**
 * The cashier pays an approved withdrawal from branch cash:
 *   Debit  MEMBER_SUSU  (we owe the member less)
 *   Credit BRANCH_CASH  (the vault holds less)
 * The batch records the payer as actor and the approver as approved_by (database: different people).
 * The ledger refuses it if either balance would go below zero. Queues the member's SMS receipt.
 */
export async function payWithdrawal(
  tx: Queryable,
  actor: Actor,
  input: DecideWithdrawalRequest,
  now: Date = new Date(),
): Promise<{ batchId: string }> {
  requireRole(actor, WITHDRAWAL_PAYERS);
  const request = await lockRequest(tx, input.withdrawalId);
  requireBranch(actor, request.branch_id);
  assertStatus(request, 'APPROVED');
  if (actor.uid === request.requested_by || actor.uid === request.decided_by) {
    throw new DomainError('SELF_APPROVAL_FORBIDDEN', 'You requested or approved this withdrawal, so someone else must pay it out');
  }

  await lockBranch(tx, request.branch_id);
  await assertDayOpen(tx, request.branch_id, today(now));
  const account = await lockAccount(tx, request.susu_account_id);
  assertPayable(account);
  const branchCashId = await requireLedgerAccount(tx, 'BRANCH_CASH', request.branch_id);

  const posting = await postJournal(tx, {
    idempotencyKey: `withdrawal:${request.id}`,
    kind: 'WITHDRAWAL_PAYOUT',
    description: `Susu withdrawal paid to ${account.full_name}`,
    branchId: request.branch_id,
    actorUid: actor.uid,
    approvedBy: request.decided_by,
    channel: actor.channel,
    lines: [
      { accountId: account.ledger_account_id, side: 'DEBIT', amountPesewas: request.amount_pesewas },
      { accountId: branchCashId, side: 'CREDIT', amountPesewas: request.amount_pesewas },
    ],
  });

  await tx.query(`update withdrawal_requests set status = 'PAID', paid_by = $2, paid_at = now(), batch_id = $3 where id = $1`, [
    request.id,
    actor.uid,
    posting.batchId,
  ]);

  const balance = await tx.query<{ balance_pesewas: number }>('select balance_pesewas from account_balances where account_id = $1', [
    account.ledger_account_id,
  ]);
  await tx.query(`insert into outbox (kind, dedupe_key, payload) values ('SMS', $1, $2)`, [
    `sms:withdrawal:${request.id}`,
    JSON.stringify({
      to: account.phone,
      template: 'WITHDRAWAL_RECEIPT',
      values: {
        amount: formatCedis(request.amount_pesewas),
        balance: formatCedis(balance.rows[0]!.balance_pesewas),
        reference: posting.batchId.slice(0, 8).toUpperCase(),
        postedAt: posting.postedAt,
      },
    }),
  ]);
  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'withdrawal.paid',
    entityKind: 'withdrawal',
    entityId: request.id,
    branchId: request.branch_id,
    channel: actor.channel,
    data: { amountPesewas: request.amount_pesewas, approvedBy: request.decided_by, batchId: posting.batchId },
  });
  return { batchId: posting.batchId };
}
