import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { processAgentCommand } from '../src/commands/processAgentCommand.js';
import { migrate } from '../src/db/migrate.js';
import { createPgDatabase } from '../src/db/pg.js';
import type { Database } from '../src/db/types.js';
import { findLedgerAccountId, getBalance } from '../src/ledger/accounts.js';
import { collectionCommand, seedBranch } from './helpers.js';

/**
 * Runs only with TEST_DATABASE_URL pointing at a disposable Postgres database (it drops the public schema).
 *   createdb susu_test && TEST_DATABASE_URL=postgresql:///susu_test corepack pnpm --filter @susu/functions test
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

  it('50 simultaneous collections into one pair custody account all land exactly once', async () => {
    const commands = Array.from({ length: 50 }, (_, i) => ({
      id: randomUUID(),
      body: collectionCommand({ ...seed, seq: i + 1, amountPesewas: 1_000 }),
    }));
    // Every command delivered twice, all at once.
    const results = await Promise.all(
      [...commands, ...commands].map((c) => processAgentCommand(db, c.id, c.body).catch((e: unknown) => e)),
    );
    const failures = results.filter((r) => !(r && typeof r === 'object' && 'status' in r));
    // A racing duplicate may surface as a retryable infrastructure error; the trigger retries those.
    for (const c of commands) await processAgentCommand(db, c.id, c.body);

    const custody = await findLedgerAccountId(db, 'AGENT_CASH_CUSTODY', seed.agentPairId);
    const member = await findLedgerAccountId(db, 'MEMBER_SUSU', seed.susuAccountId);
    expect(await getBalance(db, custody!)).toBe(50_000);
    expect(await getBalance(db, member!)).toBe(50_000);
    expect((await db.query('select 1 from collections')).rowCount).toBe(50);
    expect((await db.query('select 1 from journal_batches')).rowCount).toBe(50);
    expect(failures.length).toBeLessThan(50);
  });
});
