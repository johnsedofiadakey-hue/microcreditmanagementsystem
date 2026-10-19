import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processAgentCommand } from '../src/commands/processAgentCommand.js';
import { migrate } from '../src/db/migrate.js';
import { createPgDatabase } from '../src/db/pg.js';
import type { Database } from '../src/db/types.js';
import { findLedgerAccountId, getBalance } from '../src/ledger/accounts.js';
import { findBalanceMismatches } from '../src/ledger/reconcile.js';
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
});
