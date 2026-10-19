import type { Queryable } from '../db/types.js';

export interface BalanceMismatch {
  accountId: string;
  storedPesewas: number;
  journalPesewas: number;
}

/**
 * Every balance must equal the signed sum of its journal lines. Database triggers make a mismatch
 * impossible through normal SQL; this nightly check catches anything that bypassed them
 * (disabled triggers, restores, superuser fixes).
 */
export async function findBalanceMismatches(q: Queryable): Promise<BalanceMismatch[]> {
  const result = await q.query<{ account_id: string; stored: number; journal: number }>(
    `select a.id as account_id,
            b.balance_pesewas as stored,
            coalesce(sum(case when l.side = a.normal_side then l.amount_pesewas else -l.amount_pesewas end), 0)::bigint as journal
       from ledger_accounts a
       join account_balances b on b.account_id = a.id
       left join journal_lines l on l.account_id = a.id
      group by a.id, b.balance_pesewas
     having b.balance_pesewas <> coalesce(sum(case when l.side = a.normal_side then l.amount_pesewas else -l.amount_pesewas end), 0)
      order by a.id`,
  );
  return result.rows.map((r) => ({ accountId: r.account_id, storedPesewas: r.stored, journalPesewas: r.journal }));
}
