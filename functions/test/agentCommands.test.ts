import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { processAgentCommand } from '../src/commands/processAgentCommand.js';
import type { Database } from '../src/db/types.js';
import { findLedgerAccountId, getBalance } from '../src/ledger/accounts.js';
import { addActiveMember, collectionCommand, freshDatabase, randomUUID, seedBranch } from './helpers.js';
import { revokeDevice } from '../src/org/devices.js';
import { createBranch } from '../src/org/branches.js';

let db: Database;
let seed: Awaited<ReturnType<typeof seedBranch>>;

beforeEach(async () => {
  db = await freshDatabase();
  seed = await seedBranch(db);
});

afterEach(async () => {
  await db.close();
});

async function memberBalance(susuAccountId: string) {
  const id = await findLedgerAccountId(db, 'MEMBER_SUSU', susuAccountId);
  return getBalance(db, id!);
}

async function custodyBalance() {
  const id = await findLedgerAccountId(db, 'AGENT_CASH_CUSTODY', seed.agentPairId);
  return getBalance(db, id!);
}

describe('offline collection commands', () => {
  it('posts a collection to the ledger, records it, and queues an SMS receipt', async () => {
    const id = randomUUID();
    const result = await processAgentCommand(db, id, collectionCommand({ ...seed, amountPesewas: 2_000 }));

    expect(result.status).toBe('POSTED');
    expect(await memberBalance(seed.susuAccountId)).toBe(2_000);
    expect(await custodyBalance()).toBe(2_000);

    const collection = await db.query<{ amount_pesewas: number; branch_id: string }>(
      'select amount_pesewas, branch_id from collections where id = $1',
      [id],
    );
    expect(collection.rows[0]).toMatchObject({ amount_pesewas: 2_000, branch_id: seed.branchId });

    const sms = await db.query<{ payload: { to: string; values: { amount: string; balance: string } } }>(
      `select payload from outbox where dedupe_key = $1`,
      [`sms:collection:${id}`],
    );
    expect(sms.rows[0]!.payload.to).toBe('+233241234567');
    expect(sms.rows[0]!.payload.values).toMatchObject({ amount: 'GH₵ 20.00', balance: 'GH₵ 20.00' });
  });

  it('posts once when the same command is delivered again', async () => {
    const id = randomUUID();
    const command = collectionCommand({ ...seed, amountPesewas: 1_500 });
    const first = await processAgentCommand(db, id, command);
    const second = await processAgentCommand(db, id, command);
    expect(second).toMatchObject({ status: 'POSTED', postingId: first.status === 'POSTED' ? first.postingId : '' });
    expect(await memberBalance(seed.susuAccountId)).toBe(1_500);
    expect((await db.query('select 1 from outbox')).rowCount).toBe(1);
  });

  it('records ten offline collections exactly once each, in any arrival order', async () => {
    const commands = Array.from({ length: 10 }, (_, i) => ({
      id: randomUUID(),
      body: collectionCommand({ ...seed, seq: i + 1, amountPesewas: 1_000 }),
    }));
    const shuffled = [...commands].reverse();
    for (const c of shuffled) await processAgentCommand(db, c.id, c.body);
    for (const c of commands) await processAgentCommand(db, c.id, c.body); // full resync
    expect(await memberBalance(seed.susuAccountId)).toBe(10_000);
    expect(await custodyBalance()).toBe(10_000);
  });

  it('rejects a phone that is not bound', async () => {
    const result = await processAgentCommand(db, randomUUID(), collectionCommand({ ...seed, deviceId: 'stranger' }));
    expect(result).toMatchObject({ status: 'REJECTED', reason: 'DEVICE_NOT_BOUND' });
    expect(await memberBalance(seed.susuAccountId)).toBe(0);
  });

  it('rejects a revoked phone', async () => {
    await db.transaction((tx) => revokeDevice(tx, seed.manager, { deviceId: seed.deviceId, reason: 'Phone lost' }));
    const result = await processAgentCommand(db, randomUUID(), collectionCommand(seed));
    expect(result).toMatchObject({ status: 'REJECTED', reason: 'DEVICE_REVOKED' });
  });

  it('rejects a phone used by a different agent than it is bound to', async () => {
    const result = await processAgentCommand(db, randomUUID(), collectionCommand({ ...seed, agentUid: 'agent-b' }));
    expect(result).toMatchObject({ status: 'REJECTED', reason: 'DEVICE_AGENT_MISMATCH' });
  });

  it('rejects a reused sequence number from a different command', async () => {
    await processAgentCommand(db, randomUUID(), collectionCommand({ ...seed, seq: 7 }));
    const result = await processAgentCommand(db, randomUUID(), collectionCommand({ ...seed, seq: 7 }));
    expect(result).toMatchObject({ status: 'REJECTED', reason: 'SEQUENCE_REUSED' });
    expect(await memberBalance(seed.susuAccountId)).toBe(2_000);
  });

  it('rejects a member from another branch', async () => {
    const other = await db.transaction((tx) => createBranch(tx, seed.admin, { name: 'Accra', code: 'ACC-01' }));
    const outsider = await addActiveMember(db, other.branchId, seed.admin, { ...seed.admin, uid: 'admin-2' }, seed.productId);
    const result = await processAgentCommand(db, randomUUID(), collectionCommand(outsider));
    expect(result).toMatchObject({ status: 'REJECTED', reason: 'ACCOUNT_OUTSIDE_BRANCH' });
  });

  it('rejects a member/account mismatch', async () => {
    const result = await processAgentCommand(
      db,
      randomUUID(),
      collectionCommand({ memberId: randomUUID(), susuAccountId: seed.susuAccountId }),
    );
    expect(result).toMatchObject({ status: 'REJECTED', reason: 'INVALID_COMMAND' });
  });

  it('rejects malformed commands without touching the ledger', async () => {
    const tooBig = collectionCommand({ ...seed, amountPesewas: 1_000_001 });
    const decimal = collectionCommand({ ...seed, amountPesewas: 10.5 });
    for (const bad of [tooBig, decimal, { type: 'TRANSFER' }, null]) {
      const result = await processAgentCommand(db, randomUUID(), bad);
      expect(result).toMatchObject({ status: 'REJECTED', reason: 'INVALID_COMMAND' });
    }
    expect((await db.query('select 1 from journal_batches')).rowCount).toBe(0);
  });

  it('gives the same answer when a rejected command is retried', async () => {
    const id = randomUUID();
    await db.transaction((tx) => revokeDevice(tx, seed.manager, { deviceId: seed.deviceId, reason: 'Phone lost' }));
    const first = await processAgentCommand(db, id, collectionCommand(seed));
    const second = await processAgentCommand(db, id, collectionCommand(seed));
    expect(second).toMatchObject({ status: 'REJECTED', reason: first.status === 'REJECTED' ? first.reason : '' });
  });
});
