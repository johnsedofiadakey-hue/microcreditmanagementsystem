import { CORRECTION_HEAD_OFFICE_THRESHOLD_PESEWAS } from '@susu/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { today } from '../src/cash/common.js';
import { approveCorrection, listCorrections, rejectCorrection, requestCollectionCorrection } from '../src/cash/corrections.js';
import { approveWithdrawal, payWithdrawal, requestWithdrawal } from '../src/cash/withdrawals.js';
import { processAgentCommand } from '../src/commands/processAgentCommand.js';
import type { Database } from '../src/db/types.js';
import { findLedgerAccountId, getBalance } from '../src/ledger/accounts.js';
import { findBalanceMismatches } from '../src/ledger/reconcile.js';
import { createBranch } from '../src/org/branches.js';
import { getAccountStatement } from '../src/reads/members.js';
import { computeBranchDay, correctionDays, recentlyCorrectedDays } from '../src/reads/dashboards.js';
import { actor, addActiveMember, freshDatabase, seedBranch, signedCollection } from './helpers.js';
import { handedOver } from './bankHelpers.js';

let db: Database;
let seed: Awaited<ReturnType<typeof seedBranch>>;
let seq = 0;
let other: { memberId: string; susuAccountId: string };
const finance = () => actor('finance-1', 'FINANCE');
const supervisor = () => actor('supervisor-1', 'SUPERVISOR', [seed.branchId]);

beforeEach(async () => {
  db = await freshDatabase();
  seed = await seedBranch(db);
  seq = 0;
  other = await addActiveMember(db, seed.branchId, seed.cashier, seed.manager, seed.productId);
});

afterEach(async () => {
  await db.close();
});

/** Post a signed collection from the bound phone; returns its journal batch. */
async function collect(amountPesewas: number, account = seed): Promise<string> {
  seq += 1;
  const c = signedCollection(seed.key, { memberId: account.memberId, susuAccountId: account.susuAccountId, amountPesewas, seq });
  const result = await processAgentCommand(db, c.id, c.body);
  if (result.status !== 'POSTED') throw new Error(`collection ${result.status}`);
  return result.postingId;
}

const balance = async (kind: Parameters<typeof findLedgerAccountId>[1], owner: string) =>
  getBalance(db, (await findLedgerAccountId(db, kind, owner, seed.businessId))!);
const memberA = () => balance('MEMBER_SUSU', seed.susuAccountId);
const memberB = () => balance('MEMBER_SUSU', other.susuAccountId);
const custody = () => balance('AGENT_CASH_CUSTODY', seed.agentPairId);

const request = (input: Parameters<typeof requestCollectionCorrection>[2], who = seed.cashier) =>
  db.transaction((tx) => requestCollectionCorrection(tx, who, input));
const approve = (correctionId: string, who = seed.manager) => db.transaction((tx) => approveCorrection(tx, who, { correctionId }));
const reject = (correctionId: string, reason = 'Agent confirmed it was right', who = seed.manager) =>
  db.transaction((tx) => rejectCorrection(tx, who, { correctionId, reason }));

const REASON = 'Agent tapped the wrong member on the route';

describe('the three kinds of correction', () => {
  it('MOVE_COLLECTION moves the money to the right member; the cash is untouched', async () => {
    const batch = await collect(2_000);
    const { correctionId, needsHeadOffice } = await request({ collectionBatchId: batch, kind: 'MOVE_COLLECTION', toSusuAccountId: other.susuAccountId, reason: REASON });
    expect(needsHeadOffice).toBe(false);
    expect([await memberA(), await memberB()]).toEqual([2_000, 0]); // nothing moves before approval

    const { batchId } = await approve(correctionId);
    expect([await memberA(), await memberB(), await custody()]).toEqual([0, 2_000, 2_000]);

    const posted = (await db.query<{ actor_uid: string; approved_by: string; kind: string }>('select actor_uid, approved_by, kind from journal_batches where id = $1', [batchId])).rows[0];
    expect(posted).toEqual({ actor_uid: 'cashier-1', approved_by: 'manager-1', kind: 'CORRECTION:MOVE_COLLECTION' });

    const statement = await getAccountStatement(db, seed.cashier, { susuAccountId: seed.susuAccountId });
    expect(statement.lines.map((l) => [l.kind, l.debitPesewas, l.creditPesewas, l.balanceAfterPesewas])).toEqual([
      ['CORRECTION:MOVE_COLLECTION', 2_000, 0, 0],
      ['SUSU_COLLECTION', 0, 2_000, 2_000],
    ]);
    const { corrections } = await listCorrections(db, seed.manager, {});
    expect(corrections[0]).toMatchObject({ id: correctionId, status: 'APPROVED', memberName: 'Ama Mensah', toMemberName: 'Ama Mensah', amountPesewas: 2_000, decision: { decision: 'APPROVED', decidedBy: 'manager-1', batchId } });
  });

  it('REVERSE_COLLECTION mirrors the collection exactly (member and pair custody)', async () => {
    const batch = await collect(2_000);
    const { correctionId } = await request({ collectionBatchId: batch, kind: 'REVERSE_COLLECTION', reason: 'Member says she did not pay today' });
    const { batchId } = await approve(correctionId);
    expect([await memberA(), await custody()]).toEqual([0, 0]);
    const reversal = (await db.query<{ reverses_batch_id: string }>('select reverses_batch_id from journal_batches where id = $1', [batchId])).rows[0]!;
    expect(reversal.reverses_batch_id).toBe(batch);
  });

  it('REDUCE_COLLECTION takes off only the excess', async () => {
    const batch = await collect(5_000);
    const { correctionId } = await request({ collectionBatchId: batch, kind: 'REDUCE_COLLECTION', correctPesewas: 3_000, reason: 'GH₵ 50 typed instead of GH₵ 30' });
    await approve(correctionId);
    expect([await memberA(), await custody()]).toEqual([3_000, 3_000]);
    await expect(request({ collectionBatchId: batch, kind: 'REDUCE_COLLECTION', correctPesewas: 1_000, reason: 'second try at it' })).rejects.toMatchObject({ reason: 'CONFLICT' });
  });

  it('the books still reconcile and today’s dashboard shows collections net of reversals', async () => {
    const b1 = await collect(2_000);
    await collect(3_000);
    await approve((await request({ collectionBatchId: b1, kind: 'REVERSE_COLLECTION', reason: 'Member says she did not pay today' })).correctionId);
    expect((await computeBranchDay(db, seed.branchId, today())).collectedPesewas).toBe(3_000);
    expect(await findBalanceMismatches(db)).toEqual([]);
  });
});

describe('maker-checker', () => {
  it('the requester cannot decide; a cashier cannot approve; supervisors can request', async () => {
    const batch = await collect(2_000);
    const { correctionId } = await request({ collectionBatchId: batch, kind: 'REVERSE_COLLECTION', reason: REASON }, supervisor());
    await expect(approve(correctionId, supervisor())).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
    await expect(approve(correctionId, seed.cashier)).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
    const own = await request({ collectionBatchId: await collect(1_000), kind: 'REVERSE_COLLECTION', reason: REASON }, seed.manager);
    await expect(approve(own.correctionId, seed.manager)).rejects.toMatchObject({ reason: 'SELF_APPROVAL_FORBIDDEN' });
    await expect(reject(own.correctionId, 'not my call', seed.manager)).rejects.toMatchObject({ reason: 'SELF_APPROVAL_FORBIDDEN' });
    await approve(correctionId);
  });

  it('above the threshold a branch manager may not approve; head office may', async () => {
    const big = CORRECTION_HEAD_OFFICE_THRESHOLD_PESEWAS + 50_000;
    const batch = await collect(big);
    const { correctionId, needsHeadOffice } = await request({ collectionBatchId: batch, kind: 'REVERSE_COLLECTION', reason: REASON });
    expect(needsHeadOffice).toBe(true);
    await expect(approve(correctionId)).rejects.toMatchObject({ reason: 'APPROVAL_LIMIT_EXCEEDED' });
    await approve(correctionId, finance());
    expect(await memberA()).toBe(0);
  });

  it('one open request per collection; a rejected one can be asked again', async () => {
    const batch = await collect(2_000);
    const { correctionId } = await request({ collectionBatchId: batch, kind: 'REVERSE_COLLECTION', reason: REASON });
    await expect(request({ collectionBatchId: batch, kind: 'REVERSE_COLLECTION', reason: REASON })).rejects.toMatchObject({ reason: 'CONFLICT' });
    await reject(correctionId);
    await expect(approve(correctionId)).rejects.toMatchObject({ reason: 'CONFLICT' });
    const again = await request({ collectionBatchId: batch, kind: 'MOVE_COLLECTION', toSusuAccountId: other.susuAccountId, reason: REASON });
    await approve(again.correctionId);
    const statuses = (await listCorrections(db, seed.manager, {})).corrections.map((c) => c.status);
    expect(statuses).toEqual(['APPROVED', 'REJECTED']);
    expect((await listCorrections(db, seed.manager, { status: 'REJECTED' })).corrections[0]!.decision).toMatchObject({ reason: 'Agent confirmed it was right' });
  });
});

describe('what cannot be corrected here', () => {
  it('a reversal after the pair handed the cash over is refused and stays pending', async () => {
    const { nextSeq } = await handedOver(db, seed, [2_000]);
    seq = nextSeq;
    const batch = (await db.query<{ batch_id: string }>('select batch_id from collections')).rows[0]!.batch_id;
    const { correctionId } = await request({ collectionBatchId: batch, kind: 'REVERSE_COLLECTION', reason: REASON });
    await expect(approve(correctionId)).rejects.toMatchObject({ reason: 'INSUFFICIENT_BALANCE' });
    expect((await listCorrections(db, seed.manager, { status: 'PENDING' })).corrections.map((c) => c.id)).toEqual([correctionId]);
    expect(await memberA()).toBe(2_000);
  });

  it('a move after the member withdrew the money is refused', async () => {
    const { nextSeq } = await handedOver(db, seed, [2_000]);
    seq = nextSeq;
    const batch = (await db.query<{ batch_id: string }>('select batch_id from collections')).rows[0]!.batch_id;
    const { withdrawalId } = await db.transaction((tx) => requestWithdrawal(tx, seed.cashier, { susuAccountId: seed.susuAccountId, amountPesewas: 1_500, reason: 'School fees' }));
    await db.transaction((tx) => approveWithdrawal(tx, seed.manager, { withdrawalId }));
    await db.transaction((tx) => payWithdrawal(tx, actor('cashier-2', 'CASHIER', [seed.branchId]), { withdrawalId }));
    const { correctionId } = await request({ collectionBatchId: batch, kind: 'MOVE_COLLECTION', toSusuAccountId: other.susuAccountId, reason: REASON });
    await expect(approve(correctionId)).rejects.toMatchObject({ reason: 'INSUFFICIENT_BALANCE' });
  });

  it('refuses non-collections, the same account, another branch, and bad amounts', async () => {
    const batch = await collect(2_000);
    const { branchId: tema } = await db.transaction((tx) => createBranch(tx, seed.admin, { name: 'Tema', code: 'TMA' }));
    const outsider = await addActiveMember(db, tema, seed.admin, { ...seed.admin, uid: 'admin-2' }, seed.productId);
    const otherBatch = (await db.query<{ id: string }>(`select id from journal_batches where kind <> 'SUSU_COLLECTION' limit 1`)).rows[0];
    if (otherBatch) {
      await expect(request({ collectionBatchId: otherBatch.id, kind: 'REVERSE_COLLECTION', reason: REASON })).rejects.toMatchObject({ reason: 'NOT_FOUND' });
    }
    await expect(request({ collectionBatchId: batch, kind: 'MOVE_COLLECTION', toSusuAccountId: seed.susuAccountId, reason: REASON })).rejects.toMatchObject({ reason: 'INVALID_COMMAND' });
    await expect(request({ collectionBatchId: batch, kind: 'MOVE_COLLECTION', toSusuAccountId: outsider.susuAccountId, reason: REASON })).rejects.toMatchObject({ reason: 'INVALID_COMMAND' });
    await expect(request({ collectionBatchId: batch, kind: 'REDUCE_COLLECTION', correctPesewas: 2_000, reason: REASON })).rejects.toMatchObject({ reason: 'INVALID_COMMAND' });
    await expect(request({ collectionBatchId: batch, kind: 'REVERSE_COLLECTION', reason: REASON }, actor('cashier-t', 'CASHIER', [tema]))).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
  });
});

describe('database guards (even if application code is bypassed)', () => {
  it('refuses a decision by the requester, a batch not tied to the approval, a second approval, and any edit', async () => {
    const batch = await collect(2_000);
    const { correctionId } = await request({ collectionBatchId: batch, kind: 'MOVE_COLLECTION', toSusuAccountId: other.susuAccountId, reason: REASON });
    await expect(db.query(`insert into approvals (subject_kind, subject_id, decision, decided_by, reason) values ('CORRECTION', $1, 'REJECTED', 'cashier-1', 'nope')`, [correctionId])).rejects.toThrow(/cannot decide/);
    // An approval pointing at an unrelated batch (the collection itself) is refused.
    await expect(db.query(`insert into approvals (subject_kind, subject_id, decision, decided_by, batch_id) values ('CORRECTION', $1, 'APPROVED', 'manager-1', $2)`, [correctionId, batch])).rejects.toThrow(/must name the requester/);
    await approve(correctionId);
    for (const sql of [`update approvals set decided_by = 'x'`, `delete from approvals`, `update correction_requests set amount_pesewas = 1`, `delete from correction_requests`]) {
      await expect(db.query(sql)).rejects.toThrow();
    }
  });

  it('refuses a request whose amount does not fit the collection', async () => {
    const batch = await collect(2_000);
    const collectionId = (await db.query<{ id: string }>('select id from collections where batch_id = $1', [batch])).rows[0]!.id;
    await expect(
      db.query(
        `insert into correction_requests (kind, collection_id, branch_id, business_id, amount_pesewas, reason, needs_head_office, requested_by)
         values ('REVERSE_COLLECTION', $1, $2, $3, 1999, 'raw insert test', false, 'ops')`,
        [collectionId, seed.branchId, seed.businessId],
      ),
    ).rejects.toThrow(/does not fit/);
  });
});

describe('dashboards after correcting an older day (audit 21 Oct, finding 1)', () => {
  it('names the corrected collection’s own cash day for republishing, and the scheduled repair finds it', async () => {
    const batch = await collect(3_000);
    // Make the collection belong to a day well outside today/yesterday, as an old one would.
    const oldDay = '2026-10-01';
    await db.query('alter table collections disable trigger collections_append_only');
    await db.query(`update collections set cash_day = $1 where batch_id = $2`, [oldDay, batch]);
    await db.query('alter table collections enable trigger collections_append_only');

    const before = await computeBranchDay(db, seed.branchId, oldDay);
    expect(before.collectedPesewas).toBe(3_000);
    const { correctionId } = await request({ collectionBatchId: batch, kind: 'REDUCE_COLLECTION', correctPesewas: 2_000, reason: REASON });
    await approve(correctionId);

    // The old day's figure changes in the books...
    expect((await computeBranchDay(db, seed.branchId, oldDay)).collectedPesewas).toBe(2_000);
    // ...so approval republishes that day as well as today,
    expect(await correctionDays(db, correctionId, today())).toEqual({ branchId: seed.branchId, days: [oldDay, today()].sort() });
    // and the scheduled repair picks it up even if that publish failed.
    expect(await recentlyCorrectedDays(db, new Date(Date.now() - 60_000))).toEqual([{ branchId: seed.branchId, day: oldDay }]);
    expect(await recentlyCorrectedDays(db, new Date(Date.now() + 60_000))).toEqual([]);
  });

  it('a rejected correction changes nothing and is not republished', async () => {
    const batch = await collect(1_000);
    const { correctionId } = await request({ collectionBatchId: batch, kind: 'REVERSE_COLLECTION', reason: REASON });
    await reject(correctionId);
    expect(await recentlyCorrectedDays(db, new Date(Date.now() - 60_000))).toEqual([]);
  });
});
