import type { BankDepositStatus, BankDepositSummary, BankLineStatus, BankStatementLineSummary, Role } from '@susu/shared';
import type { Queryable } from '../db/types.js';
import type { Actor } from '../lib/actor.js';
import { requireRole } from '../lib/permissions.js';
import { branchScope, decodeCursor, iso, pageOf } from '../reads/scope.js';

const DEPOSIT_READERS: readonly Role[] = ['SUPER_ADMIN', 'FINANCE', 'COMPLIANCE', 'BRANCH_MANAGER', 'CASHIER'];
const STATEMENT_READERS: readonly Role[] = ['SUPER_ADMIN', 'FINANCE', 'COMPLIANCE'];
const CANDIDATE_WINDOW_DAYS = 14;
const MAX_CANDIDATES = 5;

/** Newest first, scoped to the caller's branches. Unmatched deposits carry likely statement lines. */
export async function listBankDeposits(
  q: Queryable,
  actor: Actor,
  input: { branchId?: string; businessId?: string; status?: BankDepositStatus; cursor?: string | null; limit?: number },
): Promise<{ deposits: BankDepositSummary[]; nextCursor: string | null }> {
  const scope = branchScope(actor, input.branchId, DEPOSIT_READERS);
  const limit = input.limit ?? 50;
  const after = decodeCursor(input.cursor);
  const rows = await q.query<{
    id: string;
    branch_id: string;
    business_id: string;
    bank_account_id: string;
    amount_pesewas: number;
    slip_reference: string;
    deposited_on: string;
    recorded_by: string;
    recorded_at: Date;
    note: string | null;
    days: { day: string; amountPesewas: number }[] | string;
    statement_line_id: string | null;
    line_date: string | null;
    bank_amount: number | null;
    difference_pesewas: number | null;
    matched_by: string | null;
    matched_at: Date | null;
    case_id: string | null;
  }>(
    `select d.id, d.branch_id, d.business_id, d.bank_account_id, d.amount_pesewas, d.slip_reference,
            to_char(d.deposited_on, 'YYYY-MM-DD') as deposited_on, d.recorded_by, d.recorded_at, d.note,
            (select json_agg(json_build_object('day', to_char(x.day, 'YYYY-MM-DD'), 'amountPesewas', x.amount_pesewas) order by x.day)
               from bank_deposit_days x where x.deposit_id = d.id) as days,
            m.statement_line_id, to_char(l.line_date, 'YYYY-MM-DD') as line_date, l.amount_pesewas as bank_amount,
            m.difference_pesewas, m.matched_by, m.matched_at, m.case_id
       from bank_deposits d
       left join bank_matches m on m.deposit_id = d.id
       left join bank_statement_lines l on l.id = m.statement_line_id
      where ($1::uuid[] is null or d.branch_id = any($1::uuid[]))
        and ($2::uuid is null or d.business_id = $2)
        and ($3::text is null or ($3 = 'MATCHED') = (m.id is not null))
        and ($4::timestamptz is null or (d.recorded_at, d.id) < ($4::timestamptz, $5::uuid))
      order by d.recorded_at desc, d.id desc
      limit $6`,
    [scope, input.businessId ?? null, input.status ?? null, after?.k ?? null, after?.id ?? null, limit + 1],
  );
  const page = pageOf(rows.rows, limit, (r) => ({ k: iso(r.recorded_at)!, id: r.id }));

  const deposits: BankDepositSummary[] = [];
  for (const r of page.items) {
    const matched = r.statement_line_id !== null;
    deposits.push({
      id: r.id,
      branchId: r.branch_id,
      businessId: r.business_id,
      bankAccountId: r.bank_account_id,
      amountPesewas: r.amount_pesewas,
      slipReference: r.slip_reference,
      depositedOn: r.deposited_on,
      recordedBy: r.recorded_by,
      recordedAt: iso(r.recorded_at)!,
      note: r.note,
      days: (typeof r.days === 'string' ? JSON.parse(r.days) : r.days) ?? [],
      status: matched ? 'MATCHED' : 'UNMATCHED',
      match: matched
        ? {
            statementLineId: r.statement_line_id!,
            lineDate: r.line_date!,
            bankAmountPesewas: r.bank_amount!,
            differencePesewas: r.difference_pesewas!,
            matchedBy: r.matched_by!,
            matchedAt: iso(r.matched_at)!,
            caseId: r.case_id,
          }
        : null,
      candidates: matched ? [] : await candidatesFor(q, r.bank_account_id, r.deposited_on, r.amount_pesewas, r.slip_reference),
    });
  }
  return { deposits, nextCursor: page.nextCursor };
}

/** Unmatched, not-ignored credits on the deposit's bank account, within the window, best first. */
async function candidatesFor(q: Queryable, bankAccountId: string, depositedOn: string, amount: number, slip: string) {
  const rows = await q.query<{ id: string; line_date: string; amount_pesewas: number; reference: string; description: string; same_amount: boolean; reference_matches: boolean }>(
    `select l.id, to_char(l.line_date, 'YYYY-MM-DD') as line_date, l.amount_pesewas, l.reference, l.description,
            l.amount_pesewas = $3 as same_amount,
            (position(lower($4) in lower(l.reference || ' ' || l.description)) > 0) as reference_matches
       from bank_statement_lines l
      where l.bank_account_id = $1 and l.amount_pesewas > 0
        and l.line_date between $2::date and $2::date + $5::int
        and not exists (select 1 from bank_matches m where m.statement_line_id = l.id)
        and not exists (select 1 from bank_line_ignores i where i.statement_line_id = l.id)
      order by (l.amount_pesewas = $3 and position(lower($4) in lower(l.reference || ' ' || l.description)) > 0) desc,
               (l.amount_pesewas = $3) desc,
               l.line_date, l.id
      limit $6`,
    [bankAccountId, depositedOn, amount, slip, CANDIDATE_WINDOW_DAYS, MAX_CANDIDATES],
  );
  return rows.rows.map((r) => ({
    statementLineId: r.id,
    lineDate: r.line_date,
    amountPesewas: r.amount_pesewas,
    reference: r.reference,
    description: r.description,
    sameAmount: r.same_amount,
    referenceMatches: r.reference_matches,
  }));
}

/** Newest first. Head-office finance roles only: statements show the whole business's banking. */
export async function listBankStatementLines(
  q: Queryable,
  actor: Actor,
  input: { bankAccountId: string; status?: BankLineStatus; cursor?: string | null; limit?: number },
): Promise<{ lines: BankStatementLineSummary[]; nextCursor: string | null }> {
  requireRole(actor, STATEMENT_READERS);
  const limit = input.limit ?? 50;
  const after = decodeCursor(input.cursor);
  const rows = await q.query<{
    id: string;
    bank_account_id: string;
    line_date: string;
    amount_pesewas: number;
    reference: string;
    description: string;
    balance_after_pesewas: number | null;
    deposit_id: string | null;
    ignored_reason: string | null;
    imported_by: string;
    imported_at: Date;
  }>(
    `select l.id, l.bank_account_id, to_char(l.line_date, 'YYYY-MM-DD') as line_date, l.amount_pesewas, l.reference, l.description,
            l.balance_after_pesewas, m.deposit_id, i.reason as ignored_reason, l.imported_by, l.imported_at
       from bank_statement_lines l
       left join bank_matches m on m.statement_line_id = l.id
       left join bank_line_ignores i on i.statement_line_id = l.id
      where l.bank_account_id = $1
        and ($2::text is null
             or ($2 = 'MATCHED' and m.id is not null)
             or ($2 = 'IGNORED' and i.statement_line_id is not null)
             or ($2 = 'UNMATCHED' and m.id is null and i.statement_line_id is null))
        and ($3::date is null or (l.line_date, l.id) < ($3::date, $4::uuid))
      order by l.line_date desc, l.id desc
      limit $5`,
    [input.bankAccountId, input.status ?? null, after?.k ?? null, after?.id ?? null, limit + 1],
  );
  const page = pageOf(rows.rows, limit, (r) => ({ k: r.line_date, id: r.id }));
  return {
    lines: page.items.map((r) => ({
      id: r.id,
      bankAccountId: r.bank_account_id,
      lineDate: r.line_date,
      amountPesewas: r.amount_pesewas,
      reference: r.reference,
      description: r.description,
      balanceAfterPesewas: r.balance_after_pesewas,
      status: r.deposit_id ? 'MATCHED' : r.ignored_reason ? 'IGNORED' : 'UNMATCHED',
      depositId: r.deposit_id,
      ignoredReason: r.ignored_reason,
      importedBy: r.imported_by,
      importedAt: iso(r.imported_at)!,
    })),
    nextCursor: page.nextCursor,
  };
}
