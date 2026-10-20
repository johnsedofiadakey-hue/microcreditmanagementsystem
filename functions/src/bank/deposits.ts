import { formatCedis, type RecordBankDepositRequest, type Role } from '@susu/shared';
import type { Queryable } from '../db/types.js';
import { getBalance } from '../ledger/accounts.js';
import { postJournal } from '../ledger/post.js';
import type { Actor } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';
import { DomainError } from '../lib/errors.js';
import { requireBranch, requireRole } from '../lib/permissions.js';
import { assertDayOpen, cashAccount, lockBranch, requireBusiness, today } from '../cash/common.js';
import { getBankAccount } from './accounts.js';

export const DEPOSIT_RECORDERS: readonly Role[] = ['CASHIER', 'BRANCH_MANAGER'];

/**
 * Cash leaves the branch vault for the bank. Moves it from BRANCH_CASH to CASH_IN_TRANSIT for that
 * business, against closed days of that business. Finance later matches it to the bank statement;
 * until then it shows as unmatched on the dashboards.
 */
export async function recordBankDeposit(
  tx: Queryable,
  actor: Actor,
  input: RecordBankDepositRequest,
  now: Date = new Date(),
): Promise<{ depositId: string; batchId: string }> {
  requireRole(actor, DEPOSIT_RECORDERS);
  requireBranch(actor, input.branchId);
  const business = await requireBusiness(tx, input.businessId);
  const bank = await getBankAccount(tx, input.bankAccountId);
  if (bank.businessId !== business.id) {
    throw new DomainError('INVALID_COMMAND', `${bank.label} belongs to a different business than ${business.name}`);
  }
  if (bank.status !== 'ACTIVE') throw new DomainError('INVALID_COMMAND', `${bank.label} is closed`);

  const todayKey = today(now);
  if (input.depositedOn > todayKey) throw new DomainError('INVALID_COMMAND', 'The deposit date cannot be in the future');
  const total = input.days.reduce((sum, d) => sum + d.amountPesewas, 0);
  if (total !== input.amountPesewas) {
    throw new DomainError('INVALID_COMMAND', `The days add up to ${formatCedis(total)} but the deposit is ${formatCedis(input.amountPesewas)}`);
  }
  if (new Set(input.days.map((d) => d.day)).size !== input.days.length) {
    throw new DomainError('INVALID_COMMAND', 'Each closed day can appear only once in a deposit');
  }

  const branch = await lockBranch(tx, input.branchId);
  // The vault is about to change, so today's day for this business must still be open (audit 19 Oct H2).
  await assertDayOpen(tx, input.branchId, business.id, todayKey);

  for (const d of input.days) {
    if (d.day > input.depositedOn) {
      throw new DomainError('INVALID_COMMAND', `Cash from ${d.day} cannot have been deposited on ${input.depositedOn}`);
    }
    const close = (
      await tx.query<{ counted_pesewas: number; banked: number }>(
        `select c.counted_pesewas,
                (select coalesce(sum(amount_pesewas), 0)::bigint from bank_deposit_days x
                  where x.branch_id = c.branch_id and x.business_id = c.business_id and x.day = c.day) as banked
           from branch_closes c where c.branch_id = $1 and c.business_id = $2 and c.day = $3`,
        [input.branchId, business.id, d.day],
      )
    ).rows[0];
    if (!close) throw new DomainError('NOT_FOUND', `The ${business.code} branch day ${d.day} is not closed, so nothing from it can be banked yet`);
    if (close.banked + d.amountPesewas > close.counted_pesewas) {
      throw new DomainError(
        'INVALID_COMMAND',
        `${d.day}: ${formatCedis(close.banked)} of the ${formatCedis(close.counted_pesewas)} counted is already banked, so at most ${formatCedis(close.counted_pesewas - close.banked)} more can be`,
      );
    }
  }

  const clash = await tx.query('select 1 from bank_deposits where bank_account_id = $1 and slip_reference = $2', [bank.id, input.slipReference]);
  if (clash.rowCount > 0) throw new DomainError('CONFLICT', `Slip ${input.slipReference} is already recorded for ${bank.label}`);

  const vaultId = await cashAccount(tx, 'BRANCH_CASH', input.branchId, business.id);
  const transitId = await cashAccount(tx, 'CASH_IN_TRANSIT', input.branchId, business.id);
  const vault = await getBalance(tx, vaultId);
  if (vault < input.amountPesewas) {
    throw new DomainError('INSUFFICIENT_BALANCE', `The ${business.code} vault holds ${formatCedis(vault)}, less than this deposit`);
  }

  const posting = await postJournal(tx, {
    idempotencyKey: `deposit:${bank.id}:${input.slipReference}`,
    kind: 'BANK_DEPOSIT',
    description: `${branch.name} ${business.code} deposit to ${bank.label}, slip ${input.slipReference}`,
    branchId: input.branchId,
    actorUid: actor.uid,
    channel: actor.channel,
    lines: [
      { accountId: transitId, side: 'DEBIT', amountPesewas: input.amountPesewas },
      { accountId: vaultId, side: 'CREDIT', amountPesewas: input.amountPesewas },
    ],
  });

  const depositId = (
    await tx.query<{ id: string }>(
      `insert into bank_deposits (branch_id, business_id, bank_account_id, amount_pesewas, slip_reference, deposited_on, recorded_by, note, batch_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [input.branchId, business.id, bank.id, input.amountPesewas, input.slipReference, input.depositedOn, actor.uid, input.note ?? null, posting.batchId],
    )
  ).rows[0]!.id;
  for (const d of input.days) {
    await tx.query(
      `insert into bank_deposit_days (deposit_id, branch_id, business_id, day, amount_pesewas) values ($1, $2, $3, $4, $5)`,
      [depositId, input.branchId, business.id, d.day, d.amountPesewas],
    );
  }

  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'bank_deposit.recorded',
    entityKind: 'bank_deposit',
    entityId: depositId,
    branchId: input.branchId,
    channel: actor.channel,
    data: { businessId: business.id, bankAccountId: bank.id, amountPesewas: input.amountPesewas, slipReference: input.slipReference, days: input.days },
  });
  return { depositId, batchId: posting.batchId };
}
