import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { recordBankDeposit } from '../src/bank/deposits.js';
import { importBankStatement, matchBankDeposit } from '../src/bank/statements.js';
import { today } from '../src/cash/common.js';
import { approveWithdrawal, payWithdrawal, requestWithdrawal } from '../src/cash/withdrawals.js';
import { processAgentCommand } from '../src/commands/processAgentCommand.js';
import type { Database } from '../src/db/types.js';
import { createBranch } from '../src/org/branches.js';
import { previousDayKey } from '../src/projections/firestore.js';
import { collectionDay, computeBranchDay, computeCompanyDay } from '../src/reads/dashboards.js';
import { actor, freshDatabase, seedBranch, signedCollection } from './helpers.js';
import { bankAccount, closedDay, finance, handedOver, nextDay, type Seed } from './bankHelpers.js';

let db: Database;
let seed: Seed;

beforeEach(async () => {
  db = await freshDatabase();
  seed = await seedBranch(db);
});

afterEach(async () => {
  await db.close();
});

describe('branch day dashboard', () => {
  it('an open day with collections: the fields the portal reads', async () => {
    for (const [seq, amount] of [[1, 2_000], [2, 3_000]] as const) {
      const c = signedCollection(seed.key, { ...seed, seq, amountPesewas: amount });
      await processAgentCommand(db, c.id, c.body);
    }
    const day = await computeBranchDay(db, seed.branchId, today());
    expect(day).toMatchObject({
      branchId: seed.branchId,
      day: today(),
      collectedPesewas: 5_000,
      collectionCount: 2,
      activePairs: 1,
      handedOverPesewas: 0,
      pendingSyncCount: 0,
      closed: false,
      paidOutPesewas: 0,
      openCases: 0,
      unmatchedDeposits: { count: 0, amountPesewas: 0 },
    });
    // Only Gadufia operates in the Stage 1 pilot: STF and OPWS have no module on and no cash, so they are left out.
    expect(day.businesses.map((b) => b.businessCode)).toEqual(['GADUFIA']);
  });

  it('counts phones’ missing sequence numbers as waiting to sync', async () => {
    for (const seq of [1, 4]) {
      const c = signedCollection(seed.key, { ...seed, seq });
      await processAgentCommand(db, c.id, c.body);
    }
    expect((await computeBranchDay(db, seed.branchId, today())).pendingSyncCount).toBe(2);
  });

  it('a closed day shows handover, close, deposit and bank confirmation per business', async () => {
    const { day } = await closedDay(db, seed, [10_000, 2_000]);
    const before = await computeBranchDay(db, seed.branchId, day);
    expect(before).toMatchObject({ collectedPesewas: 12_000, collectionCount: 2, handedOverPesewas: 12_000, closed: true });

    const { day: next, morning } = nextDay(day);
    const bankId = await bankAccount(db, seed);
    const { depositId } = await db.transaction((tx) =>
      recordBankDeposit(
        tx,
        seed.cashier,
        { branchId: seed.branchId, businessId: seed.businessId, bankAccountId: bankId, amountPesewas: 1_500, slipReference: 'S1', depositedOn: next, days: [{ day, amountPesewas: 1_500 }] },
        morning,
      ),
    );
    const deposited = await computeBranchDay(db, seed.branchId, day);
    expect(deposited.businesses[0]).toMatchObject({ businessCode: 'GADUFIA', closed: true, depositedPesewas: 1_500, bankConfirmedPesewas: 0 });
    expect(deposited.unmatchedDeposits).toEqual({ count: 1, amountPesewas: 1_500 });

    await db.transaction((tx) => importBankStatement(tx, finance(), { bankAccountId: bankId, lines: [{ date: next, amountPesewas: 1_500, reference: 'S1' }] }));
    const line = (await db.query<{ id: string }>('select id from bank_statement_lines')).rows[0]!.id;
    await db.transaction((tx) => matchBankDeposit(tx, finance(), { depositId, statementLineId: line }));
    const confirmed = await computeBranchDay(db, seed.branchId, day);
    expect(confirmed.businesses[0]).toMatchObject({ depositedPesewas: 1_500, bankConfirmedPesewas: 1_500 });
    expect(confirmed.unmatchedDeposits).toEqual({ count: 0, amountPesewas: 0 });
  });

  it('payouts count on the day they were paid', async () => {
    await handedOver(db, seed, [10_000]);
    const { withdrawalId } = await db.transaction((tx) =>
      requestWithdrawal(tx, seed.cashier, { susuAccountId: seed.susuAccountId, amountPesewas: 1_000, reason: 'School fees' }),
    );
    await db.transaction((tx) => approveWithdrawal(tx, seed.manager, { withdrawalId }));
    await db.transaction((tx) => payWithdrawal(tx, actor('cashier-2', 'CASHIER', [seed.branchId]), { withdrawalId }));
    expect(await computeBranchDay(db, seed.branchId, today())).toMatchObject({ collectedPesewas: 10_000, handedOverPesewas: 10_000, paidOutPesewas: 1_000 });
  });
});

describe('company day dashboard', () => {
  it('rolls up branches, closes, unmatched deposits and exceptions', async () => {
    const { branchId: accra } = await db.transaction((tx) => createBranch(tx, seed.admin, { name: 'Accra Central', code: 'ACC-01' }));
    const { day } = await closedDay(db, seed, [2_000, 3_000]);
    const company = await computeCompanyDay(db, day, 2);
    expect(company).toMatchObject({
      day,
      collectedPesewas: 5_000,
      collectionCount: 2,
      branchesClosed: 1,
      // Accra has no activity: Gadufia's module is on there too, so its day counts as open until closed.
      branchesOpen: 1,
      openCases: 0,
      exceptions: 2,
      unmatchedDeposits: { count: 0, amountPesewas: 0, oldestDepositedOn: null },
    });
    expect(company.branches.map((b) => [b.code, b.closed, b.collectedPesewas])).toEqual([
      ['ACC-01', false, 0],
      ['KSI-01', true, 5_000],
    ]);
    expect(company.branches.find((b) => b.branchId === accra)).toBeDefined();
    expect(company.businesses).toEqual([{ businessId: seed.businessId, businessCode: 'GADUFIA', collectedPesewas: 5_000, paidOutPesewas: 0 }]);
  });
});

describe('which day a collection counts towards', () => {
  it('a collection posted after the close counts on the next day’s dashboard', async () => {
    const { day, nextSeq } = await closedDay(db, seed, [2_000]);
    const late = signedCollection(seed.key, { ...seed, seq: nextSeq, amountPesewas: 700 });
    expect((await processAgentCommand(db, late.id, late.body)).status).toBe('POSTED');
    const counted = await collectionDay(db, late.id);
    expect(counted).toEqual({ branchId: seed.branchId, day: nextDay(day).day });
    expect((await computeBranchDay(db, seed.branchId, day)).collectedPesewas).toBe(2_000);
    expect((await computeBranchDay(db, seed.branchId, counted!.day)).collectedPesewas).toBe(700);
  });

  it('previousDayKey crosses months and years', () => {
    expect(previousDayKey('2026-11-01')).toBe('2026-10-31');
    expect(previousDayKey('2027-01-01')).toBe('2026-12-31');
  });
});
