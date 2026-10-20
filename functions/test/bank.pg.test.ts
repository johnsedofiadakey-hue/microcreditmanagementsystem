import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { recordBankDeposit } from '../src/bank/deposits.js';
import { ignoreBankStatementLine, importBankStatement, matchBankDeposit } from '../src/bank/statements.js';
import { migrate } from '../src/db/migrate.js';
import { createPgDatabase } from '../src/db/pg.js';
import type { Database } from '../src/db/types.js';
import { findBalanceMismatches } from '../src/ledger/reconcile.js';
import { seedBranch } from './helpers.js';
import { bankAccount, closedDay, finance, nextDay, type Seed } from './bankHelpers.js';

/** Bank races on real Postgres (PGlite runs one transaction at a time). Runs with `corepack pnpm test:pg`. */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('bank deposits and matches under concurrency', () => {
  let db: Database;
  let seed: Seed;
  let day: string;
  let bankId: string;

  beforeAll(async () => {
    db = createPgDatabase(url!, 20);
  });

  afterAll(async () => {
    await db?.close();
  });

  beforeEach(async () => {
    await db.exec('drop schema public cascade; create schema public;');
    await migrate(db);
    seed = await seedBranch(db);
    ({ day } = await closedDay(db, seed, [5_000]));
    bankId = await bankAccount(db, seed);
  });

  const deposit = (amountPesewas: number, slip: string) => {
    const { day: next, morning } = nextDay(day);
    return db.transaction((tx) =>
      recordBankDeposit(
        tx,
        seed.cashier,
        { branchId: seed.branchId, businessId: seed.businessId, bankAccountId: bankId, amountPesewas, slipReference: slip, depositedOn: next, days: [{ day, amountPesewas }] },
        morning,
      ),
    );
  };

  it('two simultaneous deposits that together exceed the close: exactly one succeeds', async () => {
    const results = await Promise.allSettled([deposit(3_000, 'A'), deposit(3_000, 'B')]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const banked = await db.query<{ total: number }>('select coalesce(sum(amount_pesewas), 0)::bigint as total from bank_deposit_days');
    expect(banked.rows[0]!.total).toBe(3_000);
    expect(await findBalanceMismatches(db)).toEqual([]);
  });

  it('one statement line, matched and set aside at the same moment: exactly one wins', async () => {
    const { depositId } = await deposit(2_000, 'A');
    await db.transaction((tx) => importBankStatement(tx, finance(), { bankAccountId: bankId, lines: [{ date: nextDay(day).day, amountPesewas: 2_000, reference: 'A' }] }));
    const statementLineId = (await db.query<{ id: string }>('select id from bank_statement_lines')).rows[0]!.id;
    const results = await Promise.allSettled([
      db.transaction((tx) => matchBankDeposit(tx, finance(), { depositId, statementLineId })),
      db.transaction((tx) => ignoreBankStatementLine(tx, { ...finance(), uid: 'finance-2' }, { statementLineId, reason: 'Not a deposit' })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const used = await db.query<{ n: number }>(
      'select ((select count(*) from bank_matches) + (select count(*) from bank_line_ignores))::bigint as n',
    );
    expect(used.rows[0]!.n).toBe(1);
  });

  it('two deposits raced onto the same statement line: exactly one is matched', async () => {
    const { depositId: a } = await deposit(2_000, 'A');
    const { depositId: b } = await deposit(2_000, 'B');
    await db.transaction((tx) => importBankStatement(tx, finance(), { bankAccountId: bankId, lines: [{ date: nextDay(day).day, amountPesewas: 2_000, reference: 'AB' }] }));
    const statementLineId = (await db.query<{ id: string }>('select id from bank_statement_lines')).rows[0]!.id;
    const results = await Promise.allSettled([
      db.transaction((tx) => matchBankDeposit(tx, finance(), { depositId: a, statementLineId })),
      db.transaction((tx) => matchBankDeposit(tx, { ...finance(), uid: 'finance-2' }, { depositId: b, statementLineId })),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await db.query('select 1 from bank_matches')).rowCount).toBe(1);
    expect(await findBalanceMismatches(db)).toEqual([]);
  });
});
