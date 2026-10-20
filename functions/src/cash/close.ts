import {
  formatCedis,
  type BranchCashDay,
  type BranchCloseChecklist,
  type CloseBranchDayRequest,
  type PairCashPosition,
  type Role,
  type SubmitBranchCountRequest,
} from '@susu/shared';
import type { Queryable } from '../db/types.js';
import { activeBusinessIds, findLedgerAccountId, getBalance } from '../ledger/accounts.js';
import { postJournal, type PostingLine } from '../ledger/post.js';
import type { Actor } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';
import { DomainError } from '../lib/errors.js';
import { requireBranch, requireRole } from '../lib/permissions.js';
import { assertDayOpen, cashAccount, describeDifference, lockBranch, openCase, requireBusiness, today } from './common.js';

export const BRANCH_COUNTERS: readonly Role[] = ['CASHIER', 'BRANCH_MANAGER'];
/** Signs the day off. Never the person whose count it is. */
export const BRANCH_CLOSERS: readonly Role[] = ['BRANCH_MANAGER', 'SUPER_ADMIN'];

function assertToday(day: string, now: Date): void {
  if (day !== today(now)) throw new DomainError('INVALID_COMMAND', `Only today (${today(now)}) can be counted or closed`);
}

const iso = (d: Date | string | null): string | null => (d ? new Date(d).toISOString() : null);
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * The live close checklist for one business's branch day: what its vault should hold, the latest
 * count, and every open item a manager must see before signing. After the close it returns the frozen copy.
 */
export async function branchCloseChecklist(q: Queryable, branchId: string, businessId: string, day: string): Promise<BranchCloseChecklist> {
  const business = await requireBusiness(q, businessId);
  const closed = await q.query<{ checklist: BranchCloseChecklist | string; closed_by: string; closed_at: Date }>(
    'select checklist, closed_by, closed_at from branch_closes where branch_id = $1 and business_id = $2 and day = $3',
    [branchId, businessId, day],
  );
  if (closed.rows[0]) {
    const row = closed.rows[0];
    const frozen = (typeof row.checklist === 'string' ? JSON.parse(row.checklist) : row.checklist) as BranchCloseChecklist;
    // Closes frozen before the business split (migration 006) have no business fields; fill them in.
    return {
      ...emptyLateFields,
      ...frozen,
      branchId,
      businessId,
      businessName: business.name,
      day,
      status: 'CLOSED',
      closedBy: row.closed_by,
      closedAt: iso(row.closed_at),
      // Live, outside the frozen copy: collections that arrived after this close (audit H2).
      postedAfterClose: await postedAfterClose(q, branchId, businessId, day),
    };
  }

  // A read never creates accounts: a business whose vault was never used simply holds nothing.
  const vaultId = await findLedgerAccountId(q, 'BRANCH_CASH', branchId, businessId);
  const expectedCash = vaultId ? await getBalance(q, vaultId) : 0;

  const count = (
    await q.query<{ counted_pesewas: number; expected_pesewas: number; counted_by: string; counted_at: Date; note: string | null }>(
      `select counted_pesewas, expected_pesewas, counted_by, counted_at, note from branch_counts
        where branch_id = $1 and business_id = $2 and day = $3 order by counted_at desc, id desc limit 1`,
      [branchId, businessId, day],
    )
  ).rows[0];

  const totals = (
    await q.query<{ collected: number; handed: number; paid: number }>(
      `select
         (select coalesce(sum(amount_pesewas), 0)::bigint from collections
           where branch_id = $1 and business_id = $2 and cash_day = $3::date) as collected,
         (select coalesce(sum(counted_pesewas), 0)::bigint from handovers
           where branch_id = $1 and business_id = $2 and day = $3::date) as handed,
         (select coalesce(sum(amount_pesewas), 0)::bigint from withdrawal_requests
           where branch_id = $1 and business_id = $2 and status = 'PAID' and (paid_at at time zone 'UTC')::date = $3::date) as paid`,
      [branchId, businessId, day],
    )
  ).rows[0]!;

  const pairRows = await q.query<{ id: string; name: string; custody: number; missing: number }>(
    `select p.id, p.name, coalesce(b.balance_pesewas, 0) as custody,
            coalesce((select sum(greatest(0, d.last_seq - d.received))::bigint from (
               select max(c.seq) as last_seq, count(c.id) as received
                 from devices dv left join agent_commands c on c.device_id = dv.id
                where dv.agent_pair_id = p.id group by dv.id) d), 0)::bigint as missing
       from agent_pairs p
       left join ledger_accounts la on la.kind = 'AGENT_CASH_CUSTODY' and la.owner_id = p.id and la.business_id = $2
       left join account_balances b on b.account_id = la.id
      where p.branch_id = $1 and (p.status = 'ACTIVE' or coalesce(b.balance_pesewas, 0) <> 0)
      order by p.name, p.id`,
    [branchId, businessId],
  );
  const pairs: PairCashPosition[] = pairRows.rows.map((p) => ({
    agentPairId: p.id,
    agentPairName: p.name,
    custodyPesewas: p.custody,
    missingRecordCount: p.missing,
  }));

  const queue = (
    await q.query<{ unpaid_count: number; unpaid_amount: number; pending: number; open_cases: number }>(
      `select
         (select count(*) from withdrawal_requests where branch_id = $1 and business_id = $2 and status = 'APPROVED') as unpaid_count,
         (select coalesce(sum(amount_pesewas), 0)::bigint from withdrawal_requests
           where branch_id = $1 and business_id = $2 and status = 'APPROVED') as unpaid_amount,
         (select count(*) from withdrawal_requests where branch_id = $1 and business_id = $2 and status = 'PENDING_APPROVAL') as pending,
         (select count(*) from cases where branch_id = $1 and business_id = $2 and status = 'OPEN') as open_cases`,
      [branchId, businessId],
    )
  ).rows[0]!;

  const extra = (
    await q.query<{
      carried_count: number;
      carried_amount: number;
      off_route_count: number;
      off_route_amount: number;
      previous_route_count: number;
      declarations: number;
      declared: number;
    }>(
      `select
         (select count(*) from collections where branch_id = $1 and business_id = $2 and cash_day = $3::date and posted_after_close) as carried_count,
         (select coalesce(sum(amount_pesewas), 0)::bigint from collections
           where branch_id = $1 and business_id = $2 and cash_day = $3::date and posted_after_close) as carried_amount,
         (select count(*) from collections where branch_id = $1 and business_id = $2 and cash_day = $3::date and route_status = 'OFF_ROUTE') as off_route_count,
         (select coalesce(sum(amount_pesewas), 0)::bigint from collections
           where branch_id = $1 and business_id = $2 and cash_day = $3::date and route_status = 'OFF_ROUTE') as off_route_amount,
         (select count(*) from collections where branch_id = $1 and business_id = $2 and cash_day = $3::date and route_status = 'PREVIOUS_ROUTE') as previous_route_count,
         (select count(*) from handover_declaration_lines l join handover_declarations d on d.id = l.declaration_id
           where d.branch_id = $1 and l.business_id = $2 and l.status = 'DECLARED') as declarations,
         (select coalesce(sum(l.declared_pesewas), 0)::bigint from handover_declaration_lines l join handover_declarations d on d.id = l.declaration_id
           where d.branch_id = $1 and l.business_id = $2 and l.status = 'DECLARED') as declared`,
      [branchId, businessId, day],
    )
  ).rows[0]!;

  const warnings: string[] = [];
  if (extra.declarations > 0) {
    warnings.push(`${plural(extra.declarations, 'handover declaration')} (${formatCedis(extra.declared)}) waiting for a cashier to count`);
  }
  if (extra.off_route_count > 0) {
    warnings.push(`${plural(extra.off_route_count, 'collection')} (${formatCedis(extra.off_route_amount)}) recorded by a pair the account is not assigned to`);
  }
  if (extra.carried_count > 0) {
    warnings.push(`${plural(extra.carried_count, 'collection')} (${formatCedis(extra.carried_amount)}) arrived after the previous close and count today`);
  }
  for (const p of pairs) {
    if (p.custodyPesewas > 0) warnings.push(`${p.agentPairName} still holds ${formatCedis(p.custodyPesewas)} not handed over`);
    if (p.missingRecordCount > 0) {
      warnings.push(`${p.agentPairName}: ${plural(p.missingRecordCount, 'record')} numbered on a phone never reached the server`);
    }
  }
  if (queue.unpaid_count > 0) {
    warnings.push(`${plural(queue.unpaid_count, 'approved withdrawal')} not paid out (${formatCedis(queue.unpaid_amount)})`);
  }
  if (queue.pending > 0) warnings.push(`${plural(queue.pending, 'withdrawal')} waiting for approval`);
  if (queue.open_cases > 0) warnings.push(`${plural(queue.open_cases, 'open case')} for ${business.code} at this branch`);
  if (count && count.expected_pesewas !== expectedCash) warnings.push('Cash moved after the last count — count again before closing');
  if (count && count.counted_pesewas !== expectedCash) {
    warnings.push(`The count shows a ${describeDifference(count.counted_pesewas - expectedCash)}; closing posts it to variance and opens a case`);
  }

  return {
    branchId,
    businessId,
    businessName: business.name,
    day,
    status: count ? 'COUNTED' : 'OPEN',
    expectedCashPesewas: expectedCash,
    count: count
      ? {
          countedPesewas: count.counted_pesewas,
          differencePesewas: count.counted_pesewas - expectedCash,
          countedBy: count.counted_by,
          countedAt: iso(count.counted_at)!,
          note: count.note,
        }
      : null,
    collectedTodayPesewas: totals.collected,
    handedOverTodayPesewas: totals.handed,
    paidOutTodayPesewas: totals.paid,
    pairs,
    approvedUnpaid: { count: queue.unpaid_count, amountPesewas: queue.unpaid_amount },
    pendingApprovals: queue.pending,
    openCases: queue.open_cases,
    pendingDeclarations: { count: extra.declarations, declaredPesewas: extra.declared },
    routeExceptions: {
      offRouteCount: extra.off_route_count,
      offRoutePesewas: extra.off_route_amount,
      previousRouteCount: extra.previous_route_count,
    },
    carriedIn: { count: extra.carried_count, amountPesewas: extra.carried_amount },
    postedAfterClose: { count: 0, amountPesewas: 0, countedOnDay: null },
    warnings,
    closedBy: null,
    closedAt: null,
  };
}

/** Defaults for closes frozen before these fields existed. */
const emptyLateFields: Pick<BranchCloseChecklist, 'pendingDeclarations' | 'routeExceptions' | 'carriedIn'> = {
  pendingDeclarations: { count: 0, declaredPesewas: 0 },
  routeExceptions: { offRouteCount: 0, offRoutePesewas: 0, previousRouteCount: 0 },
  carriedIn: { count: 0, amountPesewas: 0 },
};

/** Collections received after a business's day closed: they count towards the next day (audit H2). */
async function postedAfterClose(
  q: Queryable,
  branchId: string,
  businessId: string,
  day: string,
): Promise<BranchCloseChecklist['postedAfterClose']> {
  const row = (
    await q.query<{ count: number; amount: number; counted_on: string | null }>(
      `select count(*) as count, coalesce(sum(amount_pesewas), 0)::bigint as amount, to_char(min(cash_day), 'YYYY-MM-DD') as counted_on
         from collections
        where branch_id = $1 and business_id = $2 and posted_after_close and (posted_at at time zone 'UTC')::date = $3::date`,
      [branchId, businessId, day],
    )
  ).rows[0]!;
  return { count: row.count, amountPesewas: row.amount, countedOnDay: row.counted_on };
}

/** Every active business's checklist for one branch day — what the cashier and manager work from. */
export async function branchCashDay(q: Queryable, branchId: string, day: string): Promise<BranchCashDay> {
  const businesses: BranchCloseChecklist[] = [];
  for (const businessId of await activeBusinessIds(q)) businesses.push(await branchCloseChecklist(q, branchId, businessId, day));
  return { branchId, day, businesses };
}

/** The cashier counts one business's vault. Can be repeated; the latest count is the one a close uses. */
export async function submitBranchCount(
  tx: Queryable,
  actor: Actor,
  input: SubmitBranchCountRequest,
  now: Date = new Date(),
): Promise<{ countId: string; expectedPesewas: number; differencePesewas: number }> {
  requireRole(actor, BRANCH_COUNTERS);
  requireBranch(actor, input.branchId);
  assertToday(input.day, now);
  const business = await requireBusiness(tx, input.businessId);
  await lockBranch(tx, input.branchId);
  await assertDayOpen(tx, input.branchId, business.id, input.day);

  const expected = await getBalance(tx, await cashAccount(tx, 'BRANCH_CASH', input.branchId, business.id));
  const created = await tx.query<{ id: string }>(
    `insert into branch_counts (branch_id, business_id, day, expected_pesewas, counted_pesewas, counted_by, note)
     values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [input.branchId, business.id, input.day, expected, input.countedPesewas, actor.uid, input.note ?? null],
  );
  const countId = created.rows[0]!.id;
  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'branch.counted',
    entityKind: 'branch_day',
    entityId: `${input.branchId}:${business.code}:${input.day}`,
    branchId: input.branchId,
    channel: actor.channel,
    data: { countId, businessId: business.id, expectedPesewas: expected, countedPesewas: input.countedPesewas },
  });
  return { countId, expectedPesewas: expected, differencePesewas: input.countedPesewas - expected };
}

/**
 * A manager signs one business's day off against the latest count, which must be someone else's and
 * must still match that vault's expected balance. A difference is posted to that business's
 * BRANCH_CASH_VARIANCE (closer as actor, counter as approved_by) and opens a case, so the close can
 * never hide it. Closes once per branch, business and day.
 */
export async function closeBranchDay(
  tx: Queryable,
  actor: Actor,
  input: CloseBranchDayRequest,
  now: Date = new Date(),
): Promise<{ differencePesewas: number; caseId: string | null; checklist: BranchCloseChecklist }> {
  requireRole(actor, BRANCH_CLOSERS);
  requireBranch(actor, input.branchId);
  assertToday(input.day, now);
  const business = await requireBusiness(tx, input.businessId);
  const branch = await lockBranch(tx, input.branchId);
  await assertDayOpen(tx, input.branchId, business.id, input.day);

  const count = (
    await tx.query<{ id: string; expected_pesewas: number; counted_pesewas: number; counted_by: string }>(
      `select id, expected_pesewas, counted_pesewas, counted_by from branch_counts
        where branch_id = $1 and business_id = $2 and day = $3 order by counted_at desc, id desc limit 1`,
      [input.branchId, business.id, input.day],
    )
  ).rows[0];
  if (!count) throw new DomainError('NOT_FOUND', `The cashier has not counted the ${business.name} vault for today yet`);
  if (count.counted_by === actor.uid) {
    throw new DomainError('SELF_APPROVAL_FORBIDDEN', 'You counted the cash, so a different person must close the day');
  }

  const branchCashId = await cashAccount(tx, 'BRANCH_CASH', input.branchId, business.id);
  const expected = await getBalance(tx, branchCashId);
  if (expected !== count.expected_pesewas) {
    throw new DomainError('EXPECTED_CASH_CHANGED', `Cash moved after the count; the vault should now hold ${formatCedis(expected)}. Count again.`, {
      expectedPesewas: expected,
    });
  }

  const checklist = await branchCloseChecklist(tx, input.branchId, business.id, input.day);
  const difference = count.counted_pesewas - expected;
  const entityId = `${input.branchId}:${business.code}:${input.day}`;
  let caseId: string | null = null;
  let batchId: string | null = null;
  if (difference !== 0) {
    const varianceId = await cashAccount(tx, 'BRANCH_CASH_VARIANCE', input.branchId, business.id);
    const amount = Math.abs(difference);
    const lines: PostingLine[] =
      difference < 0
        ? [
            { accountId: varianceId, side: 'DEBIT', amountPesewas: amount },
            { accountId: branchCashId, side: 'CREDIT', amountPesewas: amount },
          ]
        : [
            { accountId: branchCashId, side: 'DEBIT', amountPesewas: amount },
            { accountId: varianceId, side: 'CREDIT', amountPesewas: amount },
          ];
    const posting = await postJournal(tx, {
      idempotencyKey: `close:${input.branchId}:${business.id}:${input.day}`,
      kind: 'BRANCH_CLOSE_VARIANCE',
      description: `${branch.name} ${business.code} close ${input.day}: ${describeDifference(difference)}`,
      branchId: input.branchId,
      actorUid: actor.uid,
      approvedBy: count.counted_by,
      channel: actor.channel,
      lines,
    });
    batchId = posting.batchId;
    caseId = await openCase(tx, {
      branchId: input.branchId,
      businessId: business.id,
      kind: 'CLOSE_DIFFERENCE',
      amountPesewas: difference,
      summary: `${branch.name} ${business.code} close ${input.day}: ${describeDifference(difference)} (expected ${formatCedis(expected)}, counted ${formatCedis(count.counted_pesewas)})`,
      entityKind: 'branch_day',
      entityId,
      openedBy: actor.uid,
    });
  }

  const frozen: BranchCloseChecklist = { ...checklist, openCases: checklist.openCases + (caseId ? 1 : 0) };
  await tx.query(
    `insert into branch_closes (branch_id, business_id, day, count_id, expected_pesewas, counted_pesewas, counted_by, closed_by, note, checklist, case_id, batch_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
    [
      input.branchId,
      business.id,
      input.day,
      count.id,
      expected,
      count.counted_pesewas,
      count.counted_by,
      actor.uid,
      input.note ?? null,
      JSON.stringify(frozen),
      caseId,
      batchId,
    ],
  );
  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'branch.closed',
    entityKind: 'branch_day',
    entityId,
    branchId: input.branchId,
    channel: actor.channel,
    data: { businessId: business.id, expectedPesewas: expected, countedPesewas: count.counted_pesewas, differencePesewas: difference, caseId, warnings: frozen.warnings },
  });
  return { differencePesewas: difference, caseId, checklist: { ...frozen, status: 'CLOSED', closedBy: actor.uid, closedAt: now.toISOString() } };
}
