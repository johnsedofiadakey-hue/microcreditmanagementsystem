import { afterEach, describe, expect, it } from 'vitest';
import { branchCloseChecklist } from '../src/cash/close.js';
import { migrate } from '../src/db/migrate.js';
import { createPgliteDatabase } from '../src/db/pglite.js';
import type { Database } from '../src/db/types.js';
import { GADUFIA } from './helpers.js';

/**
 * Migrations run against real data, not only an empty database. Each test stops at a migration,
 * writes rows the way that era's code did, then applies the rest.
 */
let db: Database | undefined;

afterEach(async () => {
  await db?.close();
});

describe('006_businesses over Step 6 data', () => {
  it('assigns existing cash records and accounts to Gadufia, including resolved cases', async () => {
    db = await createPgliteDatabase();
    expect(await migrate(db, { until: '005_cash' })).toContain('005_cash');

    const branch = await db.query<{ id: string }>(`insert into branches (code, name, created_by) values ('KSI-01', 'Kumasi', 'x') returning id`);
    const branchId = branch.rows[0]!.id;
    await db.query(
      `insert into ledger_accounts (kind, owner_id, branch_id, name, account_type, normal_side) values ('BRANCH_CASH', $1, $1, 'Kumasi cash', 'ASSET', 'DEBIT')`,
      [branchId],
    );
    const open = await db.query<{ id: string }>(
      `insert into cases (branch_id, kind, amount_pesewas, summary, entity_kind, entity_id, opened_by)
       values ($1, 'HANDOVER_DIFFERENCE', -100, 'short', 'handover', 'h1', 'cashier-1') returning id`,
      [branchId],
    );
    const resolved = await db.query<{ id: string }>(
      `insert into cases (branch_id, kind, amount_pesewas, summary, entity_kind, entity_id, opened_by)
       values ($1, 'CLOSE_DIFFERENCE', 50, 'over', 'branch_day', 'd1', 'manager-1') returning id`,
      [branchId],
    );
    await db.query(`update cases set status = 'RESOLVED', resolved_by = 'admin-1', resolved_at = now(), resolution = 'ok' where id = $1`, [
      resolved.rows[0]!.id,
    ]);
    const count = await db.query<{ id: string }>(
      `insert into branch_counts (branch_id, day, expected_pesewas, counted_pesewas, counted_by) values ($1, '2026-10-19', 0, 0, 'cashier-1') returning id`,
      [branchId],
    );
    // A close frozen by 005-era code: its checklist has no business fields.
    await db.query(
      `insert into branch_closes (branch_id, day, count_id, expected_pesewas, counted_pesewas, counted_by, closed_by, checklist)
       values ($1, '2026-10-19', $2, 0, 0, 'cashier-1', 'manager-1', $3)`,
      [branchId, count.rows[0]!.id, JSON.stringify({ branchId, day: '2026-10-19', warnings: [] })],
    );

    expect(await migrate(db)).toEqual(['006_businesses']);

    const cases = await db.query<{ business_id: string }>('select business_id from cases order by opened_at');
    expect(cases.rows.map((c) => c.business_id)).toEqual([GADUFIA, GADUFIA]);
    expect((await db.query<{ business_id: string }>('select business_id from ledger_accounts')).rows[0]!.business_id).toBe(GADUFIA);
    expect((await db.query<{ business_id: string }>('select business_id from branch_counts')).rows[0]!.business_id).toBe(GADUFIA);
    const closed = await branchCloseChecklist(db, branchId, GADUFIA, '2026-10-19');
    expect(closed).toMatchObject({ status: 'CLOSED', businessId: GADUFIA, businessName: 'Gadufia Fiase Susu Services', closedBy: 'manager-1' });
    // The guards are back on after the backfill.
    await expect(db.query(`update cases set summary = 'x' where id = $1`, [open.rows[0]!.id])).rejects.toThrow(/only OPEN/);
    await expect(db.query('delete from branch_counts')).rejects.toThrow(/append-only/);
  });
});
