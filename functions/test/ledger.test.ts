import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../src/db/types.js';
import { ensureLedgerAccount, getBalance } from '../src/ledger/accounts.js';
import { postJournal, type PostingRequest } from '../src/ledger/post.js';
import { reverseJournalBatch } from '../src/ledger/reverse.js';
import { DomainError } from '../src/lib/errors.js';
import { actor, freshDatabase, GADUFIA } from './helpers.js';
import { createBranch } from '../src/org/branches.js';

let db: Database;
let branchId: string;
let custody: string;
let member: string;
let branchCash: string;

beforeEach(async () => {
  db = await freshDatabase();
  ({ branchId } = await db.transaction((tx) =>
    createBranch(tx, actor('admin', 'SUPER_ADMIN'), { name: 'Test', code: 'TST' }),
  ));
  await db.transaction(async (tx) => {
    custody = await ensureLedgerAccount(tx, {
      kind: 'AGENT_CASH_CUSTODY',
      ownerId: '11111111-1111-4111-8111-111111111111',
      branchId,
      businessId: GADUFIA,
      name: 'Pair custody',
    });
    member = await ensureLedgerAccount(tx, {
      kind: 'MEMBER_SUSU',
      ownerId: '22222222-2222-4222-8222-222222222222',
      branchId,
      businessId: GADUFIA,
      name: 'Member',
    });
    branchCash = (await tx.query<{ id: string }>(
      `select id from ledger_accounts where kind = 'BRANCH_CASH' and owner_id = $1`,
      [branchId],
    )).rows[0]!.id;
  });
});

afterEach(async () => {
  await db.close();
});

function collection(key: string, amountPesewas: number): PostingRequest {
  return {
    idempotencyKey: key,
    kind: 'SUSU_COLLECTION',
    description: 'test',
    branchId,
    actorUid: 'agent-a',
    channel: 'AGENT_APP',
    lines: [
      { accountId: custody, side: 'DEBIT', amountPesewas },
      { accountId: member, side: 'CREDIT', amountPesewas },
    ],
  };
}

describe('postJournal', () => {
  it('moves both balances by the same amount', async () => {
    await db.transaction((tx) => postJournal(tx, collection('k1', 2_500)));
    expect(await getBalance(db, custody)).toBe(2_500);
    expect(await getBalance(db, member)).toBe(2_500);
  });

  it('posts once when the same request arrives twice', async () => {
    const first = await db.transaction((tx) => postJournal(tx, collection('dup', 1_000)));
    const second = await db.transaction((tx) => postJournal(tx, collection('dup', 1_000)));
    expect(second.batchId).toBe(first.batchId);
    expect(second.replayed).toBe(true);
    expect(await getBalance(db, member)).toBe(1_000);
  });

  it('refuses a reused idempotency key with different content', async () => {
    await db.transaction((tx) => postJournal(tx, collection('reuse', 1_000)));
    await expect(db.transaction((tx) => postJournal(tx, collection('reuse', 9_999)))).rejects.toMatchObject({
      reason: 'IDEMPOTENCY_CONFLICT',
    });
    expect(await getBalance(db, member)).toBe(1_000);
  });

  it('rejects unbalanced batches before touching the database', async () => {
    const bad = collection('unbalanced', 1_000);
    bad.lines[1]!.amountPesewas = 999;
    await expect(db.transaction((tx) => postJournal(tx, bad))).rejects.toBeInstanceOf(DomainError);
    const batches = await db.query('select 1 from journal_batches');
    expect(batches.rowCount).toBe(0);
  });

  it('rejects non-integer and zero amounts', async () => {
    for (const amount of [0, 10.5, -5]) {
      await expect(db.transaction((tx) => postJournal(tx, collection(`bad-${amount}`, amount)))).rejects.toMatchObject({
        reason: 'INVALID_COMMAND',
      });
    }
  });

  it('never lets a member balance go below zero', async () => {
    await db.transaction((tx) => postJournal(tx, collection('in', 1_000)));
    const withdrawal: PostingRequest = {
      idempotencyKey: 'out',
      kind: 'SUSU_WITHDRAWAL',
      description: 'too much',
      branchId,
      actorUid: 'cashier-1',
      approvedBy: 'manager-1',
      channel: 'PORTAL',
      lines: [
        { accountId: member, side: 'DEBIT', amountPesewas: 1_001 },
        { accountId: branchCash, side: 'CREDIT', amountPesewas: 1_001 },
      ],
    };
    await expect(db.transaction((tx) => postJournal(tx, withdrawal))).rejects.toMatchObject({
      reason: 'INSUFFICIENT_BALANCE',
    });
    expect(await getBalance(db, member)).toBe(1_000);
  });

  it('keeps balances equal to the sum of journal lines after many postings', async () => {
    for (let i = 0; i < 40; i++) {
      await db.transaction((tx) => postJournal(tx, collection(`many-${i}`, 100 + i)));
    }
    const lines = await db.query<{ net: number }>(
      `select coalesce(sum(case when side = 'CREDIT' then amount_pesewas else -amount_pesewas end), 0)::bigint as net
         from journal_lines where account_id = $1`,
      [member],
    );
    expect(await getBalance(db, member)).toBe(lines.rows[0]!.net);
  });
});

describe('database guarantees (even if application code is bypassed)', () => {
  it('forbids updating or deleting journal rows', async () => {
    await db.transaction((tx) => postJournal(tx, collection('immutable', 500)));
    await expect(db.query('update journal_lines set amount_pesewas = 1')).rejects.toThrow(/append-only/);
    await expect(db.query('delete from journal_lines')).rejects.toThrow(/append-only/);
    await expect(db.query(`update journal_batches set description = 'x'`)).rejects.toThrow(/append-only/);
    await expect(db.query('delete from journal_batches')).rejects.toThrow(/append-only/);
    await expect(db.query('truncate journal_lines')).rejects.toThrow(/append-only/);
  });

  it('forbids changing audit history', async () => {
    await expect(db.query('delete from audit_events')).rejects.toThrow(/append-only/);
  });

  it('refuses to commit a batch whose lines do not balance', async () => {
    await expect(
      db.transaction(async (tx) => {
        const batch = await tx.query<{ id: string }>(
          `insert into journal_batches (idempotency_key, request_hash, kind, description, actor_uid, channel)
           values ('raw', 'x', 'RAW', 'raw insert', 'attacker', 'SYSTEM') returning id`,
        );
        await tx.query(
          `insert into journal_lines (batch_id, account_id, side, amount_pesewas) values ($1, $2, 'DEBIT', 500)`,
          [batch.rows[0]!.id, custody],
        );
      }),
    ).rejects.toThrow(/unbalanced/);
    expect((await db.query('select 1 from journal_batches')).rowCount).toBe(0);
  });

  it('refuses a batch approved by the person who made it', async () => {
    const selfApproved = { ...collection('self', 100), approvedBy: 'agent-a' };
    await expect(db.transaction((tx) => postJournal(tx, selfApproved))).rejects.toThrow();
  });
});

describe('reverseJournalBatch', () => {
  it('posts an equal and opposite batch and leaves the original untouched', async () => {
    const original = await db.transaction((tx) => postJournal(tx, collection('orig', 3_000)));
    const reversal = await db.transaction((tx) =>
      reverseJournalBatch(tx, {
        batchId: original.batchId,
        idempotencyKey: 'rev-1',
        reason: 'Wrong member selected',
        requestedBy: 'manager-1',
        approvedBy: 'admin-1',
        channel: 'PORTAL',
      }),
    );
    expect(reversal.batchId).not.toBe(original.batchId);
    expect(await getBalance(db, member)).toBe(0);
    expect(await getBalance(db, custody)).toBe(0);
    const originalLines = await db.query('select 1 from journal_lines where batch_id = $1', [original.batchId]);
    expect(originalLines.rowCount).toBe(2);
  });

  it('cannot be self-approved', async () => {
    const original = await db.transaction((tx) => postJournal(tx, collection('orig2', 3_000)));
    await expect(
      db.transaction((tx) =>
        reverseJournalBatch(tx, {
          batchId: original.batchId,
          idempotencyKey: 'rev-self',
          reason: 'Oops',
          requestedBy: 'manager-1',
          approvedBy: 'manager-1',
          channel: 'PORTAL',
        }),
      ),
    ).rejects.toMatchObject({ reason: 'SELF_APPROVAL_FORBIDDEN' });
  });

  it('reverses a batch only once', async () => {
    const original = await db.transaction((tx) => postJournal(tx, collection('orig3', 3_000)));
    const request = {
      batchId: original.batchId,
      reason: 'Duplicate entry',
      requestedBy: 'manager-1',
      approvedBy: 'admin-1',
      channel: 'PORTAL' as const,
    };
    await db.transaction((tx) => reverseJournalBatch(tx, { ...request, idempotencyKey: 'rev-a' }));
    // Same key again is a harmless replay
    await db.transaction((tx) => reverseJournalBatch(tx, { ...request, idempotencyKey: 'rev-a' }));
    // A different key is a second reversal attempt
    await expect(
      db.transaction((tx) => reverseJournalBatch(tx, { ...request, idempotencyKey: 'rev-b' })),
    ).rejects.toMatchObject({ reason: 'ALREADY_REVERSED' });
    expect(await getBalance(db, member)).toBe(0);
  });
});
