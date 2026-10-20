import { formatCedis, type IgnoreBankStatementLineRequest, type ImportBankStatementRequest, type ImportBankStatementResult, type MatchBankDepositRequest, type MatchBankDepositResult } from '@susu/shared';
import { importBankStatementRequestSchema } from '@susu/shared';
import type { Queryable } from '../db/types.js';
import { postJournal, type PostingLine } from '../ledger/post.js';
import type { Actor } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';
import { DomainError } from '../lib/errors.js';
import { sha256 } from '../lib/hash.js';
import { requireRole } from '../lib/permissions.js';
import { cashAccount, describeDifference, openCase } from '../cash/common.js';
import { BANK_ADMINS, getBankAccount } from './accounts.js';

/**
 * Finance imports statement lines exactly as the bank printed them. Re-importing an overlapping
 * statement is safe: a line with the same date, amount, reference, description and running balance
 * is stored once. (Two genuinely identical lines with no running balance collapse into one — include
 * the balance column when the bank provides it.)
 */
export async function importBankStatement(tx: Queryable, actor: Actor, raw: ImportBankStatementRequest): Promise<ImportBankStatementResult> {
  requireRole(actor, BANK_ADMINS);
  const input = importBankStatementRequestSchema.parse(raw);
  const bank = await getBankAccount(tx, input.bankAccountId);
  const importId = (await tx.query<{ id: string }>('select gen_random_uuid() as id')).rows[0]!.id;

  let imported = 0;
  for (const line of input.lines) {
    const hash = sha256({
      d: line.date,
      a: line.amountPesewas,
      r: line.reference,
      t: line.description,
      b: line.balanceAfterPesewas ?? null,
    });
    const result = await tx.query(
      `insert into bank_statement_lines (bank_account_id, line_date, amount_pesewas, reference, description, balance_after_pesewas, line_hash, imported_by, import_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       on conflict (bank_account_id, line_hash) do nothing`,
      [bank.id, line.date, line.amountPesewas, line.reference, line.description, line.balanceAfterPesewas ?? null, hash, actor.uid, importId],
    );
    imported += result.rowCount;
  }

  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'bank_statement.imported',
    entityKind: 'bank_account',
    entityId: bank.id,
    channel: actor.channel,
    data: { importId, lines: input.lines.length, imported },
  });
  return { importId, imported, duplicates: input.lines.length - imported };
}

/**
 * Finance confirms a deposit arrived: the statement line moves the cash from CASH_IN_TRANSIT into the
 * BANK account. A different amount is posted to the branch's variance for that business and opens a
 * DEPOSIT_DIFFERENCE case; the deposit and line are still matched, so the difference cannot hide.
 */
export async function matchBankDeposit(tx: Queryable, actor: Actor, input: MatchBankDepositRequest): Promise<MatchBankDepositResult> {
  requireRole(actor, BANK_ADMINS);

  const deposit = (
    await tx.query<{ id: string; branch_id: string; business_id: string; bank_account_id: string; amount_pesewas: number; slip_reference: string; deposited_on: string; recorded_by: string; business_code: string; branch_name: string }>(
      `select d.id, d.branch_id, d.business_id, d.bank_account_id, d.amount_pesewas, d.slip_reference,
              to_char(d.deposited_on, 'YYYY-MM-DD') as deposited_on, d.recorded_by, b.code as business_code, br.name as branch_name
         from bank_deposits d join businesses b on b.id = d.business_id join branches br on br.id = d.branch_id
        where d.id = $1 for update of d`,
      [input.depositId],
    )
  ).rows[0];
  if (!deposit) throw new DomainError('NOT_FOUND', 'Deposit not found');
  if (deposit.recorded_by === actor.uid) {
    throw new DomainError('SELF_APPROVAL_FORBIDDEN', 'You recorded this deposit, so someone else must match it to the bank statement');
  }

  const line = (
    await tx.query<{ id: string; bank_account_id: string; line_date: string; amount_pesewas: number; reference: string }>(
      `select id, bank_account_id, to_char(line_date, 'YYYY-MM-DD') as line_date, amount_pesewas, reference
         from bank_statement_lines where id = $1 for update`,
      [input.statementLineId],
    )
  ).rows[0];
  if (!line) throw new DomainError('NOT_FOUND', 'Statement line not found');
  if (line.bank_account_id !== deposit.bank_account_id) {
    throw new DomainError('INVALID_COMMAND', 'This statement line is from a different bank account than the deposit');
  }
  if (line.amount_pesewas <= 0) throw new DomainError('INVALID_COMMAND', 'Only money coming in can match a deposit');
  if (line.line_date < deposit.deposited_on) throw new DomainError('INVALID_COMMAND', 'The bank line is dated before the deposit was made');

  const taken = await tx.query<{ what: string }>(
    `select 'deposit' as what from bank_matches where deposit_id = $1
     union all select 'line' from bank_matches where statement_line_id = $2
     union all select 'ignored' from bank_line_ignores where statement_line_id = $2`,
    [deposit.id, line.id],
  );
  const what = taken.rows.map((r) => r.what);
  if (what.includes('deposit')) throw new DomainError('CONFLICT', 'This deposit is already matched');
  if (what.includes('line')) throw new DomainError('CONFLICT', 'This statement line is already matched to another deposit');
  if (what.includes('ignored')) throw new DomainError('CONFLICT', 'This statement line was set aside as not a deposit');

  const bank = await getBankAccount(tx, deposit.bank_account_id);
  const transitId = await cashAccount(tx, 'CASH_IN_TRANSIT', deposit.branch_id, deposit.business_id);
  const difference = line.amount_pesewas - deposit.amount_pesewas;
  const lines: PostingLine[] = [
    { accountId: bank.ledgerAccountId, side: 'DEBIT', amountPesewas: line.amount_pesewas },
    { accountId: transitId, side: 'CREDIT', amountPesewas: deposit.amount_pesewas },
  ];
  if (difference !== 0) {
    const varianceId = await cashAccount(tx, 'BRANCH_CASH_VARIANCE', deposit.branch_id, deposit.business_id);
    // Bank shows less: the shortfall is a loss (debit variance). Bank shows more: an overage (credit variance).
    lines.push({ accountId: varianceId, side: difference < 0 ? 'DEBIT' : 'CREDIT', amountPesewas: Math.abs(difference) });
  }

  const posting = await postJournal(tx, {
    idempotencyKey: `bank-match:${deposit.id}`,
    kind: 'BANK_DEPOSIT_MATCHED',
    description: `${deposit.branch_name} ${deposit.business_code} slip ${deposit.slip_reference} confirmed on ${bank.label} statement ${line.line_date}${difference ? ` (${describeDifference(difference)})` : ''}`,
    branchId: deposit.branch_id,
    actorUid: actor.uid,
    channel: actor.channel,
    lines,
  });

  let caseId: string | null = null;
  if (difference !== 0) {
    caseId = await openCase(tx, {
      branchId: deposit.branch_id,
      businessId: deposit.business_id,
      kind: 'DEPOSIT_DIFFERENCE',
      amountPesewas: difference,
      summary: `${deposit.branch_name} ${deposit.business_code} slip ${deposit.slip_reference}: deposited ${formatCedis(deposit.amount_pesewas)}, bank shows ${formatCedis(line.amount_pesewas)} (${describeDifference(difference)})`,
      entityKind: 'bank_deposit',
      entityId: deposit.id,
      openedBy: actor.uid,
    });
  }

  const matchId = (
    await tx.query<{ id: string }>(
      `insert into bank_matches (deposit_id, statement_line_id, difference_pesewas, matched_by, note, case_id, batch_id)
       values ($1, $2, $3, $4, $5, $6, $7) returning id`,
      [deposit.id, line.id, difference, actor.uid, input.note ?? null, caseId, posting.batchId],
    )
  ).rows[0]!.id;

  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'bank_deposit.matched',
    entityKind: 'bank_deposit',
    entityId: deposit.id,
    branchId: deposit.branch_id,
    channel: actor.channel,
    data: { statementLineId: line.id, bankAmountPesewas: line.amount_pesewas, differencePesewas: difference, caseId },
  });
  return { matchId, differencePesewas: difference, caseId };
}

export async function ignoreBankStatementLine(tx: Queryable, actor: Actor, input: IgnoreBankStatementLineRequest): Promise<void> {
  requireRole(actor, BANK_ADMINS);
  const line = (await tx.query<{ bank_account_id: string }>('select bank_account_id from bank_statement_lines where id = $1 for update', [input.statementLineId])).rows[0];
  if (!line) throw new DomainError('NOT_FOUND', 'Statement line not found');
  const taken = await tx.query(
    'select 1 from bank_matches where statement_line_id = $1 union all select 1 from bank_line_ignores where statement_line_id = $1',
    [input.statementLineId],
  );
  if (taken.rowCount > 0) throw new DomainError('CONFLICT', 'This statement line is already matched or set aside');
  await tx.query('insert into bank_line_ignores (statement_line_id, reason, ignored_by) values ($1, $2, $3)', [
    input.statementLineId,
    input.reason,
    actor.uid,
  ]);
  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'bank_statement_line.ignored',
    entityKind: 'bank_statement_line',
    entityId: input.statementLineId,
    channel: actor.channel,
    data: { bankAccountId: line.bank_account_id, reason: input.reason },
  });
}
