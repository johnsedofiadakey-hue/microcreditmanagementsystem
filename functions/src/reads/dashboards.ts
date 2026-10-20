import type { BranchDayBusiness, BranchDayDashboard, CompanyDayDashboard } from '@susu/shared';
import type { Queryable } from '../db/types.js';

/**
 * The day dashboards (API.md §4), computed from Postgres — the books — and copied to Firestore for
 * live reads. Pure reads; publishing is in projections/firestore.ts.
 *
 * "Closed" means every operating business has closed the branch day. A business is operating at a
 * branch on a day when it has any module switched on, or when it has cash activity or vault cash
 * there — so a business that is switched off but still collecting is never skipped.
 */

interface BusinessDayRow {
  business_id: string;
  code: string;
  collected: number;
  collection_count: number;
  handed: number;
  paid: number;
  closed: boolean;
  deposited: number;
  confirmed: number;
  open_cases: number;
  operating: boolean;
}

async function businessDays(q: Queryable, branchId: string, day: string): Promise<BusinessDayRow[]> {
  const rows = await q.query<BusinessDayRow>(
    `with day_figures as (
       select b.id as business_id, b.code,
              (select coalesce(sum(amount_pesewas), 0)::bigint from collections c
                where c.branch_id = $1 and c.business_id = b.id and c.cash_day = $2::date) as collected,
              (select count(*)::bigint from collections c
                where c.branch_id = $1 and c.business_id = b.id and c.cash_day = $2::date) as collection_count,
              (select coalesce(sum(counted_pesewas), 0)::bigint from handovers h
                where h.branch_id = $1 and h.business_id = b.id and h.day = $2::date) as handed,
              (select coalesce(sum(amount_pesewas), 0)::bigint from withdrawal_requests w
                where w.branch_id = $1 and w.business_id = b.id and w.status = 'PAID'
                  and (w.paid_at at time zone 'UTC')::date = $2::date) as paid,
              exists (select 1 from branch_closes x where x.branch_id = $1 and x.business_id = b.id and x.day = $2::date) as closed,
              (select coalesce(sum(dd.amount_pesewas), 0)::bigint from bank_deposit_days dd
                where dd.branch_id = $1 and dd.business_id = b.id and dd.day = $2::date) as deposited,
              (select coalesce(sum(dd.amount_pesewas), 0)::bigint from bank_deposit_days dd
                 join bank_matches m on m.deposit_id = dd.deposit_id
                where dd.branch_id = $1 and dd.business_id = b.id and dd.day = $2::date) as confirmed,
              (select count(*)::bigint from cases k where k.branch_id = $1 and k.business_id = b.id and k.status = 'OPEN') as open_cases,
              exists (select 1 from business_modules bm where bm.business_id = b.id and bm.enabled) as module_on,
              coalesce((select bal.balance_pesewas from ledger_accounts la join account_balances bal on bal.account_id = la.id
                         where la.kind = 'BRANCH_CASH' and la.owner_id = $1 and la.business_id = b.id), 0) as vault
         from businesses b
        where b.status = 'ACTIVE'
     )
     select business_id, code, collected, collection_count, handed, paid, closed, deposited, confirmed, open_cases,
            (module_on or collected > 0 or handed > 0 or paid > 0 or closed or vault <> 0) as operating
       from day_figures
      order by code`,
    [branchId, day],
  );
  return rows.rows;
}

export async function computeBranchDay(q: Queryable, branchId: string, day: string, now: Date = new Date()): Promise<BranchDayDashboard> {
  const businesses = await businessDays(q, branchId, day);
  const extra = (
    await q.query<{ active_pairs: number; missing: number; unmatched_count: number; unmatched_amount: number }>(
      `select
         (select count(distinct agent_pair_id)::bigint from collections where branch_id = $1 and cash_day = $2::date) as active_pairs,
         coalesce((select sum(greatest(0, d.last_seq - d.received))::bigint from (
            select max(c.seq) as last_seq, count(c.id) as received
              from devices dv join agent_pairs p on p.id = dv.agent_pair_id
              left join agent_commands c on c.device_id = dv.id
             where p.branch_id = $1 and dv.status = 'ACTIVE'
             group by dv.id) d), 0)::bigint as missing,
         (select count(*)::bigint from bank_deposits d where d.branch_id = $1
            and not exists (select 1 from bank_matches m where m.deposit_id = d.id)) as unmatched_count,
         (select coalesce(sum(d.amount_pesewas), 0)::bigint from bank_deposits d where d.branch_id = $1
            and not exists (select 1 from bank_matches m where m.deposit_id = d.id)) as unmatched_amount`,
      [branchId, day],
    )
  ).rows[0]!;

  const operating = businesses.filter((b) => b.operating);
  const sum = (pick: (b: BusinessDayRow) => number) => businesses.reduce((total, b) => total + pick(b), 0);
  return {
    branchId,
    day,
    collectedPesewas: sum((b) => b.collected),
    collectionCount: sum((b) => b.collection_count),
    activePairs: extra.active_pairs,
    handedOverPesewas: sum((b) => b.handed),
    pendingSyncCount: extra.missing,
    closed: operating.length > 0 && operating.every((b) => b.closed),
    paidOutPesewas: sum((b) => b.paid),
    openCases: sum((b) => b.open_cases),
    unmatchedDeposits: { count: extra.unmatched_count, amountPesewas: extra.unmatched_amount },
    businesses: operating.map<BranchDayBusiness>((b) => ({
      businessId: b.business_id,
      businessCode: b.code,
      collectedPesewas: b.collected,
      collectionCount: b.collection_count,
      handedOverPesewas: b.handed,
      paidOutPesewas: b.paid,
      closed: b.closed,
      depositedPesewas: b.deposited,
      bankConfirmedPesewas: b.confirmed,
      openCases: b.open_cases,
    })),
    computedAt: now.toISOString(),
  };
}

/** Active branches, for the company roll-up and the schedule. */
export async function activeBranchIds(q: Queryable): Promise<string[]> {
  return (await q.query<{ id: string }>(`select id from branches where status = 'ACTIVE' order by code`)).rows.map((r) => r.id);
}

/**
 * Company roll-up. `openExceptions` comes from Firestore (failed commands, SMS, reconciliation),
 * which the publisher counts; open cases come from the books.
 */
export async function computeCompanyDay(q: Queryable, day: string, openExceptions: number, now: Date = new Date()): Promise<CompanyDayDashboard> {
  const branches = await q.query<{ id: string; code: string; name: string }>(`select id, code, name from branches where status = 'ACTIVE' order by code`);
  const perBranch: CompanyDayDashboard['branches'] = [];
  const perBusiness = new Map<string, { businessId: string; businessCode: string; collectedPesewas: number; paidOutPesewas: number }>();
  let openCases = 0;
  for (const branch of branches.rows) {
    const businesses = await businessDays(q, branch.id, day);
    const operating = businesses.filter((b) => b.operating);
    perBranch.push({
      branchId: branch.id,
      code: branch.code,
      name: branch.name,
      collectedPesewas: businesses.reduce((t, b) => t + b.collected, 0),
      collectionCount: businesses.reduce((t, b) => t + b.collection_count, 0),
      closed: operating.length > 0 && operating.every((b) => b.closed),
    });
    for (const b of businesses) {
      openCases += b.open_cases;
      if (!b.operating) continue;
      const total = perBusiness.get(b.business_id) ?? { businessId: b.business_id, businessCode: b.code, collectedPesewas: 0, paidOutPesewas: 0 };
      total.collectedPesewas += b.collected;
      total.paidOutPesewas += b.paid;
      perBusiness.set(b.business_id, total);
    }
  }

  const unmatched = (
    await q.query<{ count: number; amount: number; oldest: string | null }>(
      `select count(*)::bigint as count, coalesce(sum(d.amount_pesewas), 0)::bigint as amount, to_char(min(d.deposited_on), 'YYYY-MM-DD') as oldest
         from bank_deposits d where not exists (select 1 from bank_matches m where m.deposit_id = d.id)`,
    )
  ).rows[0]!;

  const closed = perBranch.filter((b) => b.closed).length;
  return {
    day,
    collectedPesewas: perBranch.reduce((t, b) => t + b.collectedPesewas, 0),
    collectionCount: perBranch.reduce((t, b) => t + b.collectionCount, 0),
    branchesClosed: closed,
    branchesOpen: perBranch.length - closed,
    exceptions: openCases + openExceptions,
    openCases,
    unmatchedDeposits: { count: unmatched.count, amountPesewas: unmatched.amount, oldestDepositedOn: unmatched.oldest },
    branches: perBranch,
    businesses: [...perBusiness.values()].sort((a, b) => a.businessCode.localeCompare(b.businessCode)),
    computedAt: now.toISOString(),
  };
}

/** Which branch day a posted collection counts towards (a late one counts on the next open day). */
export async function collectionDay(q: Queryable, commandId: string): Promise<{ branchId: string; day: string } | null> {
  const row = (
    await q.query<{ branch_id: string; day: string }>(
      `select branch_id, to_char(cash_day, 'YYYY-MM-DD') as day from collections where id = $1`,
      [commandId],
    )
  ).rows[0];
  return row ? { branchId: row.branch_id, day: row.day } : null;
}

/** The branch a cash record belongs to, for refreshing its dashboard after a callable. */
export async function branchOfRecord(
  q: Queryable,
  kind: 'withdrawal' | 'declaration' | 'case' | 'deposit',
  id: string,
): Promise<string | null> {
  const table = { withdrawal: 'withdrawal_requests', declaration: 'handover_declarations', case: 'cases', deposit: 'bank_deposits' }[kind];
  return (await q.query<{ branch_id: string }>(`select branch_id from ${table} where id = $1`, [id])).rows[0]?.branch_id ?? null;
}
