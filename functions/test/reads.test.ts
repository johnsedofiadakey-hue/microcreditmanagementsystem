import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { processAgentCommand } from '../src/commands/processAgentCommand.js';
import type { Database } from '../src/db/types.js';
import type { Actor } from '../src/lib/actor.js';
import { registerMember } from '../src/members/members.js';
import { createBranch } from '../src/org/branches.js';
import { revokeDevice } from '../src/org/devices.js';
import { listAuditEvents } from '../src/reads/audit.js';
import { getAccountStatement, getMember, listPendingApprovals, searchMembers } from '../src/reads/members.js';
import { listAgentPairs, listBranches, listDevices, listStaff, listSusuProducts } from '../src/reads/org.js';
import { deviceStatusDocs, pairSyncHealthForDevice } from '../src/reads/syncHealth.js';
import { actor, addActiveMember, freshDatabase, nextGhanaCard, randomUUID, seedBranch, signedCollection } from './helpers.js';

let db: Database;
let seed: Awaited<ReturnType<typeof seedBranch>>;
let otherBranchId: string;
let otherMember: { memberId: string; susuAccountId: string };
const agentActor = () => actor('agent-a', 'AGENT', [seed.branchId], { agentPairId: seed.agentPairId });
const finance = () => actor('finance-1', 'FINANCE');
const compliance = () => actor('compliance-1', 'COMPLIANCE');

beforeEach(async () => {
  db = await freshDatabase();
  seed = await seedBranch(db);
  ({ branchId: otherBranchId } = await db.transaction((tx) => createBranch(tx, seed.admin, { name: 'Accra Central', code: 'ACC-01' })));
  otherMember = await addActiveMember(db, otherBranchId, seed.admin, { ...seed.admin, uid: 'admin-2' }, seed.productId);
});

afterEach(async () => {
  await db.close();
});

describe('organisation lists are scoped to the caller’s branches', () => {
  it('listBranches: head office sees all, a manager sees their own', async () => {
    expect((await listBranches(db, seed.admin)).branches.map((b) => b.code)).toEqual(['ACC-01', 'KSI-01']);
    expect((await listBranches(db, seed.manager)).branches.map((b) => b.code)).toEqual(['KSI-01']);
  });

  it('agents cannot use portal reads', async () => {
    await expect(listBranches(db, agentActor())).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
    await expect(searchMembers(db, agentActor(), { query: '' })).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
  });

  it('listStaff: a manager sees their branch, not another; a cashier may not list staff', async () => {
    const uids = (await listStaff(db, seed.manager, {})).staff.map((s) => s.uid).sort();
    expect(uids).toEqual(['agent-a', 'agent-b', 'cashier-1', 'manager-1']);
    await expect(listStaff(db, seed.manager, { branchId: otherBranchId })).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
    await expect(listStaff(db, seed.cashier, {})).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
  });

  it('listAgentPairs and listDevices return the documented shapes', async () => {
    const { agentPairs } = await listAgentPairs(db, seed.cashier, {});
    expect(agentPairs).toEqual([
      { id: seed.agentPairId, branchId: seed.branchId, name: 'Pair 1', agentAUid: 'agent-a', agentBUid: 'agent-b', status: 'ACTIVE' },
    ]);
    const { devices } = await listDevices(db, seed.manager, { branchId: seed.branchId });
    expect(devices).toHaveLength(1);
    expect(devices[0]).toMatchObject({ id: 'device-a', agentUid: 'agent-a', status: 'ACTIVE', revokeReason: null });
    expect(devices[0]!.keyFingerprint).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    expect((await listDevices(db, seed.admin, { branchId: otherBranchId })).devices).toEqual([]);
  });

  it('listSusuProducts', async () => {
    expect((await listSusuProducts(db, seed.cashier)).products).toEqual([
      { id: seed.productId, code: 'DAILY', version: 1, name: 'Daily Susu', frequency: 'DAILY', status: 'ACTIVE' },
    ]);
  });
});

describe('searchMembers', () => {
  async function register(fullName: string, phone: string, maker: Actor = seed.cashier) {
    return db.transaction((tx) =>
      registerMember(tx, maker, {
        branchId: seed.branchId,
        fullName,
        phone,
        ghanaCardNumber: nextGhanaCard(),
        dateOfBirth: '1991-01-01',
        consentGiven: true,
      }),
    );
  }

  it('finds by name fragment, local or E.164 phone, and full Ghana Card; masks phone and card', async () => {
    await register('Kwabena Ofori', '0551112233');
    const byName = await searchMembers(db, seed.manager, { query: 'ofori' });
    expect(byName.members.map((m) => m.fullName)).toEqual(['Kwabena Ofori']);
    expect(byName.members[0]).toMatchObject({ phoneMasked: '055 ••• ••33', status: 'PENDING_APPROVAL', branchId: seed.branchId });
    expect(byName.members[0]!.ghanaCardMasked).toMatch(/^GHA-•{9}-\d$/);

    expect((await searchMembers(db, seed.manager, { query: '055 111 2233' })).members).toHaveLength(1);
    expect((await searchMembers(db, seed.manager, { query: '+233551112233' })).members).toHaveLength(1);

    const card = (await db.query<{ ghana_card_number: string }>(`select ghana_card_number from members where full_name = 'Kwabena Ofori'`)).rows[0]!.ghana_card_number;
    expect((await searchMembers(db, seed.manager, { query: card.toLowerCase() })).members).toHaveLength(1);
  });

  it('treats % and _ literally', async () => {
    await register('Percy 100% Sure', '0201110000');
    expect((await searchMembers(db, seed.manager, { query: '%' })).members.map((m) => m.fullName)).toEqual(['Percy 100% Sure']);
    expect((await searchMembers(db, seed.manager, { query: '_' })).members).toEqual([]);
  });

  it('filters by status and pages newest first without gaps or repeats', async () => {
    for (let i = 0; i < 5; i++) await register(`Page Member ${i}`, `02400000${10 + i}`);
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page: Awaited<ReturnType<typeof searchMembers>> = await searchMembers(db, seed.manager, { query: 'page member', limit: 2, cursor });
      seen.push(...page.members.map((m) => m.fullName));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual(['Page Member 4', 'Page Member 3', 'Page Member 2', 'Page Member 1', 'Page Member 0']);
    expect((await searchMembers(db, seed.manager, { query: '', status: 'ACTIVE' })).members.map((m) => m.id)).toEqual([seed.memberId]);
  });

  it('head office searches all branches; branch staff only their own', async () => {
    expect((await searchMembers(db, finance(), { query: '' })).members).toHaveLength(2);
    expect((await searchMembers(db, seed.cashier, { query: '' })).members.map((m) => m.id)).toEqual([seed.memberId]);
    await expect(searchMembers(db, seed.cashier, { query: '', branchId: otherBranchId })).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
  });

  it('rejects a forged cursor', async () => {
    await expect(searchMembers(db, seed.manager, { query: '', cursor: 'not-a-cursor' })).rejects.toMatchObject({ reason: 'INVALID_COMMAND' });
  });
});

describe('getMember', () => {
  it('returns the profile and account balances', async () => {
    const c = signedCollection(seed.key, { ...seed, amountPesewas: 2_500 });
    await processAgentCommand(db, c.id, c.body);
    const { profile } = await getMember(db, seed.manager, { memberId: seed.memberId });
    expect(profile).toMatchObject({
      id: seed.memberId,
      branchId: seed.branchId,
      fullName: 'Ama Mensah',
      phone: '+233241234567',
      dateOfBirth: '1990-04-12',
      status: 'ACTIVE',
      kycStatus: 'DRAFT',
      createdBy: 'cashier-1',
      approvedBy: 'manager-1',
      photoCount: 0,
      photoUrls: [],
    });
    expect(profile.accounts).toEqual([{ id: seed.susuAccountId, productName: 'Daily Susu', balancePesewas: 2_500, status: 'ACTIVE' }]);
  });

  it('full Ghana Card and photos only for SUPER_ADMIN, COMPLIANCE, or that branch’s manager', async () => {
    const photo = `kyc-inbox/cashier-1/${randomUUID()}.jpg`;
    const { memberId } = await db.transaction((tx) =>
      registerMember(tx, seed.cashier, {
        branchId: seed.branchId,
        fullName: 'Efua Koomson',
        phone: '0244445555',
        ghanaCardNumber: nextGhanaCard(),
        dateOfBirth: '1993-03-03',
        photoPaths: [photo],
        consentGiven: true,
      }),
    );
    for (const who of [seed.manager, seed.admin, compliance()]) {
      const r = await getMember(db, who, { memberId });
      expect(r.profile.ghanaCardNumber).toMatch(/^GHA-\d{9}-\d$/);
      expect(r.photoPathsToSign).toEqual([`kyc/${memberId}/${photo.split('/').pop()}`]);
    }
    for (const who of [seed.cashier, finance(), actor('supervisor-1', 'SUPERVISOR', [seed.branchId])]) {
      const r = await getMember(db, who, { memberId });
      expect(r.profile.ghanaCardNumber).toBeNull();
      expect(r.profile.ghanaCardMasked).toMatch(/^GHA-•{9}-\d$/);
      expect(r.photoPathsToSign).toEqual([]);
    }
  });

  it('refuses another branch’s member', async () => {
    await expect(getMember(db, seed.manager, { memberId: otherMember.memberId })).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
  });
});

describe('getAccountStatement', () => {
  it('lists lines newest first with the running balance, plus the account header, and pages', async () => {
    for (const [seq, amount] of [[1, 1_000], [2, 2_000], [3, 500]] as const) {
      const c = signedCollection(seed.key, { ...seed, seq, amountPesewas: amount });
      await processAgentCommand(db, c.id, c.body);
    }
    const first = await getAccountStatement(db, seed.cashier, { susuAccountId: seed.susuAccountId, limit: 2 });
    expect(first.account).toEqual({
      id: seed.susuAccountId,
      memberId: seed.memberId,
      productName: 'Daily Susu',
      balancePesewas: 3_500,
      status: 'ACTIVE',
    });
    expect(first.lines.map((l) => [l.creditPesewas, l.balanceAfterPesewas])).toEqual([
      [500, 3_500],
      [2_000, 3_000],
    ]);
    expect(first.lines[0]).toMatchObject({ kind: 'SUSU_COLLECTION', debitPesewas: 0 });
    const second = await getAccountStatement(db, seed.cashier, { susuAccountId: seed.susuAccountId, limit: 2, cursor: first.nextCursor });
    expect(second.lines.map((l) => l.balanceAfterPesewas)).toEqual([1_000]);
    expect(second.nextCursor).toBeNull();
  });

  it('refuses another branch’s account', async () => {
    await expect(getAccountStatement(db, seed.cashier, { susuAccountId: otherMember.susuAccountId })).rejects.toMatchObject({
      reason: 'NOT_PERMITTED',
    });
  });
});

describe('listPendingApprovals', () => {
  it('lists pending members with the maker, scoped to branch, for checkers only', async () => {
    const { memberId } = await db.transaction((tx) =>
      registerMember(tx, seed.cashier, {
        branchId: seed.branchId,
        fullName: 'Yaa Asantewaa',
        phone: '0247778888',
        ghanaCardNumber: nextGhanaCard(),
        dateOfBirth: '1980-08-08',
        consentGiven: true,
      }),
    );
    const { items } = await listPendingApprovals(db, seed.manager, {});
    expect(items).toEqual([
      expect.objectContaining({ kind: 'MEMBER_REGISTRATION', id: memberId, summary: 'New member: Yaa Asantewaa', requestedBy: 'cashier-1', branchId: seed.branchId }),
    ]);
    expect((await listPendingApprovals(db, seed.admin, { branchId: otherBranchId })).items).toEqual([]);
    await expect(listPendingApprovals(db, seed.cashier, {})).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
  });
});

describe('listAuditEvents', () => {
  it('head office sees company events; a manager sees only their branch', async () => {
    const all = await listAuditEvents(db, seed.admin, { limit: 200 });
    expect(all.events.some((e) => e.action === 'staff.created' && e.branchId === null)).toBe(true);
    const mine = await listAuditEvents(db, seed.manager, { limit: 200 });
    expect(mine.events.length).toBeGreaterThan(0);
    expect(mine.events.every((e) => e.branchId === seed.branchId)).toBe(true);
    await expect(listAuditEvents(db, seed.cashier, {})).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
  });

  it('filters by entity and pages newest first', async () => {
    const memberEvents = await listAuditEvents(db, seed.admin, { entityKind: 'member', entityId: seed.memberId });
    expect(memberEvents.events.map((e) => e.action)).toEqual(['member.approved', 'member.registered']);
    const page1 = await listAuditEvents(db, seed.admin, { limit: 3 });
    const page2 = await listAuditEvents(db, seed.admin, { limit: 3, cursor: page1.nextCursor });
    expect(page1.events).toHaveLength(3);
    expect(new Set([...page1.events, ...page2.events].map((e) => `${e.at}${e.action}${e.entityId}`)).size).toBe(page1.events.length + page2.events.length);
  });
});

describe('read models', () => {
  it('sync health counts received, posted, rejected and missing sequence numbers (L1)', async () => {
    for (const seq of [1, 2, 5]) {
      const c = signedCollection(seed.key, { ...seed, seq });
      await processAgentCommand(db, c.id, c.body);
    }
    const bad = signedCollection(seed.key, { memberId: otherMember.memberId, susuAccountId: otherMember.susuAccountId, seq: 6 });
    await processAgentCommand(db, bad.id, bad.body);

    const health = await pairSyncHealthForDevice(db, seed.deviceId);
    expect(health).toMatchObject({ branchId: seed.branchId, agentPairId: seed.agentPairId });
    expect(health!.devices).toEqual([
      expect.objectContaining({ deviceId: 'device-a', agentUid: 'agent-a', lastSeq: 6, received: 4, posted: 3, rejected: 1, missingSeqCount: 2 }),
    ]);
  });

  it('device status docs follow binding and revocation', async () => {
    expect((await deviceStatusDocs(db, ['device-a'])).get('device-a')).toMatchObject({ status: 'ACTIVE', agentUid: 'agent-a', branchId: seed.branchId });
    await db.transaction((tx) => revokeDevice(tx, seed.manager, { deviceId: 'device-a', reason: 'Phone lost' }));
    expect((await deviceStatusDocs(db, ['device-a', 'unknown'])).get('device-a')).toMatchObject({ status: 'REVOKED', revokeReason: 'Phone lost' });
  });
});
