import { BUSINESS_IDS } from '../src/db/migrations/006_businesses.js';
import { generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { commandSigningString, type AuthClaims, type Role } from '@susu/shared';
import { migrate } from '../src/db/migrate.js';
import { createPgliteDatabase } from '../src/db/pglite.js';
import type { Database } from '../src/db/types.js';
import type { Actor } from '../src/lib/actor.js';
import { approveMember, createSusuProduct, openSusuAccount, registerMember } from '../src/members/members.js';
import { createAgentPair } from '../src/org/agentPairs.js';
import { createBranch } from '../src/org/branches.js';
import { bindDevice, type EnrollmentRecord } from '../src/org/devices.js';
import { recordStaffUser } from '../src/org/staff.js';
import { assignCollector } from '../src/routes/routes.js';

/** The seeded product's business: all existing Susu belongs to Gadufia Fiase Susu Services. */
export const GADUFIA = BUSINESS_IDS.GADUFIA;
export const STF = BUSINESS_IDS.STF;
export const OPWS = BUSINESS_IDS.OPWS;

export async function freshDatabase(): Promise<Database> {
  const db = await createPgliteDatabase();
  await migrate(db);
  return db;
}

export function actor(uid: string, role: Role, branchIds: string[] = [], extra: Partial<AuthClaims> = {}): Actor {
  return { uid, claims: { role, branchIds, ...extra }, channel: 'PORTAL' };
}

let ghanaCardCounter = 100_000_000;
export function nextGhanaCard(): string {
  ghanaCardCounter += 1;
  return `GHA-${ghanaCardCounter}-1`;
}

/** Stand-in for the phone's Android Keystore key: EC P-256, public key exported as SPKI DER base64. */
export interface PhoneKey {
  privateKey: KeyObject;
  publicKeyBase64: string;
}

export function phoneKey(): PhoneKey {
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  return { privateKey, publicKeyBase64: publicKey.export({ format: 'der', type: 'spki' }).toString('base64') };
}

export function enrollment(agentUid: string, key: PhoneKey): EnrollmentRecord {
  return { agentUid, publicKey: key.publicKeyBase64 };
}

/** A branch with an admin, manager, cashier, two agents in a pair, an enrolled and bound phone, and one active member with a Susu account. */
export async function seedBranch(db: Database) {
  const admin = actor('admin-1', 'SUPER_ADMIN');
  await db.query(
    `insert into staff_users (uid, email, display_name, role, created_by) values ('admin-1', 'admin-1@example.test', 'Admin', 'SUPER_ADMIN', 'system')`,
  );

  const { branchId } = await db.transaction((tx) => createBranch(tx, admin, { name: 'Kumasi Central', code: 'KSI-01' }));

  const staff = [
    { uid: 'manager-1', role: 'BRANCH_MANAGER' as const },
    { uid: 'cashier-1', role: 'CASHIER' as const },
    { uid: 'agent-a', role: 'AGENT' as const },
    { uid: 'agent-b', role: 'AGENT' as const },
  ];
  for (const s of staff) {
    await db.transaction((tx) =>
      recordStaffUser(tx, admin, s.uid, {
        email: `${s.uid}@example.test`,
        displayName: s.uid,
        role: s.role,
        branchIds: [branchId],
      }),
    );
  }
  const manager = actor('manager-1', 'BRANCH_MANAGER', [branchId]);
  const cashier = actor('cashier-1', 'CASHIER', [branchId]);

  const { agentPairId } = await db.transaction((tx) =>
    createAgentPair(tx, manager, { branchId, name: 'Pair 1', agentAUid: 'agent-a', agentBUid: 'agent-b' }),
  );
  const deviceId = 'device-a';
  const key = phoneKey();
  await db.transaction((tx) =>
    bindDevice(tx, manager, { deviceId, agentUid: 'agent-a', agentPairId }, enrollment('agent-a', key)),
  );

  const { productId } = await db.transaction((tx) =>
    createSusuProduct(tx, admin, { businessId: GADUFIA, code: 'DAILY', name: 'Daily Susu', frequency: 'DAILY' }),
  );

  const member = await addActiveMember(db, branchId, cashier, manager, productId);
  // On Pair 1's route, as a real account must be for a normal (ON_ROUTE) collection (audit H1).
  await db.transaction((tx) =>
    assignCollector(tx, manager, { susuAccountId: member.susuAccountId, agentPairId, expectedPesewas: 2_000 }),
  );

  return { admin, manager, cashier, branchId, businessId: GADUFIA, agentPairId, deviceId, key, productId, ...member };
}

export async function addActiveMember(db: Database, branchId: string, maker: Actor, checker: Actor, productId: string) {
  const { memberId } = await db.transaction((tx) =>
    registerMember(tx, maker, {
      branchId,
      fullName: 'Ama Mensah',
      phone: '024 123 4567',
      ghanaCardNumber: nextGhanaCard(),
      dateOfBirth: '1990-04-12',
      consentGiven: true,
    }),
  );
  await db.transaction((tx) => approveMember(tx, checker, { memberId }));
  const { susuAccountId } = await db.transaction((tx) => openSusuAccount(tx, checker, { memberId, productId }));
  return { memberId, susuAccountId };
}

/** A COLLECTION command signed with `key`, exactly as the agent app builds it. Returns its ID and body. */
export function signedCollection(
  key: PhoneKey,
  overrides: {
    memberId: string;
    susuAccountId: string;
    amountPesewas?: number;
    seq?: number;
    deviceId?: string;
    agentUid?: string;
    id?: string;
    capturedAt?: string;
  },
) {
  const id = overrides.id ?? randomUUID();
  const body = {
    type: 'COLLECTION' as const,
    agentUid: overrides.agentUid ?? 'agent-a',
    deviceId: overrides.deviceId ?? 'device-a',
    seq: overrides.seq ?? 1,
    capturedAt: overrides.capturedAt ?? '2026-10-18T09:15:00+00:00',
    appVersion: '0.1.0',
    payload: {
      memberId: overrides.memberId,
      susuAccountId: overrides.susuAccountId,
      amountPesewas: overrides.amountPesewas ?? 2_000,
    },
  };
  const sig = sign('sha256', Buffer.from(commandSigningString(id, body), 'utf8'), {
    key: key.privateKey,
    dsaEncoding: 'der',
  }).toString('base64');
  return { id, body: { ...body, sig } };
}

export { randomUUID };

/** A HANDOVER_DECLARATION signed with `key`, as the agent app builds it (audit H3). */
export function signedDeclaration(
  key: PhoneKey,
  overrides: {
    lines: { businessId: string; declaredPesewas: number }[];
    seq: number;
    deviceId?: string;
    agentUid?: string;
    id?: string;
    capturedAt?: string;
  },
) {
  const id = overrides.id ?? randomUUID();
  const body = {
    type: 'HANDOVER_DECLARATION' as const,
    agentUid: overrides.agentUid ?? 'agent-a',
    deviceId: overrides.deviceId ?? 'device-a',
    seq: overrides.seq,
    capturedAt: overrides.capturedAt ?? '2026-10-18T17:30:00Z',
    appVersion: '0.1.0',
    payload: { lines: overrides.lines },
  };
  const sig = sign('sha256', Buffer.from(commandSigningString(id, body), 'utf8'), {
    key: key.privateKey,
    dsaEncoding: 'der',
  }).toString('base64');
  return { id, body: { ...body, sig } };
}
