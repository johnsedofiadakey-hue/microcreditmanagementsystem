import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { branchCloseChecklist, closeBranchDay, submitBranchCount } from '../src/cash/close.js';
import { today } from '../src/cash/common.js';
import { confirmHandover, getHandoverDeclaration, listHandoverDeclarations } from '../src/cash/handovers.js';
import { listCases, listHandovers } from '../src/cash/reads.js';
import { approveWithdrawal, payWithdrawal, requestWithdrawal } from '../src/cash/withdrawals.js';
import { processAgentCommand } from '../src/commands/processAgentCommand.js';
import type { Database } from '../src/db/types.js';
import { findLedgerAccountId, getBalance } from '../src/ledger/accounts.js';
import { findBalanceMismatches } from '../src/ledger/reconcile.js';
import { createSusuProduct, openSusuAccount } from '../src/members/members.js';
import { createAgentPair } from '../src/org/agentPairs.js';
import { setBusinessModule } from '../src/org/modules.js';
import { recordStaffUser } from '../src/org/staff.js';
import { listBusinesses } from '../src/reads/org.js';
import { assignCollector, unassignCollector } from '../src/routes/routes.js';
import {
  GADUFIA,
  OPWS,
  STF,
  actor,
  addActiveMember,
  freshDatabase,
  phoneKey,
  seedBranch,
  signedCollection,
  signedDeclaration,
} from './helpers.js';

let db: Database;
let seed: Awaited<ReturnType<typeof seedBranch>>;
let seq = 0;
const cashier2 = () => actor('cashier-2', 'CASHIER', [seed.branchId]);

beforeEach(async () => {
  db = await freshDatabase();
  seed = await seedBranch(db);
  seq = 0;
});

afterEach(async () => {
  await db.close();
});

async function collect(amountPesewas: number, overrides: { susuAccountId?: string; memberId?: string; capturedAt?: string } = {}) {
  seq += 1;
  const c = signedCollection(seed.key, {
    memberId: overrides.memberId ?? seed.memberId,
    susuAccountId: overrides.susuAccountId ?? seed.susuAccountId,
    amountPesewas,
    seq,
    capturedAt: overrides.capturedAt,
  });
  const result = await processAgentCommand(db, c.id, c.body);
  expect(result.status).toBe('POSTED');
  const row = await db.query<{ route_status: string; cash_day: string; posted_after_close: boolean; case_id: string | null }>(
    `select route_status, to_char(cash_day, 'YYYY-MM-DD') as cash_day, posted_after_close, case_id from collections where id = $1`,
    [c.id],
  );
  return { id: c.id, ...row.rows[0]! };
}
async function declare(lines: { businessId: string; declaredPesewas: number }[]) {
  seq += 1;
  const d = signedDeclaration(seed.key, { seq, lines });
  return { id: d.id, result: await processAgentCommand(db, d.id, d.body), body: d.body };
}
const confirm = (declarationId: string, expectedPesewas: number, countedPesewas: number, who = seed.cashier, businessId: string = GADUFIA) =>
  db.transaction((tx) => confirmHandover(tx, who, { declarationId, businessId, expectedPesewas, countedPesewas }));
const balance = async (kind: Parameters<typeof findLedgerAccountId>[1], ownerId: string, businessId: string = GADUFIA) => {
  const id = await findLedgerAccountId(db, kind, ownerId, businessId);
  return id ? getBalance(db, id) : 0;
};

describe('H1 — route assignment is checked when a collection posts', () => {
  it('an assigned account posts ON_ROUTE with no case', async () => {
    expect(await collect(1_000)).toMatchObject({ route_status: 'ON_ROUTE', case_id: null });
  });

  it('an unassigned account still posts (the member paid) but opens an OFF_ROUTE case', async () => {
    await db.transaction((tx) => unassignCollector(tx, seed.manager, { susuAccountId: seed.susuAccountId }));
    const posted = await collect(1_500, { capturedAt: new Date().toISOString() });
    expect(posted.route_status).toBe('OFF_ROUTE');
    expect(await balance('MEMBER_SUSU', seed.susuAccountId)).toBe(1_500);
    expect(await balance('AGENT_CASH_CUSTODY', seed.agentPairId)).toBe(1_500);
    const { cases } = await listCases(db, seed.manager, { status: 'OPEN' });
    expect(cases).toHaveLength(1);
    expect(cases[0]).toMatchObject({ id: posted.case_id, kind: 'OFF_ROUTE_COLLECTION', amountPesewas: 1_500, entityId: posted.id, openedBy: 'SYSTEM' });
    const checklist = await branchCloseChecklist(db, seed.branchId, GADUFIA, today());
    expect(checklist.routeExceptions).toEqual({ offRouteCount: 1, offRoutePesewas: 1_500, previousRouteCount: 0 });
    expect(checklist.warnings.join(' ')).toMatch(/not assigned to/);
  });

  it('an account on another pair’s route is OFF_ROUTE for this pair', async () => {
    for (const uid of ['agent-c', 'agent-d']) {
      await db.transaction((tx) =>
        recordStaffUser(tx, seed.admin, uid, { email: `${uid}@example.test`, displayName: uid, role: 'AGENT', branchIds: [seed.branchId] }),
      );
    }
    const { agentPairId: other } = await db.transaction((tx) =>
      createAgentPair(tx, seed.manager, { branchId: seed.branchId, name: 'Pair 2', agentAUid: 'agent-c', agentBUid: 'agent-d' }),
    );
    await db.transaction((tx) => assignCollector(tx, seed.manager, { susuAccountId: seed.susuAccountId, agentPairId: other, expectedPesewas: 2_000 }));
    expect((await collect(1_000, { capturedAt: new Date().toISOString() })).route_status).toBe('OFF_ROUTE');
  });

  it('an offline collection captured before a reassignment counts as PREVIOUS_ROUTE, not off route', async () => {
    const capturedBefore = new Date(Date.now() - 60_000).toISOString();
    for (const uid of ['agent-c', 'agent-d']) {
      await db.transaction((tx) =>
        recordStaffUser(tx, seed.admin, uid, { email: `${uid}@example.test`, displayName: uid, role: 'AGENT', branchIds: [seed.branchId] }),
      );
    }
    const { agentPairId: other } = await db.transaction((tx) =>
      createAgentPair(tx, seed.manager, { branchId: seed.branchId, name: 'Pair 2', agentAUid: 'agent-c', agentBUid: 'agent-d' }),
    );
    await db.transaction((tx) => assignCollector(tx, seed.manager, { susuAccountId: seed.susuAccountId, agentPairId: other, expectedPesewas: 2_000 }));
    const late = await collect(2_000, { capturedAt: capturedBefore });
    expect(late).toMatchObject({ route_status: 'PREVIOUS_ROUTE', case_id: null });
    // The cash stays with the pair that holds it; nothing moves to the new pair.
    expect(await balance('AGENT_CASH_CUSTODY', seed.agentPairId)).toBe(2_000);
    expect(await balance('AGENT_CASH_CUSTODY', other)).toBe(0);
    // A phone claiming a capture time after the change gets no grace.
    expect((await collect(500, { capturedAt: new Date(Date.now() + 60_000).toISOString() })).route_status).toBe('OFF_ROUTE');
  });

  it('the grace for a previous route ends after 72 hours of server time', async () => {
    await db.transaction((tx) => unassignCollector(tx, seed.manager, { susuAccountId: seed.susuAccountId }));
    await db.query(`alter table route_assignment_periods disable trigger route_periods_guard`);
    await db.query(`update route_assignment_periods set ended_at = now() - interval '73 hours', started_at = now() - interval '10 days'`);
    await db.query(`alter table route_assignment_periods enable trigger route_periods_guard`);
    expect((await collect(500, { capturedAt: '2020-01-01T00:00:00Z' })).route_status).toBe('OFF_ROUTE');
  });

  it('route history is append-only', async () => {
    await expect(db.query(`delete from route_assignment_periods`)).rejects.toThrow(/never deleted/);
    await expect(db.query(`update route_assignment_periods set agent_pair_id = agent_pair_id, started_at = now() - interval '1 day'`)).rejects.toThrow(
      /only ending/,
    );
  });
});

describe('H2 — collections that arrive after a business’s day has closed', () => {
  async function closeToday() {
    const vault = await balance('BRANCH_CASH', seed.branchId);
    await db.transaction((tx) => submitBranchCount(tx, seed.cashier, { branchId: seed.branchId, businessId: GADUFIA, day: today(), countedPesewas: vault }));
    return db.transaction((tx) => closeBranchDay(tx, seed.manager, { branchId: seed.branchId, businessId: GADUFIA, day: today() }));
  }

  it('post, count towards the next day, and show on both days; the close stays frozen', async () => {
    await collect(1_000);
    const d1 = await declare([{ businessId: GADUFIA, declaredPesewas: 1_000 }]);
    await confirm(d1.id, 1_000, 1_000);
    const closed = await closeToday();
    expect(closed.checklist.collectedTodayPesewas).toBe(1_000);

    const late = await collect(500);
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    expect(late).toMatchObject({ posted_after_close: true, cash_day: tomorrow, route_status: 'ON_ROUTE' });
    expect(await balance('MEMBER_SUSU', seed.susuAccountId)).toBe(1_500);
    expect(await balance('AGENT_CASH_CUSTODY', seed.agentPairId)).toBe(500);

    const closedView = await branchCloseChecklist(db, seed.branchId, GADUFIA, today());
    expect(closedView).toMatchObject({
      status: 'CLOSED',
      collectedTodayPesewas: 1_000,
      postedAfterClose: { count: 1, amountPesewas: 500, countedOnDay: tomorrow },
    });
    const nextDay = await branchCloseChecklist(db, seed.branchId, GADUFIA, tomorrow);
    expect(nextDay).toMatchObject({ status: 'OPEN', collectedTodayPesewas: 500, carriedIn: { count: 1, amountPesewas: 500 } });
    expect(nextDay.warnings.join(' ')).toMatch(/arrived after the previous close/);
    // The custody still holds the late cash; tomorrow's handover is how it reaches the vault.
    expect(nextDay.pairs[0]!.custodyPesewas).toBe(500);
    const frozen = await db.query<{ checklist: { collectedTodayPesewas: number } }>('select checklist from branch_closes');
    expect(frozen.rows[0]!.checklist.collectedTodayPesewas).toBe(1_000);
    expect(await findBalanceMismatches(db)).toEqual([]);
  });

  it('another business’s close does not move this business’s collections', async () => {
    await db.transaction((tx) => submitBranchCount(tx, seed.cashier, { branchId: seed.branchId, businessId: OPWS, day: today(), countedPesewas: 0 }));
    await db.transaction((tx) => closeBranchDay(tx, seed.manager, { branchId: seed.branchId, businessId: OPWS, day: today() }));
    expect(await collect(800)).toMatchObject({ posted_after_close: false, cash_day: today() });
  });
});

describe('H3 — the agents declare, a different person confirms', () => {
  it('a declaration is signed evidence that moves no money and shows on the phone and in the queue', async () => {
    await collect(2_000);
    const d = await declare([{ businessId: GADUFIA, declaredPesewas: 2_000 }]);
    expect(d.result).toMatchObject({ status: 'RECORDED', recordId: d.id });
    expect(await balance('AGENT_CASH_CUSTODY', seed.agentPairId)).toBe(2_000);
    const { declarations } = await listHandoverDeclarations(db, seed.cashier, {});
    expect(declarations).toHaveLength(1);
    expect(declarations[0]).toMatchObject({ id: d.id, agentPairName: 'Pair 1', agentUid: 'agent-a', deviceId: 'device-a' });
    expect(declarations[0]!.lines).toEqual([
      expect.objectContaining({
        businessId: GADUFIA,
        declaredPesewas: 2_000,
        custodyAtDeclarationPesewas: 2_000,
        currentCustodyPesewas: 2_000,
        status: 'DECLARED',
        handoverId: null,
      }),
    ]);
    // Replaying the same signed command returns the same result and records nothing new.
    expect(await processAgentCommand(db, d.id, d.body)).toMatchObject({ status: 'RECORDED', recordId: d.id });
    expect((await db.query('select 1 from handover_declarations')).rowCount).toBe(1);
  });

  it('confirmation posts with both parties on the batch, once', async () => {
    await collect(2_000);
    const d = await declare([{ businessId: GADUFIA, declaredPesewas: 2_000 }]);
    const result = await confirm(d.id, 2_000, 2_000);
    expect(result).toMatchObject({ differencePesewas: 0, declarationDifferencePesewas: 0, caseId: null });
    const batch = await db.query<{ actor_uid: string; approved_by: string }>(
      'select b.actor_uid, b.approved_by from handovers h join journal_batches b on b.id = h.batch_id where h.id = $1',
      [result.handoverId],
    );
    expect(batch.rows[0]).toEqual({ actor_uid: 'cashier-1', approved_by: 'agent-a' });
    expect([await balance('AGENT_CASH_CUSTODY', seed.agentPairId), await balance('BRANCH_CASH', seed.branchId)]).toEqual([0, 2_000]);
    await expect(confirm(d.id, 0, 2_000, cashier2())).rejects.toMatchObject({ reason: 'CONFLICT' });
    const { handovers } = await listHandovers(db, seed.manager, {});
    expect(handovers[0]).toMatchObject({ declarationId: d.id, declaredPesewas: 2_000, countedPesewas: 2_000 });
    expect((await getHandoverDeclaration(db, d.id))!.lines[0]).toMatchObject({ status: 'CONFIRMED', countedPesewas: 2_000, confirmedBy: 'cashier-1' });
  });

  it('an agent of the pair cannot confirm their own cash, even with a cashier role', async () => {
    await collect(1_000);
    const d = await declare([{ businessId: GADUFIA, declaredPesewas: 1_000 }]);
    await expect(confirm(d.id, 1_000, 1_000, actor('agent-b', 'CASHIER', [seed.branchId]))).rejects.toMatchObject({
      reason: 'SELF_APPROVAL_FORBIDDEN',
    });
    await expect(confirm(d.id, 1_000, 1_000, actor('agent-a', 'AGENT', [seed.branchId], { agentPairId: seed.agentPairId }))).rejects.toMatchObject({
      reason: 'NOT_PERMITTED',
    });
  });

  it('a count that matches custody but not the declaration opens a HANDOVER_DISPUTE case', async () => {
    await collect(2_000);
    const d = await declare([{ businessId: GADUFIA, declaredPesewas: 2_500 }]);
    const result = await confirm(d.id, 2_000, 2_000);
    expect(result).toMatchObject({ differencePesewas: 0, declarationDifferencePesewas: -500 });
    const { cases } = await listCases(db, seed.manager, {});
    expect(cases[0]).toMatchObject({ id: result.caseId, kind: 'HANDOVER_DISPUTE', amountPesewas: -500 });
    expect(await balance('BRANCH_CASH_VARIANCE', seed.branchId)).toBe(0);
  });

  it('a shortage against custody posts to variance and opens a HANDOVER_DIFFERENCE case', async () => {
    await collect(2_000);
    const d = await declare([{ businessId: GADUFIA, declaredPesewas: 2_000 }]);
    const result = await confirm(d.id, 2_000, 1_800);
    expect(result).toMatchObject({ differencePesewas: -200, declarationDifferencePesewas: -200 });
    expect(await balance('BRANCH_CASH_VARIANCE', seed.branchId)).toBe(200);
    expect((await listCases(db, seed.manager, {})).cases[0]).toMatchObject({ kind: 'HANDOVER_DIFFERENCE', amountPesewas: -200 });
  });

  it('a newer declaration supersedes the waiting one; the old one can no longer be confirmed', async () => {
    await collect(2_000);
    const first = await declare([{ businessId: GADUFIA, declaredPesewas: 1_900 }]);
    const second = await declare([{ businessId: GADUFIA, declaredPesewas: 2_000 }]);
    await expect(confirm(first.id, 2_000, 2_000)).rejects.toMatchObject({ reason: 'CONFLICT' });
    await expect(confirm(second.id, 2_000, 2_000)).resolves.toMatchObject({ caseId: null });
  });

  it('per-business lines: each business is counted into its own vault', async () => {
    await db.transaction((tx) => setBusinessModule(tx, seed.admin, { businessId: OPWS, module: 'SUSU', enabled: true, reason: 'test' }));
    const { productId } = await db.transaction((tx) =>
      createSusuProduct(tx, seed.admin, { businessId: OPWS, code: 'CONTRIB', name: 'Contribution', frequency: 'DAILY' }),
    );
    const { susuAccountId } = await db.transaction((tx) => openSusuAccount(tx, seed.manager, { memberId: seed.memberId, productId }));
    await db.transaction((tx) => assignCollector(tx, seed.manager, { susuAccountId, agentPairId: seed.agentPairId, expectedPesewas: 300 }));
    await collect(1_000);
    await collect(300, { susuAccountId });
    const d = await declare([
      { businessId: GADUFIA, declaredPesewas: 1_000 },
      { businessId: OPWS, declaredPesewas: 300 },
    ]);
    await confirm(d.id, 1_000, 1_000);
    expect((await getHandoverDeclaration(db, d.id))!.lines.map((l) => [l.businessId, l.status])).toEqual([
      [GADUFIA, 'CONFIRMED'],
      [OPWS, 'DECLARED'],
    ]);
    await confirm(d.id, 300, 300, seed.cashier, OPWS);
    expect([await balance('BRANCH_CASH', seed.branchId, GADUFIA), await balance('BRANCH_CASH', seed.branchId, OPWS)]).toEqual([1_000, 300]);
  });

  it('a declaration from a revoked or other agent’s phone is rejected; malformed ones too', async () => {
    const bad = signedDeclaration(seed.key, { seq: 50, lines: [{ businessId: GADUFIA, declaredPesewas: 0 }] });
    expect(await processAgentCommand(db, bad.id, bad.body)).toMatchObject({ status: 'REJECTED', reason: 'INVALID_COMMAND' });
    const forged = signedDeclaration(phoneKey(), { seq: 51, lines: [{ businessId: GADUFIA, declaredPesewas: 100 }] });
    expect(await processAgentCommand(db, forged.id, forged.body)).toMatchObject({ status: 'REJECTED', reason: 'INVALID_SIGNATURE' });
    const duplicate = signedDeclaration(seed.key, {
      seq: 52,
      lines: [
        { businessId: GADUFIA, declaredPesewas: 100 },
        { businessId: GADUFIA, declaredPesewas: 200 },
      ],
    });
    expect(await processAgentCommand(db, duplicate.id, duplicate.body)).toMatchObject({ status: 'REJECTED', reason: 'INVALID_COMMAND' });
  });

  it('the database refuses a handover without a declaration, or received by the pair’s own agent', async () => {
    await collect(1_000);
    const batch = (await db.query<{ id: string }>(`select batch_id as id from collections limit 1`)).rows[0]!.id;
    await expect(
      db.transaction((tx) =>
        tx.query(
          `insert into handovers (branch_id, business_id, agent_pair_id, day, expected_pesewas, counted_pesewas, received_by, batch_id)
           values ($1, $2, $3, current_date, 0, 0, 'cashier-1', $4)`,
          [seed.branchId, GADUFIA, seed.agentPairId, batch],
        ),
      ),
    ).rejects.toThrow(/declare it from the phone/);
  });

  it('the full journey: collect → declare → confirm → request → approve → pay → count → close', async () => {
    await collect(3_000);
    await collect(2_000);
    const d = await declare([{ businessId: GADUFIA, declaredPesewas: 5_000 }]);
    await confirm(d.id, 5_000, 5_000);
    const { withdrawalId } = await db.transaction((tx) =>
      requestWithdrawal(tx, seed.cashier, { susuAccountId: seed.susuAccountId, amountPesewas: 1_200, reason: 'Rent' }),
    );
    await db.transaction((tx) => approveWithdrawal(tx, seed.manager, { withdrawalId }));
    await db.transaction((tx) => payWithdrawal(tx, cashier2(), { withdrawalId }));
    const before = await branchCloseChecklist(db, seed.branchId, GADUFIA, today());
    expect(before).toMatchObject({ expectedCashPesewas: 3_800, pendingDeclarations: { count: 0 }, routeExceptions: { offRouteCount: 0 } });
    await db.transaction((tx) => submitBranchCount(tx, seed.cashier, { branchId: seed.branchId, businessId: GADUFIA, day: today(), countedPesewas: 3_800 }));
    const closed = await db.transaction((tx) => closeBranchDay(tx, seed.manager, { branchId: seed.branchId, businessId: GADUFIA, day: today() }));
    expect(closed.checklist).toMatchObject({
      collectedTodayPesewas: 5_000,
      handedOverTodayPesewas: 5_000,
      paidOutTodayPesewas: 1_200,
      warnings: [],
    });
    expect(await findBalanceMismatches(db)).toEqual([]);
  });
});

describe('M3 — later-stage modules are off', () => {
  it('only Gadufia Susu is switched on; STF and OPWS cannot get products or accounts', async () => {
    const { businesses } = await listBusinesses(db, seed.cashier);
    expect(businesses.map((b) => [b.code, b.enabledModules])).toEqual([
      ['GADUFIA', ['SUSU']],
      ['OPWS', []],
      ['STF', []],
    ]);
    await expect(
      db.transaction((tx) => createSusuProduct(tx, seed.admin, { businessId: STF, code: 'X', name: 'Loan-ish', frequency: 'DAILY' })),
    ).rejects.toMatchObject({ reason: 'NOT_PERMITTED', details: { module: 'SUSU', businessId: STF } });
  });

  it('switching a module off stops new accounts but existing accounts keep collecting', async () => {
    await db.transaction((tx) => setBusinessModule(tx, seed.admin, { businessId: GADUFIA, module: 'SUSU', enabled: false, reason: 'pause' }));
    const other = await addActiveMember(db, seed.branchId, seed.cashier, seed.manager, seed.productId).catch((e: unknown) => e);
    expect(other).toMatchObject({ reason: 'NOT_PERMITTED' });
    expect((await collect(400)).route_status).toBe('ON_ROUTE');
    await expect(
      db.transaction((tx) => setBusinessModule(tx, seed.manager, { businessId: GADUFIA, module: 'SUSU', enabled: true, reason: 'x' })),
    ).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
  });
});
