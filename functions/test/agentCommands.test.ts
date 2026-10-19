import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { processAgentCommand } from '../src/commands/processAgentCommand.js';
import type { Database } from '../src/db/types.js';
import { findLedgerAccountId, getBalance } from '../src/ledger/accounts.js';
import { createBranch } from '../src/org/branches.js';
import { revokeDevice } from '../src/org/devices.js';
import { addActiveMember, freshDatabase, phoneKey, randomUUID, seedBranch, signedCollection, GADUFIA } from './helpers.js';

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
  const id = await findLedgerAccountId(db, 'MEMBER_SUSU', susuAccountId, GADUFIA);
  return getBalance(db, id!);
}

async function custodyBalance() {
  const id = await findLedgerAccountId(db, 'AGENT_CASH_CUSTODY', seed.agentPairId, GADUFIA);
  return getBalance(db, id!);
}

const send = (c: { id: string; body: unknown }) => processAgentCommand(db, c.id, c.body);

describe('offline collection commands', () => {
  it('posts a collection to the ledger, records it, and queues an SMS receipt', async () => {
    const c = signedCollection(seed.key, { ...seed, amountPesewas: 2_000 });
    const result = await send(c);

    expect(result.status).toBe('POSTED');
    expect(await memberBalance(seed.susuAccountId)).toBe(2_000);
    expect(await custodyBalance()).toBe(2_000);

    const collection = await db.query<{ amount_pesewas: number; branch_id: string }>(
      'select amount_pesewas, branch_id from collections where id = $1',
      [c.id],
    );
    expect(collection.rows[0]).toMatchObject({ amount_pesewas: 2_000, branch_id: seed.branchId });

    const sms = await db.query<{ payload: { to: string; values: { amount: string; balance: string } } }>(
      `select payload from outbox where dedupe_key = $1`,
      [`sms:collection:${c.id}`],
    );
    expect(sms.rows[0]!.payload.to).toBe('+233241234567');
    expect(sms.rows[0]!.payload.values).toMatchObject({ amount: 'GH₵ 20.00', balance: 'GH₵ 20.00' });
  });

  it('posts once when the same command is delivered again', async () => {
    const c = signedCollection(seed.key, { ...seed, amountPesewas: 1_500 });
    const first = await send(c);
    const second = await send(c);
    expect(second).toMatchObject({ status: 'POSTED', postingId: first.status === 'POSTED' ? first.postingId : '' });
    expect(await memberBalance(seed.susuAccountId)).toBe(1_500);
    expect((await db.query('select 1 from outbox')).rowCount).toBe(1);
  });

  it('records ten offline collections exactly once each, in any arrival order', async () => {
    const commands = Array.from({ length: 10 }, (_, i) => signedCollection(seed.key, { ...seed, seq: i + 1, amountPesewas: 1_000 }));
    for (const c of [...commands].reverse()) await send(c);
    for (const c of commands) await send(c); // full resync
    expect(await memberBalance(seed.susuAccountId)).toBe(10_000);
    expect(await custodyBalance()).toBe(10_000);
  });

  it('rejects a phone that is not bound', async () => {
    const result = await send(signedCollection(seed.key, { ...seed, deviceId: 'stranger' }));
    expect(result).toMatchObject({ status: 'REJECTED', reason: 'DEVICE_NOT_BOUND' });
    expect(await memberBalance(seed.susuAccountId)).toBe(0);
  });

  it('rejects a revoked phone', async () => {
    await db.transaction((tx) => revokeDevice(tx, seed.manager, { deviceId: seed.deviceId, reason: 'Phone lost' }));
    const result = await send(signedCollection(seed.key, seed));
    expect(result).toMatchObject({ status: 'REJECTED', reason: 'DEVICE_REVOKED' });
  });

  it('rejects a phone used by a different agent than it is bound to', async () => {
    const result = await send(signedCollection(seed.key, { ...seed, agentUid: 'agent-b' }));
    expect(result).toMatchObject({ status: 'REJECTED', reason: 'DEVICE_AGENT_MISMATCH' });
  });

  it('rejects a reused sequence number from a different command', async () => {
    await send(signedCollection(seed.key, { ...seed, seq: 7 }));
    const result = await send(signedCollection(seed.key, { ...seed, seq: 7 }));
    expect(result).toMatchObject({ status: 'REJECTED', reason: 'SEQUENCE_REUSED' });
    expect(await memberBalance(seed.susuAccountId)).toBe(2_000);
  });

  it('rejects a member from another branch', async () => {
    const other = await db.transaction((tx) => createBranch(tx, seed.admin, { name: 'Accra', code: 'ACC-01' }));
    const outsider = await addActiveMember(db, other.branchId, seed.admin, { ...seed.admin, uid: 'admin-2' }, seed.productId);
    const result = await send(signedCollection(seed.key, outsider));
    expect(result).toMatchObject({ status: 'REJECTED', reason: 'ACCOUNT_OUTSIDE_BRANCH' });
  });

  it('rejects a member/account mismatch', async () => {
    const result = await send(signedCollection(seed.key, { memberId: randomUUID(), susuAccountId: seed.susuAccountId }));
    expect(result).toMatchObject({ status: 'REJECTED', reason: 'INVALID_COMMAND' });
  });

  it('rejects malformed commands without touching the ledger', async () => {
    const tooBig = signedCollection(seed.key, { ...seed, amountPesewas: 1_000_001 });
    const decimal = signedCollection(seed.key, { ...seed, amountPesewas: 10.5 });
    const unsigned = signedCollection(seed.key, seed);
    const { sig: _sig, ...withoutSig } = unsigned.body;
    for (const bad of [tooBig.body, decimal.body, withoutSig, { type: 'TRANSFER' }, null]) {
      const result = await processAgentCommand(db, randomUUID(), bad);
      expect(result).toMatchObject({ status: 'REJECTED', reason: 'INVALID_COMMAND' });
    }
    expect(await processAgentCommand(db, 'not-a-uuid', unsigned.body)).toMatchObject({ reason: 'INVALID_COMMAND' });
    expect((await db.query('select 1 from journal_batches')).rowCount).toBe(0);
  });

  it('gives the same answer when a rejected command is retried', async () => {
    await db.transaction((tx) => revokeDevice(tx, seed.manager, { deviceId: seed.deviceId, reason: 'Phone lost' }));
    const c = signedCollection(seed.key, seed);
    const first = await send(c);
    const second = await send(c);
    expect(second).toMatchObject({ status: 'REJECTED', reason: first.status === 'REJECTED' ? first.reason : '' });
  });
});

describe('H2 — commands must be signed by the bound phone', () => {
  it('rejects a command signed by another key (stolen password, different device)', async () => {
    const attacker = phoneKey();
    const result = await send(signedCollection(attacker, seed));
    expect(result).toMatchObject({ status: 'REJECTED', reason: 'INVALID_SIGNATURE' });
    expect(await memberBalance(seed.susuAccountId)).toBe(0);
  });

  it('rejects a genuine signature replayed onto a different amount', async () => {
    const genuine = signedCollection(seed.key, { ...seed, amountPesewas: 1_000 });
    const tampered = { ...genuine.body, payload: { ...genuine.body.payload, amountPesewas: 99_000 } };
    expect(await processAgentCommand(db, genuine.id, tampered)).toMatchObject({ reason: 'INVALID_SIGNATURE' });
  });

  it('rejects a genuine signature moved to a different command ID', async () => {
    const genuine = signedCollection(seed.key, seed);
    expect(await processAgentCommand(db, randomUUID(), genuine.body)).toMatchObject({ reason: 'INVALID_SIGNATURE' });
  });

  it('rejects a phone bound before keys existed', async () => {
    await db.query(
      `insert into devices (id, agent_uid, agent_pair_id, bound_by) values ('legacy', 'agent-b', $1, 'manager-1')`,
      [seed.agentPairId],
    );
    const result = await send(signedCollection(seed.key, { ...seed, deviceId: 'legacy', agentUid: 'agent-b' }));
    expect(result).toMatchObject({ status: 'REJECTED', reason: 'DEVICE_NOT_ENROLLED' });
  });
});

describe('M7 — the agent must still be active and still in the bound pair', () => {
  it('rejects a disabled agent', async () => {
    await db.query(`update staff_users set status = 'DISABLED' where uid = 'agent-a'`);
    expect(await send(signedCollection(seed.key, seed))).toMatchObject({ reason: 'AGENT_NOT_ACTIVE' });
  });

  it('rejects an inactive pair', async () => {
    await db.query(`update agent_pairs set status = 'INACTIVE' where id = $1`, [seed.agentPairId]);
    expect(await send(signedCollection(seed.key, seed))).toMatchObject({ reason: 'AGENT_PAIR_NOT_ACTIVE' });
  });

  it('rejects an agent who has moved to another pair', async () => {
    await db.query(`delete from agent_pair_members where agent_uid = 'agent-a'`);
    expect(await send(signedCollection(seed.key, seed))).toMatchObject({ reason: 'AGENT_NOT_IN_PAIR' });
    expect(await custodyBalance()).toBe(0);
  });
});
