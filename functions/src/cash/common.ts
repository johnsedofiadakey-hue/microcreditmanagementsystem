import { formatCedis, routeDayKey, type CaseKind } from '@susu/shared';
import type { Queryable } from '../db/types.js';
import { ensureCashAccount } from '../ledger/accounts.js';
import { DomainError } from '../lib/errors.js';

/** Today's branch day: the Accra date, which is the UTC date (GMT all year). */
export function today(now: Date = new Date()): string {
  return routeDayKey(now);
}

/**
 * Serialise every cash action of one branch (handover, payout, count, close) so a close can never
 * race a payout. Returns the branch's name for messages.
 */
export async function lockBranch(tx: Queryable, branchId: string): Promise<{ name: string }> {
  const result = await tx.query<{ name: string }>('select name from branches where id = $1 for update', [branchId]);
  if (!result.rows[0]) throw new DomainError('NOT_FOUND', 'Branch not found');
  return result.rows[0];
}

/** Each business closes its own branch day (ADR-001). */
export async function assertDayOpen(tx: Queryable, branchId: string, businessId: string, day: string): Promise<void> {
  const closed = await tx.query('select 1 from branch_closes where branch_id = $1 and business_id = $2 and day = $3', [
    branchId,
    businessId,
    day,
  ]);
  if (closed.rowCount > 0) throw new DomainError('BRANCH_DAY_CLOSED', `This business's branch day ${day} is already closed`);
}

export interface BusinessInfo {
  id: string;
  code: string;
  name: string;
  smsBrand: string;
  smsSenderId: string;
}

export async function requireBusiness(tx: Queryable, businessId: string): Promise<BusinessInfo> {
  const row = (
    await tx.query<{ id: string; code: string; name: string; sms_brand: string; sms_sender_id: string; status: string }>(
      'select id, code, name, sms_brand, sms_sender_id, status from businesses where id = $1',
      [businessId],
    )
  ).rows[0];
  if (!row || row.status !== 'ACTIVE') throw new DomainError('NOT_FOUND', 'Active business not found');
  return { id: row.id, code: row.code, name: row.name, smsBrand: row.sms_brand, smsSenderId: row.sms_sender_id };
}

/** A pair's custody, or a branch's vault or variance, for one business (created on first use). */
export const cashAccount = ensureCashAccount;

/** Current balance, locked until the transaction ends so a check and the posting see the same number. */
export async function lockedBalance(tx: Queryable, accountId: string): Promise<number> {
  const result = await tx.query<{ balance_pesewas: number }>(
    'select balance_pesewas from account_balances where account_id = $1 for update',
    [accountId],
  );
  if (!result.rows[0]) throw new Error(`No balance row for ledger account ${accountId}`);
  return result.rows[0].balance_pesewas;
}

/** "shortage of GH₵ 5.00" / "overage of GH₵ 2.50" */
export function describeDifference(differencePesewas: number): string {
  return `${differencePesewas < 0 ? 'shortage' : 'overage'} of ${formatCedis(Math.abs(differencePesewas))}`;
}

export async function openCase(
  tx: Queryable,
  input: {
    branchId: string;
    businessId: string;
    kind: CaseKind;
    amountPesewas: number;
    summary: string;
    entityKind: string;
    entityId: string;
    openedBy: string;
  },
): Promise<string> {
  const result = await tx.query<{ id: string }>(
    `insert into cases (branch_id, business_id, kind, amount_pesewas, summary, entity_kind, entity_id, opened_by)
     values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
    [input.branchId, input.businessId, input.kind, input.amountPesewas, input.summary, input.entityKind, input.entityId, input.openedBy],
  );
  return result.rows[0]!.id;
}

export async function newId(tx: Queryable): Promise<string> {
  return (await tx.query<{ id: string }>('select gen_random_uuid() as id')).rows[0]!.id;
}
