import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { approveCorrection, requestCollectionCorrection } from '../src/cash/corrections.js';
import { confirmHandover } from '../src/cash/handovers.js';
import { processAgentCommand } from '../src/commands/processAgentCommand.js';
import { migrate } from '../src/db/migrate.js';
import { createPgDatabase } from '../src/db/pg.js';
import type { Database } from '../src/db/types.js';
import { findBalanceMismatches } from '../src/ledger/reconcile.js';
import { actor, seedBranch, signedCollection, signedDeclaration } from './helpers.js';

/** Correction races on real Postgres (PGlite runs one transaction at a time). Runs with `corepack pnpm test:pg`. */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('corrections under concurrency', () => {
  let db: Database;
  let seed: Awaited<ReturnType<typeof seedBranch>>;
  let batch: string;
  const REASON = 'Agent tapped the wrong member';

  beforeAll(() => {
    db = createPgDatabase(url!, 20);
  });
  afterAll(async () => {
    await db?.close();
  });
  beforeEach(async () => {
    await db.exec('drop schema public cascade; create schema public;');
    await migrate(db);
    seed = await seedBranch(db);
    const c = signedCollection(seed.key, { ...seed, amountPesewas: 2_000, seq: 1 });
    const posted = await processAgentCommand(db, c.id, c.body);
    if (posted.status !== 'POSTED') throw new Error('setup collection failed');
    batch = posted.postingId;
  });

  it('two people approving the same correction at once: it posts once', async () => {
    const { correctionId } = await db.transaction((tx) => requestCollectionCorrection(tx, seed.cashier, { collectionBatchId: batch, kind: 'REVERSE_COLLECTION', reason: REASON }));
    const results = await Promise.allSettled([
      db.transaction((tx) => approveCorrection(tx, seed.manager, { correctionId })),
      db.transaction((tx) => approveCorrection(tx, actor('finance-1', 'FINANCE'), { correctionId })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.query(`select 1 from journal_batches where kind like 'REVERSAL:%'`)).rowCount).toBe(1);
    expect(await findBalanceMismatches(db)).toEqual([]);
  });

  it('two requests for the same collection at once: exactly one is open', async () => {
    const results = await Promise.allSettled([
      db.transaction((tx) => requestCollectionCorrection(tx, seed.cashier, { collectionBatchId: batch, kind: 'REVERSE_COLLECTION', reason: REASON })),
      db.transaction((tx) => requestCollectionCorrection(tx, seed.manager, { collectionBatchId: batch, kind: 'REVERSE_COLLECTION', reason: REASON })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.query('select 1 from correction_requests')).rowCount).toBe(1);
  });

  it('a reversal approved while the cashier confirms the handover of the same cash: books stay consistent', async () => {
    const { correctionId } = await db.transaction((tx) => requestCollectionCorrection(tx, seed.cashier, { collectionBatchId: batch, kind: 'REVERSE_COLLECTION', reason: REASON }));
    const d = signedDeclaration(seed.key, { seq: 2, lines: [{ businessId: seed.businessId, declaredPesewas: 2_000 }] });
    expect((await processAgentCommand(db, d.id, d.body)).status).toBe('RECORDED');
    const results = await Promise.allSettled([
      db.transaction((tx) => approveCorrection(tx, seed.manager, { correctionId })),
      db.transaction((tx) => confirmHandover(tx, actor('cashier-2', 'CASHIER', [seed.branchId]), { declarationId: d.id, businessId: seed.businessId, expectedPesewas: 2_000, countedPesewas: 2_000 })),
    ]);
    // Whichever runs second sees the other's effect and refuses: never both.
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await findBalanceMismatches(db)).toEqual([]);
    const custody = await db.query<{ b: number }>(`select b.balance_pesewas as b from ledger_accounts a join account_balances b on b.account_id = a.id where a.kind = 'AGENT_CASH_CUSTODY'`);
    expect(custody.rows.every((r) => r.b >= 0)).toBe(true);
  });
});
