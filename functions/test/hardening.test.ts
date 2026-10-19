import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AuthClaims } from '@susu/shared';
import type { Database } from '../src/db/types.js';
import { findLedgerAccountId, getBalance } from '../src/ledger/accounts.js';
import { postJournal } from '../src/ledger/post.js';
import { findBalanceMismatches } from '../src/ledger/reconcile.js';
import { registerMember } from '../src/members/members.js';
import { createAgentPair } from '../src/org/agentPairs.js';
import { createBranch } from '../src/org/branches.js';
import { bindDevice, describeEnrollment } from '../src/org/devices.js';
import { assertStaffActive, createStaffUserFlow, recordStaffUser, type StaffAuth } from '../src/org/staff.js';
import { DomainError } from '../src/lib/errors.js';
import { actor, enrollment, freshDatabase, nextGhanaCard, phoneKey, randomUUID, seedBranch, GADUFIA } from './helpers.js';

let db: Database;
let seed: Awaited<ReturnType<typeof seedBranch>>;
let member: string;
let custody: string;

beforeEach(async () => {
  db = await freshDatabase();
  seed = await seedBranch(db);
  member = (await findLedgerAccountId(db, 'MEMBER_SUSU', seed.susuAccountId, GADUFIA))!;
  custody = (await findLedgerAccountId(db, 'AGENT_CASH_CUSTODY', seed.agentPairId, GADUFIA))!;
});

afterEach(async () => {
  await db.close();
});

function collection(key: string, amountPesewas: number) {
  return {
    idempotencyKey: key,
    kind: 'SUSU_COLLECTION',
    description: 'test',
    branchId: seed.branchId,
    actorUid: 'agent-a',
    channel: 'AGENT_APP' as const,
    lines: [
      { accountId: custody, side: 'DEBIT' as const, amountPesewas },
      { accountId: member, side: 'CREDIT' as const, amountPesewas },
    ],
  };
}

describe('H1 — a committed batch cannot be changed', () => {
  it('refuses a line added to a batch from an earlier transaction', async () => {
    const { batchId } = await db.transaction((tx) => postJournal(tx, collection('h1', 2_000)));
    await expect(
      db.query(`insert into journal_lines (batch_id, account_id, side, amount_pesewas) values ($1, $2, 'CREDIT', 99900)`, [
        batchId,
        member,
      ]),
    ).rejects.toThrow(/already committed/);
    expect(await getBalance(db, member)).toBe(2_000);
  });

  it('re-checks balance at commit when a line is added in the same transaction', async () => {
    await expect(
      db.transaction(async (tx) => {
        const { batchId } = await postJournal(tx, collection('h1b', 2_000));
        await tx.query(`insert into journal_lines (batch_id, account_id, side, amount_pesewas) values ($1, $2, 'CREDIT', 500)`, [
          batchId,
          member,
        ]);
      }),
    ).rejects.toThrow(/unbalanced/);
    expect(await getBalance(db, member)).toBe(0);
  });
});

describe('L3 — a reversal must mirror its original', () => {
  it('refuses a "reversal" with different amounts', async () => {
    const { batchId } = await db.transaction((tx) => postJournal(tx, collection('orig', 2_000)));
    await expect(
      db.transaction((tx) =>
        postJournal(tx, {
          ...collection('fake-rev', 1),
          approvedBy: 'admin-1',
          reversesBatchId: batchId,
          lines: [
            { accountId: member, side: 'DEBIT', amountPesewas: 1 },
            { accountId: custody, side: 'CREDIT', amountPesewas: 1 },
          ],
        }),
      ),
    ).rejects.toThrow(/does not mirror/);
  });
});

describe('M4 — balances follow the journal only', () => {
  it('refuses direct balance updates', async () => {
    await expect(db.query('update account_balances set balance_pesewas = 5000000 where account_id = $1', [member])).rejects.toThrow(
      /maintained from journal_lines/,
    );
    await expect(db.query('delete from account_balances where account_id = $1', [member])).rejects.toThrow(/cannot be deleted/);
  });

  it('refuses a balance row that does not start at zero', async () => {
    const account = await db.query<{ id: string }>(
      `insert into ledger_accounts (kind, owner_id, business_id, name, account_type, normal_side) values ('MEMBER_SUSU', $1, $2, 'x', 'LIABILITY', 'CREDIT') returning id`,
      [randomUUID(), GADUFIA],
    );
    await expect(
      db.query('insert into account_balances (account_id, balance_pesewas) values ($1, 100)', [account.rows[0]!.id]),
    ).rejects.toThrow(/starts at zero/);
  });

  it('refuses a journal line that would take a non-negative account below zero, even past postJournal', async () => {
    await expect(
      db.transaction(async (tx) => {
        const batch = await tx.query<{ id: string }>(
          `insert into journal_batches (idempotency_key, request_hash, kind, description, actor_uid, channel)
           values ('raw-neg', 'x', 'RAW', 'raw', 'ops', 'SYSTEM') returning id`,
        );
        await tx.query(
          `insert into journal_lines (batch_id, account_id, side, amount_pesewas) values ($1, $2, 'DEBIT', 100), ($1, $3, 'CREDIT', 100)`,
          [batch.rows[0]!.id, member, custody],
        );
      }),
    ).rejects.toThrow(/below zero/);
  });

  it('freezes ledger account definitions', async () => {
    await expect(db.query('update ledger_accounts set allow_negative = true where id = $1', [custody])).rejects.toThrow(/immutable/);
    await db.query(`update ledger_accounts set status = 'FROZEN' where id = $1`, [custody]);
  });

  it('nightly reconciliation finds nothing normally, and catches a balance changed with triggers disabled', async () => {
    await db.transaction((tx) => postJournal(tx, collection('rec', 3_000)));
    expect(await findBalanceMismatches(db)).toEqual([]);

    await db.exec('alter table account_balances disable trigger account_balances_guard');
    await db.query('update account_balances set balance_pesewas = 999 where account_id = $1', [member]);
    await db.exec('alter table account_balances enable trigger account_balances_guard');

    expect(await findBalanceMismatches(db)).toEqual([{ accountId: member, storedPesewas: 999, journalPesewas: 3_000 }]);
  });
});

describe('M5 — maker-checker cannot be sidestepped by editing the maker', () => {
  async function pendingMember() {
    return db.transaction((tx) =>
      registerMember(tx, seed.cashier, {
        branchId: seed.branchId,
        fullName: 'Kojo Antwi',
        phone: '0201234567',
        ghanaCardNumber: nextGhanaCard(),
        dateOfBirth: '1988-08-08',
        consentGiven: true,
      }),
    );
  }

  it('refuses changes to the maker, Ghana Card, branch or consent', async () => {
    const { memberId } = await pendingMember();
    for (const change of [
      `created_by = 'someone-else'`,
      `ghana_card_number = 'GHA-000000000-0'`,
      `consent_at = now() - interval '1 day'`,
    ]) {
      await expect(db.query(`update members set ${change} where id = $1`, [memberId])).rejects.toThrow(/immutable/);
    }
  });

  it('refuses activation without approval, and refuses changing an approval', async () => {
    const { memberId } = await pendingMember();
    await expect(db.query(`update members set status = 'ACTIVE' where id = $1`, [memberId])).rejects.toThrow(/through approval/);
    await db.query(`update members set status = 'ACTIVE', approved_by = 'manager-1', approved_at = now() where id = $1`, [memberId]);
    await expect(db.query(`update members set approved_by = 'admin-1' where id = $1`, [memberId])).rejects.toThrow(/cannot be changed/);
  });

  it('refuses deleting a member', async () => {
    await expect(db.query('delete from members where id = $1', [seed.memberId])).rejects.toThrow(/never deleted/);
  });
});

describe('M3 — one active pair per agent', () => {
  it('refuses pairing an agent who is already paired', async () => {
    await db.transaction((tx) =>
      recordStaffUser(tx, seed.admin, 'agent-c', {
        email: 'agent-c@example.test',
        displayName: 'C',
        role: 'AGENT',
        branchIds: [seed.branchId],
      }),
    );
    await expect(
      db.transaction((tx) =>
        createAgentPair(tx, seed.manager, { branchId: seed.branchId, name: 'Pair 2', agentAUid: 'agent-a', agentBUid: 'agent-c' }),
      ),
    ).rejects.toMatchObject({ reason: 'CONFLICT' });
  });

  it('the database refuses a second membership even if application checks are skipped', async () => {
    const other = await db.query<{ id: string }>(
      `insert into agent_pairs (branch_id, name, agent_a_uid, agent_b_uid, created_by)
       values ($1, 'Rogue', 'agent-a', 'cashier-1', 'ops') returning id`,
      [seed.branchId],
    );
    await expect(
      db.query('insert into agent_pair_members (agent_uid, agent_pair_id) values ($1, $2)', ['agent-a', other.rows[0]!.id]),
    ).rejects.toThrow();
  });
});

describe('H2 — binding requires the phone’s own enrolment', () => {
  async function newAgentPair() {
    for (const uid of ['agent-c', 'agent-d']) {
      await db.transaction((tx) =>
        recordStaffUser(tx, seed.admin, uid, { email: `${uid}@example.test`, displayName: uid, role: 'AGENT', branchIds: [seed.branchId] }),
      );
    }
    return db.transaction((tx) =>
      createAgentPair(tx, seed.manager, { branchId: seed.branchId, name: 'Pair 2', agentAUid: 'agent-c', agentBUid: 'agent-d' }),
    );
  }

  it('refuses a phone that has not enrolled, or was enrolled by another agent', async () => {
    const { agentPairId } = await newAgentPair();
    const input = { deviceId: 'device-c', agentUid: 'agent-c', agentPairId };
    await expect(db.transaction((tx) => bindDevice(tx, seed.manager, input, null))).rejects.toMatchObject({
      reason: 'DEVICE_NOT_ENROLLED',
    });
    await expect(
      db.transaction((tx) => bindDevice(tx, seed.manager, input, enrollment('agent-d', phoneKey()))),
    ).rejects.toMatchObject({ reason: 'DEVICE_AGENT_MISMATCH' });
  });

  it('refuses a key that is not EC P-256', async () => {
    const { agentPairId } = await newAgentPair();
    const { generateKeyPairSync } = await import('node:crypto');
    const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
    await expect(
      db.transaction((tx) =>
        bindDevice(tx, seed.manager, { deviceId: 'device-c', agentUid: 'agent-c', agentPairId }, { agentUid: 'agent-c', publicKey: rsa }),
      ),
    ).rejects.toMatchObject({ reason: 'DEVICE_NOT_ENROLLED' });
  });

  it('shows the same fingerprint before binding as it stores at binding', async () => {
    const { agentPairId } = await newAgentPair();
    const key = phoneKey();
    const before = await db.transaction((tx) => describeEnrollment(tx, seed.manager, 'device-c', enrollment('agent-c', key)));
    const bound = await db.transaction((tx) =>
      bindDevice(tx, seed.manager, { deviceId: 'device-c', agentUid: 'agent-c', agentPairId }, enrollment('agent-c', key)),
    );
    expect(before.keyFingerprint).toMatch(/^[0-9A-F]{4}(-[0-9A-F]{4}){3}$/);
    expect(bound.keyFingerprint).toBe(before.keyFingerprint);
  });
});

describe('M1 — live staff record must match the token', () => {
  it('passes for an active user whose role and branches match', async () => {
    await assertStaffActive(db, seed.manager);
  });

  it('refuses a disabled user, a demoted user, and a user whose branches changed', async () => {
    await db.query(`update staff_users set status = 'DISABLED' where uid = 'cashier-1'`);
    await expect(assertStaffActive(db, seed.cashier)).rejects.toMatchObject({ reason: 'STAFF_NOT_ACTIVE' });

    await db.query(`update staff_users set role = 'CASHIER' where uid = 'manager-1'`);
    await expect(assertStaffActive(db, seed.manager)).rejects.toMatchObject({ reason: 'STAFF_NOT_ACTIVE' });

    await expect(assertStaffActive(db, { ...seed.admin, claims: { ...seed.admin.claims, branchIds: [seed.branchId] } })).rejects.toMatchObject({
      reason: 'STAFF_NOT_ACTIVE',
    });
  });

  it('refuses someone with no staff record at all', async () => {
    await expect(assertStaffActive(db, actor('ghost', 'SUPER_ADMIN'))).rejects.toMatchObject({ reason: 'STAFF_NOT_ACTIVE' });
  });
});

describe('M2 — createStaffUser authorises before creating anything', () => {
  function fakeAuth(existingEmails: string[] = []) {
    const created: string[] = [];
    const deleted: string[] = [];
    const claims = new Map<string, AuthClaims>();
    const auth: StaffAuth = {
      async createUser({ email }) {
        if (existingEmails.includes(email)) throw Object.assign(new Error('exists'), { code: 'auth/email-already-exists' });
        const uid = `uid-${created.length + 1}`;
        created.push(uid);
        return { uid };
      },
      async deleteUser(uid) {
        deleted.push(uid);
      },
      async setClaims(uid, c) {
        claims.set(uid, c);
      },
      async passwordSetupLink() {
        return 'https://example.test/reset';
      },
    };
    return { auth, created, deleted, claims };
  }

  const newCashier = (email: string) => ({ email, displayName: 'New', role: 'CASHIER' as const, branchIds: [seed.branchId] });

  it('a cashier is refused the same way whether or not the email exists, and nothing is created', async () => {
    const fake = fakeAuth(['admin@susu.test']);
    for (const email of ['new@susu.test', 'admin@susu.test']) {
      await expect(createStaffUserFlow(db, fake.auth, seed.cashier, newCashier(email))).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
    }
    expect(fake.created).toEqual([]);
  });

  it('a duplicate email is a CONFLICT for an authorised caller', async () => {
    const fake = fakeAuth(['taken@susu.test']);
    await expect(createStaffUserFlow(db, fake.auth, seed.manager, newCashier('taken@susu.test'))).rejects.toMatchObject({
      reason: 'CONFLICT',
    });
  });

  it('creates, records and sets claims for an authorised caller', async () => {
    const fake = fakeAuth();
    const result = await createStaffUserFlow(db, fake.auth, seed.manager, newCashier('fresh@susu.test'));
    expect(fake.claims.get(result.uid)).toEqual({ role: 'CASHIER', branchIds: [seed.branchId] });
    expect((await db.query('select 1 from staff_users where uid = $1', [result.uid])).rowCount).toBe(1);
  });

  it('deletes the Auth user again if recording fails', async () => {
    const fake = fakeAuth();
    await db.query(`insert into staff_users (uid, email, display_name, role, created_by) values ('x', 'dupe@susu.test', 'X', 'CASHIER', 'ops')`);
    await expect(createStaffUserFlow(db, fake.auth, seed.manager, newCashier('dupe@susu.test'))).rejects.toMatchObject({ reason: 'CONFLICT' });
    expect(fake.deleted).toEqual(fake.created);
  });
});

describe('M6 / L4 — member registration', () => {
  const base = () => ({
    branchId: seed.branchId,
    fullName: 'Akua Sarpong',
    phone: '0241239876',
    ghanaCardNumber: nextGhanaCard(),
    dateOfBirth: '1995-05-05',
    consentGiven: true as const,
  });

  it('accepts photos from the caller’s own inbox and stores them under the member', async () => {
    const photo = `kyc-inbox/cashier-1/${randomUUID()}.jpg`;
    const result = await db.transaction((tx) => registerMember(tx, seed.cashier, { ...base(), photoPaths: [photo] }));
    expect(result.photoMoves).toEqual([{ from: photo, to: `kyc/${result.memberId}/${photo.split('/').pop()}` }]);
    const stored = await db.query<{ photo_paths: string[] }>('select photo_paths from members where id = $1', [result.memberId]);
    expect(stored.rows[0]!.photo_paths).toEqual([result.photoMoves[0]!.to]);
  });

  it('refuses another user’s inbox, locked kyc/ paths, and arbitrary paths', async () => {
    for (const path of [`kyc-inbox/agent-a/${randomUUID()}.jpg`, `kyc/${seed.memberId}/card.jpg`, '../../etc/passwd']) {
      await expect(db.transaction((tx) => registerMember(tx, seed.cashier, { ...base(), photoPaths: [path] }))).rejects.toThrow();
    }
  });

  it('does not reveal a member ID from another branch on a duplicate Ghana Card', async () => {
    const other = await db.transaction((tx) => createBranch(tx, seed.admin, { name: 'Tamale', code: 'TML' }));
    const otherCashier = actor('cashier-t', 'CASHIER', [other.branchId]);
    const card = nextGhanaCard();
    await db.transaction((tx) => registerMember(tx, seed.cashier, { ...base(), ghanaCardNumber: card }));
    const error = await db
      .transaction((tx) => registerMember(tx, otherCashier, { ...base(), branchId: other.branchId, ghanaCardNumber: card }))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).reason).toBe('CONFLICT');
    expect((error as DomainError).details).toEqual({});
  });
});
