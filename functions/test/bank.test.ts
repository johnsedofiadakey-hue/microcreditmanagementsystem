import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { listBankAccounts } from '../src/bank/accounts.js';
import { recordBankDeposit } from '../src/bank/deposits.js';
import { listBankDeposits, listBankStatementLines } from '../src/bank/reads.js';
import { ignoreBankStatementLine, importBankStatement, matchBankDeposit } from '../src/bank/statements.js';
import { listCases } from '../src/cash/reads.js';
import type { Database } from '../src/db/types.js';
import { findLedgerAccountId, getBalance } from '../src/ledger/accounts.js';
import { findBalanceMismatches } from '../src/ledger/reconcile.js';
import { actor, freshDatabase, seedBranch, STF } from './helpers.js';
import { bankAccount, closedDay, finance, nextDay, type Seed } from './bankHelpers.js';

let db: Database;
let seed: Seed;
let day: string;
let morning: Date;
let bankId: string;

beforeEach(async () => {
  db = await freshDatabase();
  seed = await seedBranch(db);
  ({ day } = await closedDay(db, seed, [2_000, 3_000, 1_000]));
  ({ morning } = nextDay(day));
  bankId = await bankAccount(db, seed);
});

afterEach(async () => {
  await db.close();
});

const balanceOf = async (kind: Parameters<typeof findLedgerAccountId>[1], ownerId: string) => {
  const id = await findLedgerAccountId(db, kind, ownerId, seed.businessId);
  return id ? getBalance(db, id) : 0;
};
const vault = () => balanceOf('BRANCH_CASH', seed.branchId);
const transit = () => balanceOf('CASH_IN_TRANSIT', seed.branchId);
const variance = () => balanceOf('BRANCH_CASH_VARIANCE', seed.branchId);
const bankBalance = () => balanceOf('BANK', bankId);

function deposit(amountPesewas: number, overrides: Partial<Parameters<typeof recordBankDeposit>[2]> = {}, who = seed.cashier, now = morning) {
  return db.transaction((tx) =>
    recordBankDeposit(
      tx,
      who,
      {
        branchId: seed.branchId,
        businessId: seed.businessId,
        bankAccountId: bankId,
        amountPesewas,
        slipReference: 'SLIP-001',
        depositedOn: nextDay(day).day,
        days: [{ day, amountPesewas }],
        ...overrides,
      },
      now,
    ),
  );
}

const importLines = (lines: { date: string; amountPesewas: number; reference?: string; description?: string; balanceAfterPesewas?: number }[]) =>
  db.transaction((tx) => importBankStatement(tx, finance(), { bankAccountId: bankId, lines }));

async function lineId(reference: string) {
  return (await db.query<{ id: string }>('select id from bank_statement_lines where reference = $1', [reference])).rows[0]!.id;
}

describe('recording a deposit', () => {
  it('moves cash from the vault to cash in transit against a closed day', async () => {
    expect(await vault()).toBe(6_000);
    const { depositId } = await deposit(5_000);
    expect([await vault(), await transit()]).toEqual([1_000, 5_000]);
    const { deposits } = await listBankDeposits(db, seed.manager, {});
    expect(deposits).toEqual([
      expect.objectContaining({ id: depositId, amountPesewas: 5_000, slipReference: 'SLIP-001', status: 'UNMATCHED', match: null, days: [{ day, amountPesewas: 5_000 }] }),
    ]);
    expect(await findBalanceMismatches(db)).toEqual([]);
  });

  it('never banks more than the close counted, across deposits', async () => {
    await deposit(4_000);
    await expect(deposit(2_001, { slipReference: 'SLIP-002' })).rejects.toMatchObject({ reason: 'INVALID_COMMAND' });
    await deposit(2_000, { slipReference: 'SLIP-002' });
    expect(await vault()).toBe(0);
  });

  it('refuses a day that is not closed, a duplicate slip, mismatched totals, future dates and a day after the deposit', async () => {
    const { day: tomorrow } = nextDay(day);
    await expect(deposit(1_000, { days: [{ day: tomorrow, amountPesewas: 1_000 }], depositedOn: tomorrow })).rejects.toMatchObject({ reason: 'NOT_FOUND' });
    await deposit(1_000);
    await expect(deposit(1_000)).rejects.toMatchObject({ reason: 'CONFLICT' });
    await expect(deposit(1_000, { slipReference: 'S3', days: [{ day, amountPesewas: 900 }] })).rejects.toMatchObject({ reason: 'INVALID_COMMAND' });
    await expect(deposit(1_000, { slipReference: 'S4', depositedOn: nextDay(nextDay(day).day).day })).rejects.toMatchObject({ reason: 'INVALID_COMMAND' });
    await expect(deposit(1_000, { slipReference: 'S5', depositedOn: '2020-01-01' })).rejects.toMatchObject({ reason: 'INVALID_COMMAND' });
  });

  it('refuses while today’s day for that business is already closed (the vault is frozen)', async () => {
    await expect(deposit(1_000, { depositedOn: day }, seed.cashier, new Date(`${day}T18:00:00Z`))).rejects.toMatchObject({ reason: 'BRANCH_DAY_CLOSED' });
  });

  it('refuses another business’s bank account, and roles that do not handle the vault', async () => {
    const stfBank = await bankAccount(db, seed, '9999', STF);
    await expect(deposit(1_000, { bankAccountId: stfBank })).rejects.toMatchObject({ reason: 'INVALID_COMMAND' });
    for (const who of [finance(), actor('agent-a', 'AGENT', [seed.branchId]), actor('sup', 'SUPERVISOR', [seed.branchId])]) {
      await expect(deposit(1_000, {}, who)).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
    }
  });

  it('the database refuses a deposit that covers no closed day, or more than a close counted', async () => {
    await expect(
      db.transaction(async (tx) => {
        const batch = (await tx.query<{ id: string }>(`select id from journal_batches limit 1`)).rows[0]!.id;
        await tx.query(
          `insert into bank_deposits (branch_id, business_id, bank_account_id, amount_pesewas, slip_reference, deposited_on, recorded_by, batch_id)
           values ($1, $2, $3, 100, 'RAW', current_date, 'ops', $4)`,
          [seed.branchId, seed.businessId, bankId, batch],
        );
      }),
    ).rejects.toThrow();
    const { depositId } = await deposit(6_000);
    await expect(
      db.query(`insert into bank_deposit_days (deposit_id, branch_id, business_id, day, amount_pesewas) values ($1, $2, $3, $4, 1)`, [
        depositId,
        seed.branchId,
        seed.businessId,
        day,
      ]),
    ).rejects.toThrow();
  });
});

describe('importing the bank statement', () => {
  it('stores each line once across overlapping imports; finance only', async () => {
    const { day: d1 } = nextDay(day);
    const first = await importLines([
      { date: d1, amountPesewas: 5_000, reference: 'SLIP-001', balanceAfterPesewas: 105_000 },
      { date: d1, amountPesewas: -500, reference: 'CHG', description: 'Bank charges', balanceAfterPesewas: 104_500 },
    ]);
    expect(first).toMatchObject({ imported: 2, duplicates: 0 });
    const second = await importLines([
      { date: d1, amountPesewas: -500, reference: 'CHG', description: 'Bank charges', balanceAfterPesewas: 104_500 },
      { date: d1, amountPesewas: 7_000, reference: 'TRF', balanceAfterPesewas: 111_500 },
    ]);
    expect(second).toMatchObject({ imported: 1, duplicates: 1 });
    await expect(db.transaction((tx) => importBankStatement(tx, seed.manager, { bankAccountId: bankId, lines: [{ date: d1, amountPesewas: 1 }] }))).rejects.toMatchObject({
      reason: 'NOT_PERMITTED',
    });
    expect((await listBankStatementLines(db, finance(), { bankAccountId: bankId })).lines).toHaveLength(3);
  });
});

describe('matching a deposit to the bank statement', () => {
  it('an exact match moves cash in transit into the bank account', async () => {
    const { depositId } = await deposit(5_000);
    await importLines([{ date: nextDay(day).day, amountPesewas: 5_000, reference: 'SLIP-001' }]);
    const statementLineId = await lineId('SLIP-001');
    const match = await db.transaction((tx) => matchBankDeposit(tx, finance(), { depositId, statementLineId }));
    expect(match).toMatchObject({ differencePesewas: 0, caseId: null });
    expect([await transit(), await bankBalance(), await variance()]).toEqual([0, 5_000, 0]);
    expect((await listBankAccounts(db, finance(), {})).bankAccounts[0]).toMatchObject({ balancePesewas: 5_000, accountNumberLast4: '1234' });
    const { deposits } = await listBankDeposits(db, finance(), { status: 'MATCHED' });
    expect(deposits[0]).toMatchObject({ status: 'MATCHED', match: { statementLineId, bankAmountPesewas: 5_000, differencePesewas: 0, matchedBy: 'finance-1' } });
    expect(await findBalanceMismatches(db)).toEqual([]);
  });

  it('a short bank line posts the difference to variance and opens a case', async () => {
    const { depositId } = await deposit(5_000);
    await importLines([{ date: nextDay(day).day, amountPesewas: 4_900, reference: 'SLIP-001' }]);
    const statementLineId = await lineId('SLIP-001');
    const result = await db.transaction((tx) => matchBankDeposit(tx, finance(), { depositId, statementLineId }));
    expect(result.differencePesewas).toBe(-100);
    expect([await transit(), await bankBalance(), await variance()]).toEqual([0, 4_900, 100]);
    const { cases } = await listCases(db, seed.manager, {});
    expect(cases).toEqual([expect.objectContaining({ id: result.caseId, kind: 'DEPOSIT_DIFFERENCE', amountPesewas: -100, status: 'OPEN' })]);
  });

  it('suggests the right statement line first', async () => {
    await deposit(5_000);
    const { day: d1 } = nextDay(day);
    await importLines([
      { date: d1, amountPesewas: 5_000, reference: 'OTHER' },
      { date: d1, amountPesewas: 4_000, reference: 'SLIP-001 partial' },
      { date: d1, amountPesewas: 5_000, reference: 'Cash dep SLIP-001' },
      { date: d1, amountPesewas: -5_000, reference: 'SLIP-001' },
    ]);
    const { deposits } = await listBankDeposits(db, finance(), { status: 'UNMATCHED' });
    expect(deposits[0]!.candidates.map((c) => [c.reference, c.sameAmount, c.referenceMatches])).toEqual([
      ['Cash dep SLIP-001', true, true],
      ['OTHER', true, false],
      ['SLIP-001 partial', false, true],
    ]);
  });

  it('refuses the depositor, a second match, a reused or set-aside line, a debit, an earlier line and another account', async () => {
    const { depositId } = await deposit(3_000);
    const { depositId: second } = await deposit(3_000, { slipReference: 'SLIP-002' });
    const { day: d1 } = nextDay(day);
    await importLines([
      { date: d1, amountPesewas: 3_000, reference: 'A' },
      { date: d1, amountPesewas: 3_000, reference: 'B' },
      { date: d1, amountPesewas: -3_000, reference: 'DEBIT' },
      { date: day, amountPesewas: 3_000, reference: 'EARLY' },
    ]);
    // Look the line up first: PGlite has one connection, so a query on `db` inside the transaction would wait for it.
    const match = async (dep: string, ref: string, who = finance()) => {
      const statementLineId = await lineId(ref);
      return db.transaction((tx) => matchBankDeposit(tx, who, { depositId: dep, statementLineId }));
    };

    // Only head-office finance matches; the database also refuses the depositor if roles ever overlap.
    await expect(match(depositId, 'A', seed.cashier)).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
    await expect(match(depositId, 'DEBIT')).rejects.toMatchObject({ reason: 'INVALID_COMMAND' });
    await expect(match(depositId, 'EARLY')).rejects.toMatchObject({ reason: 'INVALID_COMMAND' });

    const bId = await lineId('B');
    await db.transaction((tx) => ignoreBankStatementLine(tx, finance(), { statementLineId: bId, reason: 'Transfer from head office' }));
    await expect(match(second, 'B')).rejects.toMatchObject({ reason: 'CONFLICT' });

    await match(depositId, 'A');
    await expect(match(depositId, 'A')).rejects.toMatchObject({ reason: 'CONFLICT' });
    await expect(match(second, 'A')).rejects.toMatchObject({ reason: 'CONFLICT' });
    await expect(db.transaction((tx) => ignoreBankStatementLine(tx, finance(), { statementLineId: bId, reason: 'again' }))).rejects.toMatchObject({
      reason: 'CONFLICT',
    });

    const otherBank = await bankAccount(db, seed, '5678');
    await db.transaction((tx) => importBankStatement(tx, finance(), { bankAccountId: otherBank, lines: [{ date: d1, amountPesewas: 3_000, reference: 'OTHER-BANK' }] }));
    await expect(match(second, 'OTHER-BANK')).rejects.toMatchObject({ reason: 'INVALID_COMMAND' });

    const statuses = (await listBankStatementLines(db, finance(), { bankAccountId: bankId })).lines.map((l) => [l.reference, l.status]).sort();
    expect(statuses).toEqual([['A', 'MATCHED'], ['B', 'IGNORED'], ['DEBIT', 'UNMATCHED'], ['EARLY', 'UNMATCHED']]);
  });

  it('the database refuses a match by the depositor and any change to bank records', async () => {
    const { depositId } = await deposit(2_000);
    await importLines([{ date: nextDay(day).day, amountPesewas: 2_000, reference: 'X' }]);
    const line = await lineId('X');
    const batch = (await db.query<{ batch_id: string }>('select batch_id from bank_deposits where id = $1', [depositId])).rows[0]!.batch_id;
    await expect(
      db.query(
        `insert into bank_matches (deposit_id, statement_line_id, difference_pesewas, matched_by, batch_id) values ($1, $2, 0, 'cashier-1', $3)`,
        [depositId, line, batch],
      ),
    ).rejects.toThrow(/cannot match it/);
    for (const sql of [
      `update bank_deposits set amount_pesewas = 1`,
      `delete from bank_deposits`,
      `update bank_statement_lines set amount_pesewas = 1`,
      `delete from bank_deposit_days`,
      `update bank_accounts set account_number_last4 = '0000'`,
    ]) {
      await expect(db.query(sql)).rejects.toThrow();
    }
  });
});
