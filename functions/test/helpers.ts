import { randomUUID } from 'node:crypto';
import type { AuthClaims, Role } from '@susu/shared';
import { migrate } from '../src/db/migrate.js';
import { createPgliteDatabase } from '../src/db/pglite.js';
import type { Database } from '../src/db/types.js';
import type { Actor } from '../src/lib/actor.js';
import { approveMember, createSusuProduct, openSusuAccount, registerMember } from '../src/members/members.js';
import { createAgentPair } from '../src/org/agentPairs.js';
import { createBranch } from '../src/org/branches.js';
import { bindDevice } from '../src/org/devices.js';
import { recordStaffUser } from '../src/org/staff.js';

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

/** A branch with an admin, manager, cashier, two agents in a pair, a bound phone and one active member with a Susu account. */
export async function seedBranch(db: Database) {
  const admin = actor('admin-1', 'SUPER_ADMIN');

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
  await db.transaction((tx) => bindDevice(tx, manager, { deviceId, agentUid: 'agent-a', agentPairId }));

  const { productId } = await db.transaction((tx) =>
    createSusuProduct(tx, admin, { code: 'DAILY', name: 'Daily Susu', frequency: 'DAILY' }),
  );

  const member = await addActiveMember(db, branchId, cashier, manager, productId);

  return { admin, manager, cashier, branchId, agentPairId, deviceId, productId, ...member };
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

export function collectionCommand(overrides: {
  memberId: string;
  susuAccountId: string;
  amountPesewas?: number;
  seq?: number;
  deviceId?: string;
  agentUid?: string;
}) {
  return {
    type: 'COLLECTION',
    agentUid: overrides.agentUid ?? 'agent-a',
    deviceId: overrides.deviceId ?? 'device-a',
    seq: overrides.seq ?? 1,
    capturedAt: '2026-10-18T09:15:00+00:00',
    appVersion: '0.1.0',
    payload: {
      memberId: overrides.memberId,
      susuAccountId: overrides.susuAccountId,
      amountPesewas: overrides.amountPesewas ?? 2_000,
    },
  };
}

export { randomUUID };
