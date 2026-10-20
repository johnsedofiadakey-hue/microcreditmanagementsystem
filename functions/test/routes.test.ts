import { assignCollectorRequestSchema, openSusuAccountRequestSchema } from '@susu/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../src/db/types.js';
import { openSusuAccount, registerMember, approveMember } from '../src/members/members.js';
import { createAgentPair } from '../src/org/agentPairs.js';
import { createBranch } from '../src/org/branches.js';
import { recordStaffUser } from '../src/org/staff.js';
import { getMember } from '../src/reads/members.js';
import { activePairIds, assignCollector, buildPairRoute, unassignCollector } from '../src/routes/routes.js';
import { actor, addActiveMember, freshDatabase, nextGhanaCard, seedBranch } from './helpers.js';

const DAY = '2026-10-19';
let db: Database;
let seed: Awaited<ReturnType<typeof seedBranch>>;
let otherBranchId: string;
let otherPairId: string;

/** A second pair in the same branch, and a pair in another branch. */
async function addPair(branchId: string, a: string, b: string, name: string) {
  for (const uid of [a, b]) {
    await db.transaction((tx) =>
      recordStaffUser(tx, seed.admin, uid, { email: `${uid}@example.test`, displayName: uid, role: 'AGENT', branchIds: [branchId] }),
    );
  }
  const { agentPairId } = await db.transaction((tx) => createAgentPair(tx, seed.admin, { branchId, name, agentAUid: a, agentBUid: b }));
  return agentPairId;
}

beforeEach(async () => {
  db = await freshDatabase();
  seed = await seedBranch(db);
  // seedBranch puts the account on Pair 1's route; these tests start from an unassigned account.
  await db.transaction((tx) => unassignCollector(tx, seed.manager, { susuAccountId: seed.susuAccountId }));
  ({ branchId: otherBranchId } = await db.transaction((tx) => createBranch(tx, seed.admin, { name: 'Accra Central', code: 'ACC-01' })));
  otherPairId = await addPair(otherBranchId, 'agent-c', 'agent-d', 'Accra Pair');
});

afterEach(async () => {
  await db.close();
});

const assign = (expectedPesewas = 2000, agentPairId = seed.agentPairId, who = seed.manager) =>
  db.transaction((tx) => assignCollector(tx, who, { susuAccountId: seed.susuAccountId, agentPairId, expectedPesewas }));

describe('assignCollector', () => {
  it('puts the account on the pair’s route with masked details and the expected amount', async () => {
    expect(await assign()).toEqual({ affectedPairIds: [seed.agentPairId] });
    const built = await buildPairRoute(db, seed.agentPairId, DAY);
    expect(built!.route).toEqual({
      day: DAY,
      agentPairId: seed.agentPairId,
      branchId: seed.branchId,
      members: [
        {
          memberId: seed.memberId,
          susuAccountId: seed.susuAccountId,
          fullName: 'Ama Mensah',
          phoneMasked: '024 ••• ••67',
          expectedPesewas: 2000,
          productName: 'Daily Susu',
          frequency: 'DAILY',
        },
      ],
    });
    const snapshot = built!.snapshots.get(seed.memberId)!;
    expect(snapshot).toMatchObject({ fullName: 'Ama Mensah', phoneMasked: '024 ••• ••67' });
    expect(snapshot.ghanaCardMasked).toMatch(/^GHA-•{9}-\d$/);
    expect(snapshot.accounts).toEqual([{ id: seed.susuAccountId, productName: 'Daily Susu', status: 'ACTIVE' }]);
  });

  it('moving to another pair reports both pairs and empties the old route', async () => {
    const secondPair = await addPair(seed.branchId, 'agent-e', 'agent-f', 'Pair 2');
    await assign();
    expect(await assign(5000, secondPair)).toEqual({ affectedPairIds: [secondPair, seed.agentPairId] });
    expect((await buildPairRoute(db, seed.agentPairId, DAY))!.route.members).toEqual([]);
    expect((await buildPairRoute(db, seed.agentPairId, DAY))!.snapshots.size).toBe(0);
    expect((await buildPairRoute(db, secondPair, DAY))!.route.members.map((m) => m.expectedPesewas)).toEqual([5000]);
  });

  it('refuses a pair from another branch, in code and in the database', async () => {
    await expect(assign(2000, otherPairId)).rejects.toMatchObject({ reason: 'ACCOUNT_OUTSIDE_BRANCH' });
    await expect(
      db.query(`insert into route_assignments (susu_account_id, agent_pair_id, expected_pesewas, assigned_by) values ($1, $2, 100, 'x')`, [
        seed.susuAccountId,
        otherPairId,
      ]),
    ).rejects.toThrow(/not in the branch/);
  });

  it('only managers, supervisors and super admins may assign, in their own branch', async () => {
    await expect(assign(2000, seed.agentPairId, seed.cashier)).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
    const agent = actor('agent-a', 'AGENT', [seed.branchId], { agentPairId: seed.agentPairId });
    await expect(assign(2000, seed.agentPairId, agent)).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
    const otherManager = actor('manager-x', 'BRANCH_MANAGER', [otherBranchId]);
    await expect(assign(2000, seed.agentPairId, otherManager)).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
    const supervisor = actor('supervisor-1', 'SUPERVISOR', [seed.branchId]);
    await expect(assign(2000, seed.agentPairId, supervisor)).resolves.toBeDefined();
  });

  it('refuses inactive pairs and accounts, and an inactive pair’s route is empty', async () => {
    await assign();
    await db.query(`update agent_pairs set status = 'INACTIVE' where id = $1`, [seed.agentPairId]);
    expect((await buildPairRoute(db, seed.agentPairId, DAY))!.route.members).toEqual([]);
    expect(await activePairIds(db)).toEqual([otherPairId]);
    await expect(assign()).rejects.toMatchObject({ reason: 'AGENT_PAIR_NOT_ACTIVE' });

    await db.query(`update agent_pairs set status = 'ACTIVE' where id = $1`, [seed.agentPairId]);
    await db.query(`update susu_accounts set status = 'FROZEN' where id = $1`, [seed.susuAccountId]);
    expect((await buildPairRoute(db, seed.agentPairId, DAY))!.route.members).toEqual([]);
    await expect(assign()).rejects.toMatchObject({ reason: 'ACCOUNT_NOT_ACTIVE' });
  });

  it('is audited with the previous pair', async () => {
    const before = (await db.query<{ id: number }>('select coalesce(max(id), 0)::bigint as id from audit_events')).rows[0]!.id;
    await assign(2000);
    await assign(3000);
    const events = await db.query<{ action: string; data: { expectedPesewas: number; previousAgentPairId: string | null } }>(
      `select action, data from audit_events where entity_id = $1 and action like 'route.%' and id > $2 order by id`,
      [seed.susuAccountId, before],
    );
    expect(events.rows.map((e) => [e.action, e.data.expectedPesewas, e.data.previousAgentPairId])).toEqual([
      ['route.assigned', 2000, null],
      ['route.assigned', 3000, seed.agentPairId],
    ]);
  });

  it('expected amounts are integer pesewas within the per-collection limit', () => {
    const base = { susuAccountId: seed.susuAccountId, agentPairId: seed.agentPairId };
    expect(assignCollectorRequestSchema.safeParse({ ...base, expectedPesewas: 0 }).success).toBe(false);
    expect(assignCollectorRequestSchema.safeParse({ ...base, expectedPesewas: 20.5 }).success).toBe(false);
    expect(assignCollectorRequestSchema.safeParse({ ...base, expectedPesewas: 1_000_001 }).success).toBe(false);
    expect(assignCollectorRequestSchema.safeParse({ ...base, expectedPesewas: 1_000_000 }).success).toBe(true);
  });
});

describe('unassignCollector', () => {
  it('takes the account off the route; refuses when it is on none', async () => {
    await assign();
    const result = await db.transaction((tx) => unassignCollector(tx, seed.manager, { susuAccountId: seed.susuAccountId }));
    expect(result).toEqual({ affectedPairIds: [seed.agentPairId] });
    expect((await buildPairRoute(db, seed.agentPairId, DAY))!.route.members).toEqual([]);
    await expect(
      db.transaction((tx) => unassignCollector(tx, seed.manager, { susuAccountId: seed.susuAccountId })),
    ).rejects.toMatchObject({ reason: 'NOT_FOUND' });
  });
});

describe('routes with several members', () => {
  it('sorts by name and groups a member’s accounts in one snapshot', async () => {
    const { susuAccountId } = await addActiveMember(db, seed.branchId, seed.cashier, seed.manager, seed.productId);
    const second = await db.transaction((tx) =>
      openSusuAccount(tx, seed.manager, { memberId: seed.memberId, productId: seed.productId, collector: { agentPairId: seed.agentPairId, expectedPesewas: 500 } }),
    );
    await assign(2000);
    await db.transaction((tx) => assignCollector(tx, seed.manager, { susuAccountId, agentPairId: seed.agentPairId, expectedPesewas: 1000 }));

    const built = (await buildPairRoute(db, seed.agentPairId, DAY))!;
    expect(built.route.members).toHaveLength(3);
    const names = built.route.members.map((m) => m.fullName);
    expect(names).toEqual([...names].sort());
    expect(built.snapshots.get(seed.memberId)!.accounts.map((a) => a.id).sort()).toEqual([seed.susuAccountId, second.susuAccountId].sort());
    expect(built.snapshots.size).toBe(2);
  });
});

describe('openSusuAccount with a collector', () => {
  async function newMember() {
    const { memberId } = await db.transaction((tx) =>
      registerMember(tx, seed.cashier, {
        branchId: seed.branchId,
        fullName: 'Kofi Asante',
        phone: '055 765 4321',
        ghanaCardNumber: nextGhanaCard(),
        dateOfBirth: '1985-02-02',
        consentGiven: true,
      }),
    );
    await db.transaction((tx) => approveMember(tx, seed.manager, { memberId }));
    return memberId;
  }

  it('opens the account straight onto the route and shows the collector on the profile', async () => {
    const memberId = await newMember();
    const result = await db.transaction((tx) =>
      openSusuAccount(tx, seed.manager, { memberId, productId: seed.productId, collector: { agentPairId: seed.agentPairId, expectedPesewas: 1500 } }),
    );
    expect(result.agentPairId).toBe(seed.agentPairId);
    const route = (await buildPairRoute(db, seed.agentPairId, DAY))!.route;
    expect(route.members.map((m) => [m.fullName, m.expectedPesewas])).toEqual([['Kofi Asante', 1500]]);

    const { profile } = await getMember(db, seed.manager, { memberId });
    expect(profile.accounts[0]!.collector).toEqual({ agentPairId: seed.agentPairId, agentPairName: 'Pair 1', expectedPesewas: 1500 });
    const unassigned = await getMember(db, seed.manager, { memberId: seed.memberId });
    expect(unassigned.profile.accounts[0]!.collector).toBeNull();
  });

  it('a cashier may open accounts but not assign them; the whole open is refused', async () => {
    const memberId = await newMember();
    await expect(
      db.transaction((tx) =>
        openSusuAccount(tx, seed.cashier, { memberId, productId: seed.productId, collector: { agentPairId: seed.agentPairId, expectedPesewas: 1500 } }),
      ),
    ).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
    const count = await db.query<{ n: number }>('select count(*)::int as n from susu_accounts where member_id = $1', [memberId]);
    expect(count.rows[0]!.n).toBe(0);
  });

  it('the request schema keeps collector optional and strict', () => {
    const base = { memberId: seed.memberId, productId: seed.productId };
    expect(openSusuAccountRequestSchema.safeParse(base).success).toBe(true);
    expect(openSusuAccountRequestSchema.safeParse({ ...base, collector: { agentPairId: seed.agentPairId } }).success).toBe(false);
  });
});
