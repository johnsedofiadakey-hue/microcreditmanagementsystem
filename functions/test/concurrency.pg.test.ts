import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processAgentCommand } from '../src/commands/processAgentCommand.js';
import { migrate } from '../src/db/migrate.js';
import { createPgDatabase } from '../src/db/pg.js';
import type { Database } from '../src/db/types.js';
import { findLedgerAccountId, getBalance } from '../src/ledger/accounts.js';
import { findBalanceMismatches } from '../src/ledger/reconcile.js';
import { dispatchSmsOutbox } from '../src/messaging/dispatch.js';
import { closeBranchDay, submitBranchCount } from '../src/cash/close.js';
import { today } from '../src/cash/common.js';
import { recordHandover } from '../src/cash/handovers.js';
import { approveWithdrawal, payWithdrawal, requestWithdrawal } from '../src/cash/withdrawals.js';
import { actor } from './helpers.js';
import type { SmsMessage, SmsProvider } from '../src/messaging/providers.js';
import { createAgentPair } from '../src/org/agentPairs.js';
import { recordStaffUser } from '../src/org/staff.js';
import { seedBranch, signedCollection } from './helpers.js';

/**
 * Runs only with TEST_DATABASE_URL pointing at a disposable Postgres database (it drops the public schema).
 *   corepack pnpm test:pg
 */
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('real Postgres under concurrency', () => {
  let db: Database;
  let seed: Awaited<ReturnType<typeof seedBranch>>;

  beforeAll(async () => {
    db = createPgDatabase(url!, 20);
    await db.exec('drop schema public cascade; create schema public;');
    await migrate(db);
    seed = await seedBranch(db);
  });

  afterAll(async () => {
    await db?.close();
  });

  it('50 simultaneous collections, each delivered twice, all land exactly once and cleanly', async () => {
    const commands = Array.from({ length: 50 }, (_, i) =>
      signedCollection(seed.key, { ...seed, seq: i + 1, amountPesewas: 1_000 }),
    );
    const results = await Promise.all([...commands, ...commands].map((c) => processAgentCommand(db, c.id, c.body)));
    // With the per-device lock, racing duplicates resolve as replays: no retryable errors at all.
    expect(results.every((r) => r.status === 'POSTED')).toBe(true);

    const custody = await findLedgerAccountId(db, 'AGENT_CASH_CUSTODY', seed.agentPairId);
    const member = await findLedgerAccountId(db, 'MEMBER_SUSU', seed.susuAccountId);
    expect(await getBalance(db, custody!)).toBe(50_000);
    expect(await getBalance(db, member!)).toBe(50_000);
    expect((await db.query('select 1 from collections')).rowCount).toBe(50);
    expect(await findBalanceMismatches(db)).toEqual([]);
  });

  it('two simultaneous pairings of the same agent: exactly one succeeds', async () => {
    for (const uid of ['agent-x', 'agent-y', 'agent-z']) {
      await db.transaction((tx) =>
        recordStaffUser(tx, seed.admin, uid, { email: `${uid}@example.test`, displayName: uid, role: 'AGENT', branchIds: [seed.branchId] }),
      );
    }
    const attempts = await Promise.allSettled([
      db.transaction((tx) => createAgentPair(tx, seed.manager, { branchId: seed.branchId, name: 'XY', agentAUid: 'agent-x', agentBUid: 'agent-y' })),
      db.transaction((tx) => createAgentPair(tx, seed.manager, { branchId: seed.branchId, name: 'XZ', agentAUid: 'agent-x', agentBUid: 'agent-z' })),
    ]);
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(1);
    const memberships = await db.query('select 1 from agent_pair_members where agent_uid = $1', ['agent-x']);
    expect(memberships.rowCount).toBe(1);
  });

  it('five dispatchers racing over the outbox send every receipt exactly once', async () => {
    const sent: SmsMessage[] = [];
    const slowProvider: SmsProvider = {
      name: 'race',
      async send(message) {
        sent.push(message);
        await new Promise((resolve) => setTimeout(resolve, 5));
        return { ok: true, providerMessageId: null };
      },
    };
    const pending = await db.query<{ n: number }>(`select count(*)::int as n from outbox where status = 'PENDING'`);
    expect(pending.rows[0]!.n).toBeGreaterThanOrEqual(50);
    await Promise.all(Array.from({ length: 5 }, () => dispatchSmsOutbox(db, slowProvider, { brand: 'Susu', limit: 20 })));
    await dispatchSmsOutbox(db, slowProvider, { brand: 'Susu', limit: 200 });
    const references = sent.map((m) => m.reference);
    expect(new Set(references).size).toBe(references.length);
    expect(references.length).toBe(pending.rows[0]!.n);
    expect((await db.query(`select 1 from outbox where status <> 'SENT'`)).rowCount).toBe(0);
  });

  it('cash day races: one payout per withdrawal, and a payout never slips past a close', async () => {
    const custodyId = await findLedgerAccountId(db, 'AGENT_CASH_CUSTODY', seed.agentPairId);
    const expected = await getBalance(db, custodyId!);
    await db.transaction((tx) => recordHandover(tx, seed.cashier, { agentPairId: seed.agentPairId, expectedPesewas: expected, countedPesewas: expected }));
    const cashier2 = actor('cashier-2', 'CASHIER', [seed.branchId]);
    const manager2 = actor('manager-2', 'BRANCH_MANAGER', [seed.branchId]);

    const first = await db.transaction((tx) => requestWithdrawal(tx, seed.cashier, { susuAccountId: seed.susuAccountId, amountPesewas: 1_000, reason: 'race' }));
    await db.transaction((tx) => approveWithdrawal(tx, seed.manager, { withdrawalId: first.withdrawalId }));
    const payouts = await Promise.allSettled([
      db.transaction((tx) => payWithdrawal(tx, cashier2, { withdrawalId: first.withdrawalId })),
      db.transaction((tx) => payWithdrawal(tx, manager2, { withdrawalId: first.withdrawalId })),
    ]);
    expect(payouts.filter((p) => p.status === 'fulfilled')).toHaveLength(1);
    expect((await db.query(`select 1 from journal_batches where kind = 'WITHDRAWAL_PAYOUT'`)).rowCount).toBe(1);

    const second = await db.transaction((tx) => requestWithdrawal(tx, seed.cashier, { susuAccountId: seed.susuAccountId, amountPesewas: 2_000, reason: 'race' }));
    await db.transaction((tx) => approveWithdrawal(tx, seed.manager, { withdrawalId: second.withdrawalId }));
    const branchCashId = await findLedgerAccountId(db, 'BRANCH_CASH', seed.branchId);
    const vault = await getBalance(db, branchCashId!);
    await db.transaction((tx) => submitBranchCount(tx, seed.cashier, { branchId: seed.branchId, day: today(), countedPesewas: vault }));
    const raced = await Promise.allSettled([
      db.transaction((tx) => closeBranchDay(tx, manager2, { branchId: seed.branchId, day: today() })),
      db.transaction((tx) => payWithdrawal(tx, cashier2, { withdrawalId: second.withdrawalId })),
    ]);
    const [closeResult, payResult] = raced;
    // Whichever ran first wins; the other is refused for the right reason, never both.
    if (closeResult.status === 'fulfilled') {
      expect(payResult).toMatchObject({ status: 'rejected', reason: { reason: 'BRANCH_DAY_CLOSED' } });
    } else {
      expect(payResult.status).toBe('fulfilled');
      expect(closeResult).toMatchObject({ reason: { reason: 'EXPECTED_CASH_CHANGED' } });
    }
    expect(await findBalanceMismatches(db)).toEqual([]);
  });
});
