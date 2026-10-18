import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Database } from '../src/db/types.js';
import { approveMember, openSusuAccount, registerMember } from '../src/members/members.js';
import { createBranch } from '../src/org/branches.js';
import { recordStaffUser } from '../src/org/staff.js';
import { actor, freshDatabase, nextGhanaCard, seedBranch } from './helpers.js';

let db: Database;
let seed: Awaited<ReturnType<typeof seedBranch>>;

beforeEach(async () => {
  db = await freshDatabase();
  seed = await seedBranch(db);
});

afterEach(async () => {
  await db.close();
});

describe('permissions and maker-checker', () => {
  it('only a super admin can create a branch', async () => {
    await expect(
      db.transaction((tx) => createBranch(tx, seed.manager, { name: 'Tema', code: 'TMA' })),
    ).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
  });

  it('a branch manager cannot create head-office roles or staff in other branches', async () => {
    await expect(
      db.transaction((tx) =>
        recordStaffUser(tx, seed.manager, 'x1', {
          email: 'x1@example.test',
          displayName: 'X',
          role: 'FINANCE',
          branchIds: [],
        }),
      ),
    ).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });

    const other = await db.transaction((tx) => createBranch(tx, seed.admin, { name: 'Tema', code: 'TMA' }));
    await expect(
      db.transaction((tx) =>
        recordStaffUser(tx, seed.manager, 'x2', {
          email: 'x2@example.test',
          displayName: 'X',
          role: 'CASHIER',
          branchIds: [other.branchId],
        }),
      ),
    ).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
  });

  it('the person who registers a member cannot approve them', async () => {
    const { memberId } = await db.transaction((tx) =>
      registerMember(tx, seed.manager, {
        branchId: seed.branchId,
        fullName: 'Kofi Boateng',
        phone: '0201112223',
        ghanaCardNumber: nextGhanaCard(),
        dateOfBirth: '1985-01-01',
        consentGiven: true,
      }),
    );
    await expect(db.transaction((tx) => approveMember(tx, seed.manager, { memberId }))).rejects.toMatchObject({
      reason: 'SELF_APPROVAL_FORBIDDEN',
    });
    await db.transaction((tx) => approveMember(tx, seed.admin, { memberId }));
  });

  it('rejects a duplicate Ghana Card', async () => {
    const card = nextGhanaCard();
    const input = {
      branchId: seed.branchId,
      fullName: 'Esi Owusu',
      phone: '0551234567',
      ghanaCardNumber: card,
      dateOfBirth: '1992-02-02',
      consentGiven: true as const,
    };
    await db.transaction((tx) => registerMember(tx, seed.cashier, input));
    await expect(db.transaction((tx) => registerMember(tx, seed.cashier, input))).rejects.toMatchObject({
      reason: 'CONFLICT',
    });
  });

  it('cannot open a Susu account for a member awaiting approval', async () => {
    const { memberId } = await db.transaction((tx) =>
      registerMember(tx, seed.cashier, {
        branchId: seed.branchId,
        fullName: 'Yaw Asante',
        phone: '0271234567',
        ghanaCardNumber: nextGhanaCard(),
        dateOfBirth: '1980-03-03',
        consentGiven: true,
      }),
    );
    await expect(
      db.transaction((tx) => openSusuAccount(tx, seed.manager, { memberId, productId: seed.productId })),
    ).rejects.toMatchObject({ reason: 'MEMBER_NOT_ACTIVE' });
  });

  it('staff cannot act on branches outside their claims', async () => {
    const other = await db.transaction((tx) => createBranch(tx, seed.admin, { name: 'Takoradi', code: 'TKD' }));
    const outsider = actor('cashier-x', 'CASHIER', [other.branchId]);
    await expect(
      db.transaction((tx) =>
        registerMember(tx, outsider, {
          branchId: seed.branchId,
          fullName: 'Abena Darko',
          phone: '0241112222',
          ghanaCardNumber: nextGhanaCard(),
          dateOfBirth: '1999-09-09',
          consentGiven: true,
        }),
      ),
    ).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
  });

  it('writes an audit event for every change', async () => {
    const actions = await db.query<{ action: string }>('select distinct action from audit_events order by action');
    expect(actions.rows.map((r) => r.action)).toEqual([
      'agent_pair.created',
      'branch.created',
      'device.bound',
      'member.approved',
      'member.registered',
      'staff.created',
      'susu_account.opened',
      'susu_product.created',
    ]);
  });
});
