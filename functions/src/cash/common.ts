import { formatCedis, routeDayKey, type CaseKind } from '@susu/shared';
import type { Queryable } from '../db/types.js';
import { findLedgerAccountId, type LedgerAccountKind } from '../ledger/accounts.js';
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

export async function assertDayOpen(tx: Queryable, branchId: string, day: string): Promise<void> {
  const closed = await tx.query('select 1 from branch_closes where branch_id = $1 and day = $2', [branchId, day]);
  if (closed.rowCount > 0) throw new DomainError('BRANCH_DAY_CLOSED', `The branch day ${day} is already closed`);
}

export async function requireLedgerAccount(tx: Queryable, kind: LedgerAccountKind, ownerId: string): Promise<string> {
  const id = await findLedgerAccountId(tx, kind, ownerId);
  if (!id) throw new Error(`Missing ${kind} ledger account for ${ownerId}`);
  return id;
}

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
  input: { branchId: string; kind: CaseKind; amountPesewas: number; summary: string; entityKind: string; entityId: string; openedBy: string },
): Promise<string> {
  const result = await tx.query<{ id: string }>(
    `insert into cases (branch_id, kind, amount_pesewas, summary, entity_kind, entity_id, opened_by)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [input.branchId, input.kind, input.amountPesewas, input.summary, input.entityKind, input.entityId, input.openedBy],
  );
  return result.rows[0]!.id;
}

export async function newId(tx: Queryable): Promise<string> {
  return (await tx.query<{ id: string }>('select gen_random_uuid() as id')).rows[0]!.id;
}
