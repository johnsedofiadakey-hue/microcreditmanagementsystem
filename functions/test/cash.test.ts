import { WITHDRAWAL_HEAD_OFFICE_THRESHOLD_PESEWAS } from '@susu/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveCase } from '../src/cash/cases.js';
import { branchCloseChecklist, closeBranchDay, submitBranchCount } from '../src/cash/close.js';
import { today } from '../src/cash/common.js';
import { recordHandover } from '../src/cash/handovers.js';
import { getBranchClose, listCases, listHandovers, listWithdrawals } from '../src/cash/reads.js';
import { approveWithdrawal, payWithdrawal, rejectWithdrawal, requestWithdrawal } from '../src/cash/withdrawals.js';
import { processAgentCommand } from '../src/commands/processAgentCommand.js';
import type { Database } from '../src/db/types.js';
import { findLedgerAccountId, getBalance } from '../src/ledger/accounts.js';
import { findBalanceMismatches } from '../src/ledger/reconcile.js';
import { createBranch } from '../src/org/branches.js';
import { actor, freshDatabase, seedBranch, signedCollection } from './helpers.js';

let db: Database;
let seed: Awaited<ReturnType<typeof seedBranch>>;
let seq = 0;
const cashier2 = () => actor('cashier-2', 'CASHIER', [seed.branchId]);
const finance = () => actor('finance-1', 'FINANCE');
const agentActor = () => actor('agent-a', 'AGENT', [seed.branchId], { agentPairId: seed.agentPairId });

beforeEach(async () => {
  db = await freshDatabase();
  seed = await seedBranch(db);
  seq = 0;
});

afterEach(async () => {
  await db.close();
});

async function collect(amountPesewas: number) {
  seq += 1;
  const c = signedCollection(seed.key, { ...seed, amountPesewas, seq });
  expect((await processAgentCommand(db, c.id, c.body)).status).toBe('POSTED');
}

const balance = async (kind: Parameters<typeof findLedgerAccountId>[1], ownerId: string) =>
  getBalance(db, (await findLedgerAccountId(db, kind, ownerId))!);
const custody = () => balance('AGENT_CASH_CUSTODY', seed.agentPairId);
const branchCash = () => balance('BRANCH_CASH', seed.branchId);
const variance = () => balance('BRANCH_CASH_VARIANCE', seed.branchId);
const member = () => balance('MEMBER_SUSU', seed.susuAccountId);

const handover = (expectedPesewas: number, countedPesewas: number, who = seed.cashier) =>
  db.transaction((tx) => recordHandover(tx, who, { agentPairId: seed.agentPairId, expectedPesewas, countedPesewas }));
const request = (amountPesewas: number, who = seed.cashier) =>
  db.transaction((tx) => requestWithdrawal(tx, who, { susuAccountId: seed.susuAccountId, amountPesewas, reason: 'School fees' }));
const approve = (withdrawalId: string, who = seed.manager) => db.transaction((tx) => approveWithdrawal(tx, who, { withdrawalId }));
const pay = (withdrawalId: string, who = cashier2()) => db.transaction((tx) => payWithdrawal(tx, who, { withdrawalId }));
const count = (countedPesewas: number, who = seed.cashier) =>
  db.transaction((tx) => submitBranchCount(tx, who, { branchId: seed.branchId, day: today(), countedPesewas }));
const close = (who = seed.manager) => db.transaction((tx) => closeBranchDay(tx, who, { branchId: seed.branchId, day: today() }));

describe('a full branch day (BUILD_PLAN Step 6 “done when”)', () => {
  it('collections → handover → withdrawal paid → count → close, with balanced books', async () => {
    await collect(2_000);
    await collect(2_000);
    await collect(2_000);
    expect(await custody()).toBe(6_000);

    const before = await getBranchClose(db, seed.cashier, { branchId: seed.branchId, day: today() });
    expect(before.pairs).toEqual([{ agentPairId: seed.agentPairId, agentPairName: 'Pair 1', custodyPesewas: 6_000, missingRecordCount: 0 }]);
    expect(before.warnings).toContain('Pair 1 still holds GH₵ 60.00 not handed over');

    expect(await handover(6_000, 6_000)).toMatchObject({ differencePesewas: 0, caseId: null });
    expect([await custody(), await branchCash()]).toEqual([0, 6_000]);

    const { withdrawalId, needsHeadOffice } = await request(1_500);
    expect(needsHeadOffice).toBe(false);
    await approve(withdrawalId);
    const { batchId } = await pay(withdrawalId);
    expect([await member(), await branchCash()]).toEqual([4_500, 4_500]);

    const batch = await db.query<{ actor_uid: string; approved_by: string; kind: string }>(
      'select actor_uid, approved_by, kind from journal_batches where id = $1',
      [batchId],
    );
    expect(batch.rows[0]).toEqual({ actor_uid: 'cashier-2', approved_by: 'manager-1', kind: 'WITHDRAWAL_PAYOUT' });
    const sms = await db.query<{ payload: { template: string; values: { amount: string; balance: string } } }>(
      'select payload from outbox where dedupe_key = $1',
      [`sms:withdrawal:${withdrawalId}`],
    );
    expect(sms.rows[0]!.payload).toMatchObject({ template: 'WITHDRAWAL_RECEIPT', values: { amount: 'GH₵ 15.00', balance: 'GH₵ 45.00' } });

    expect(await count(4_500)).toMatchObject({ expectedPesewas: 4_500, differencePesewas: 0 });
    const closed = await close();
    expect(closed).toMatchObject({ differencePesewas: 0, caseId: null });
    expect(closed.checklist).toMatchObject({
      status: 'CLOSED',
      expectedCashPesewas: 4_500,
      collectedTodayPesewas: 6_000,
      handedOverTodayPesewas: 6_000,
      paidOutTodayPesewas: 1_500,
      approvedUnpaid: { count: 0, amountPesewas: 0 },
      openCases: 0,
      warnings: [],
      closedBy: 'manager-1',
    });
    const frozen = await branchCloseChecklist(db, seed.branchId, today());
    expect(frozen).toMatchObject({ status: 'CLOSED', closedBy: 'manager-1', count: { countedPesewas: 4_500, countedBy: 'cashier-1' } });

    expect(await findBalanceMismatches(db)).toEqual([]);
    const actions = await db.query<{ action: string }>(
      `select action from audit_events where action in ('handover.recorded','withdrawal.requested','withdrawal.approved','withdrawal.paid','branch.counted','branch.closed') order by id`,
    );
    expect(actions.rows.map((r) => r.action)).toEqual([
      'handover.recorded',
      'withdrawal.requested',
      'withdrawal.approved',
      'withdrawal.paid',
      'branch.counted',
      'branch.closed',
    ]);
  });
});

describe('handover', () => {
  it('a shortage goes to variance and opens a case; the case is resolved by someone else', async () => {
    await collect(6_000);
    const result = await handover(6_000, 5_500);
    expect(result.differencePesewas).toBe(-500);
    expect([await custody(), await branchCash(), await variance()]).toEqual([0, 5_500, 500]);
    const { cases } = await listCases(db, seed.manager, { status: 'OPEN' });
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ id: result.caseId, kind: 'HANDOVER_DIFFERENCE', amountPesewas: -500, entityKind: 'handover' });
    expect(cases[0]!.summary).toMatch(/shortage of GH₵ 5\.00/);

    await expect(db.transaction((tx) => resolveCase(tx, actor('cashier-1', 'BRANCH_MANAGER', [seed.branchId]), { caseId: result.caseId!, resolution: 'Recounted' }))).rejects.toMatchObject({
      reason: 'SELF_APPROVAL_FORBIDDEN',
    });
    await db.transaction((tx) => resolveCase(tx, seed.manager, { caseId: result.caseId!, resolution: 'Agent repaid GH₵ 5 next day' }));
    expect((await listCases(db, seed.manager, { status: 'OPEN' })).cases).toEqual([]);
    await expect(db.transaction((tx) => resolveCase(tx, seed.manager, { caseId: result.caseId!, resolution: 'again' }))).rejects.toMatchObject({
      reason: 'CONFLICT',
    });
  });

  it('an overage is credited to variance', async () => {
    await collect(2_000);
    expect((await handover(2_000, 2_300)).differencePesewas).toBe(300);
    expect([await branchCash(), await variance()]).toEqual([2_300, -300]);
    expect(await findBalanceMismatches(db)).toEqual([]);
  });

  it('refuses when more cash posted after the cashier looked, then accepts the new figure', async () => {
    await collect(2_000);
    await collect(1_000);
    await expect(handover(2_000, 2_000)).rejects.toMatchObject({ reason: 'EXPECTED_CASH_CHANGED', details: { expectedPesewas: 3_000 } });
    await expect(handover(3_000, 3_000)).resolves.toMatchObject({ differencePesewas: 0 });
    const { handovers } = await listHandovers(db, seed.manager, { day: today() });
    expect(handovers.map((h) => [h.agentPairName, h.expectedPesewas, h.countedPesewas])).toEqual([['Pair 1', 3_000, 3_000]]);
  });

  it('nothing to hand over is refused; agents and other branches cannot record a handover', async () => {
    await expect(handover(0, 0)).rejects.toMatchObject({ reason: 'INVALID_COMMAND' });
    await collect(1_000);
    await expect(handover(1_000, 1_000, agentActor())).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
    const { branchId: other } = await db.transaction((tx) => createBranch(tx, seed.admin, { name: 'Accra', code: 'ACC-01' }));
    await expect(handover(1_000, 1_000, actor('cashier-x', 'CASHIER', [other]))).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
  });
});

describe('withdrawals: three different people', () => {
  beforeEach(async () => {
    await collect(10_000);
    await handover(10_000, 10_000);
  });

  it('cannot exceed what is available, counting other open requests', async () => {
    await expect(request(10_001)).rejects.toMatchObject({ reason: 'INSUFFICIENT_BALANCE', details: { availablePesewas: 10_000 } });
    await request(6_000);
    await expect(request(5_000)).rejects.toMatchObject({ reason: 'INSUFFICIENT_BALANCE', details: { availablePesewas: 4_000 } });
  });

  it('the requester cannot approve, and the requester or approver cannot pay', async () => {
    const { withdrawalId } = await request(1_000, seed.manager);
    await expect(approve(withdrawalId, seed.manager)).rejects.toMatchObject({ reason: 'SELF_APPROVAL_FORBIDDEN' });
    await approve(withdrawalId, seed.admin);
    await expect(pay(withdrawalId, seed.manager)).rejects.toMatchObject({ reason: 'SELF_APPROVAL_FORBIDDEN' });
    await expect(pay(withdrawalId, actor('admin-1', 'BRANCH_MANAGER', [seed.branchId]))).rejects.toMatchObject({ reason: 'SELF_APPROVAL_FORBIDDEN' });
    await expect(pay(withdrawalId, seed.cashier)).resolves.toBeDefined();
    await expect(pay(withdrawalId, cashier2())).rejects.toMatchObject({ reason: 'CONFLICT' });
  });

  it('cashiers and agents cannot approve; agents cannot request', async () => {
    const { withdrawalId } = await request(1_000);
    await expect(approve(withdrawalId, cashier2())).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
    await expect(request(1_000, agentActor())).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
  });

  it('above the threshold a branch manager may not approve; finance may', async () => {
    await collect(WITHDRAWAL_HEAD_OFFICE_THRESHOLD_PESEWAS);
    const { withdrawalId, needsHeadOffice } = await request(WITHDRAWAL_HEAD_OFFICE_THRESHOLD_PESEWAS + 1);
    expect(needsHeadOffice).toBe(true);
    await expect(approve(withdrawalId, seed.manager)).rejects.toMatchObject({ reason: 'APPROVAL_LIMIT_EXCEEDED' });
    await approve(withdrawalId, finance());
    const { withdrawals } = await listWithdrawals(db, seed.manager, { status: 'APPROVED' });
    expect(withdrawals[0]).toMatchObject({ id: withdrawalId, needsHeadOffice: true, decidedBy: 'finance-1', memberName: 'Ama Mensah' });
  });

  it('rejection is final and frees the reserved amount', async () => {
    const { withdrawalId } = await request(9_000);
    await db.transaction((tx) => rejectWithdrawal(tx, seed.manager, { withdrawalId, reason: 'Member asked to wait' }));
    await expect(approve(withdrawalId)).rejects.toMatchObject({ reason: 'CONFLICT' });
    await expect(pay(withdrawalId)).rejects.toMatchObject({ reason: 'CONFLICT' });
    await expect(request(9_000)).resolves.toBeDefined();
  });

  it('a payout the vault cannot cover is refused by the ledger and stays approved', async () => {
    // The member has GH₵ 150 but GH₵ 50 of it is still with the agents, not in the vault.
    await collect(5_000);
    const { withdrawalId } = await request(12_000);
    await approve(withdrawalId);
    await expect(pay(withdrawalId)).rejects.toMatchObject({ reason: 'INSUFFICIENT_BALANCE' });
    expect([await branchCash(), await member()]).toEqual([10_000, 15_000]);
    expect((await listWithdrawals(db, seed.manager, { status: 'APPROVED' })).withdrawals.map((w) => w.id)).toEqual([withdrawalId]);
  });

  it('a frozen account cannot be paid out', async () => {
    const { withdrawalId } = await request(1_000);
    await approve(withdrawalId);
    await db.query(`update susu_accounts set status = 'FROZEN' where id = $1`, [seed.susuAccountId]);
    await expect(pay(withdrawalId)).rejects.toMatchObject({ reason: 'ACCOUNT_NOT_ACTIVE' });
  });
});

describe('branch close', () => {
  beforeEach(async () => {
    await collect(5_000);
    await handover(5_000, 5_000);
  });

  it('needs a count by someone else, against the current balance', async () => {
    await expect(close()).rejects.toMatchObject({ reason: 'NOT_FOUND' });
    await count(5_000, seed.manager);
    await expect(close(seed.manager)).rejects.toMatchObject({ reason: 'SELF_APPROVAL_FORBIDDEN' });
    await count(5_000);
    await collect(1_000);
    await handover(1_000, 1_000);
    await expect(close()).rejects.toMatchObject({ reason: 'EXPECTED_CASH_CHANGED', details: { expectedPesewas: 6_000 } });
    const checklist = await branchCloseChecklist(db, seed.branchId, today());
    expect(checklist.warnings).toContain('Cash moved after the last count — count again before closing');
    await count(6_000);
    await expect(close()).resolves.toMatchObject({ differencePesewas: 0 });
  });

  it('a shortage at close is posted to variance with both people and opens a case', async () => {
    await count(4_800);
    const result = await close();
    expect(result.differencePesewas).toBe(-200);
    expect([await branchCash(), await variance()]).toEqual([4_800, 200]);
    const closeRow = await db.query<{ batch_id: string }>('select batch_id from branch_closes where branch_id = $1', [seed.branchId]);
    const batch = await db.query<{ actor_uid: string; approved_by: string }>('select actor_uid, approved_by from journal_batches where id = $1', [
      closeRow.rows[0]!.batch_id,
    ]);
    expect(batch.rows[0]).toEqual({ actor_uid: 'manager-1', approved_by: 'cashier-1' });
    expect((await listCases(db, seed.admin, { branchId: seed.branchId })).cases[0]).toMatchObject({ kind: 'CLOSE_DIFFERENCE', amountPesewas: -200 });
    expect(await findBalanceMismatches(db)).toEqual([]);
  });

  it('a closed day takes no more handovers, payouts, counts or closes; collections still post', async () => {
    const { withdrawalId } = await request(1_000);
    await approve(withdrawalId);
    await count(5_000);
    const result = await close();
    expect(result.checklist.warnings).toContain('1 approved withdrawal not paid out (GH₵ 10.00)');
    await expect(pay(withdrawalId)).rejects.toMatchObject({ reason: 'BRANCH_DAY_CLOSED' });
    await collect(700);
    await expect(handover(700, 700)).rejects.toMatchObject({ reason: 'BRANCH_DAY_CLOSED' });
    await expect(count(5_000)).rejects.toMatchObject({ reason: 'BRANCH_DAY_CLOSED' });
    await expect(close()).rejects.toMatchObject({ reason: 'BRANCH_DAY_CLOSED' });
    expect(await custody()).toBe(700);
  });

  it('only today can be counted or closed', async () => {
    await expect(
      db.transaction((tx) => submitBranchCount(tx, seed.cashier, { branchId: seed.branchId, day: '2020-01-01', countedPesewas: 1 })),
    ).rejects.toMatchObject({ reason: 'INVALID_COMMAND' });
  });
});

describe('the database refuses shortcuts', () => {
  it('withdrawal amounts, skipped steps and deletes', async () => {
    await collect(3_000);
    await handover(3_000, 3_000);
    const { withdrawalId } = await request(1_000);
    await expect(db.query('update withdrawal_requests set amount_pesewas = 5 where id = $1', [withdrawalId])).rejects.toThrow(/cannot change/);
    await expect(
      db.query(`update withdrawal_requests set status = 'APPROVED', decided_by = requested_by, decided_at = now() where id = $1`, [withdrawalId]),
    ).rejects.toThrow();
    await expect(db.query('delete from withdrawal_requests where id = $1', [withdrawalId])).rejects.toThrow(/append-only/);
    await approve(withdrawalId);
    await expect(
      db.query(`update withdrawal_requests set status = 'PAID', paid_by = 'cashier-2', paid_at = now() where id = $1`, [withdrawalId]),
    ).rejects.toThrow(); // no batch: the payout must go through the ledger
    await expect(db.query(`update withdrawal_requests set status = 'PENDING_APPROVAL', decided_by = null, decided_at = null where id = $1`, [withdrawalId])).rejects.toThrow(
      /not allowed/,
    );
  });

  it('handovers and closes are append-only; a close needs two people', async () => {
    await collect(1_000);
    const { handoverId } = await handover(1_000, 1_000);
    await expect(db.query('update handovers set counted_pesewas = 0 where id = $1', [handoverId])).rejects.toThrow(/append-only/);
    await expect(db.query('delete from handovers where id = $1', [handoverId])).rejects.toThrow(/append-only/);
    const { countId } = await count(1_000);
    await expect(
      db.query(
        `insert into branch_closes (branch_id, day, count_id, expected_pesewas, counted_pesewas, counted_by, closed_by, checklist)
         values ($1, $2, $3, 1000, 1000, 'cashier-1', 'cashier-1', '{}')`,
        [seed.branchId, today(), countId],
      ),
    ).rejects.toThrow();
  });
});

describe('reads are scoped', () => {
  it('another branch sees nothing and may not ask for this branch', async () => {
    await collect(1_000);
    await handover(1_000, 1_000);
    await request(500);
    const { branchId: other } = await db.transaction((tx) => createBranch(tx, seed.admin, { name: 'Accra', code: 'ACC-01' }));
    const otherManager = actor('manager-x', 'BRANCH_MANAGER', [other]);
    expect((await listWithdrawals(db, otherManager, {})).withdrawals).toEqual([]);
    expect((await listHandovers(db, otherManager, {})).handovers).toEqual([]);
    await expect(listWithdrawals(db, otherManager, { branchId: seed.branchId })).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
    await expect(getBranchClose(db, otherManager, { branchId: seed.branchId, day: today() })).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
    await expect(listCases(db, agentActor(), {})).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
    expect((await listWithdrawals(db, finance(), {})).withdrawals).toHaveLength(1);
  });
});
