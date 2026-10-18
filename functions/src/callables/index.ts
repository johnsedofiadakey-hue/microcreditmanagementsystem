import {
  approveMemberRequestSchema,
  bindDeviceRequestSchema,
  createAgentPairRequestSchema,
  createBranchRequestSchema,
  createStaffUserRequestSchema,
  createSusuProductRequestSchema,
  openSusuAccountRequestSchema,
  registerMemberRequestSchema,
  revokeDeviceRequestSchema,
  type AuthClaims,
} from '@susu/shared';
import { getAuth } from 'firebase-admin/auth';
import { approveMember, createSusuProduct, openSusuAccount, registerMember } from '../members/members.js';
import { createAgentPair } from '../org/agentPairs.js';
import { createBranch } from '../org/branches.js';
import { bindDevice, revokeDevice } from '../org/devices.js';
import { recordStaffUser } from '../org/staff.js';
import { staffCallable } from './staffCallable.js';

export const createBranchFn = staffCallable(createBranchRequestSchema, ({ db, actor, input }) =>
  db.transaction((tx) => createBranch(tx, actor, input)),
);

/**
 * Creates the Firebase Auth user, records them in Postgres, then sets claims. If the database step
 * fails the Auth user is deleted again, so nobody exists with a role the ledger doesn't know about.
 */
export const createStaffUserFn = staffCallable(createStaffUserRequestSchema, async ({ db, actor, input }) => {
  const auth = getAuth();
  const user = await auth.createUser({ email: input.email, displayName: input.displayName, disabled: false });
  try {
    await db.transaction((tx) => recordStaffUser(tx, actor, user.uid, input));
  } catch (error) {
    await auth.deleteUser(user.uid).catch(() => undefined);
    throw error;
  }
  const claims: AuthClaims = { role: input.role, branchIds: input.branchIds };
  await auth.setCustomUserClaims(user.uid, claims);
  const resetLink = await auth.generatePasswordResetLink(input.email);
  return { uid: user.uid, passwordSetupLink: resetLink };
});

/** Also stamps agentPairId into both agents' claims so Firestore rules can scope their reads. */
export const createAgentPairFn = staffCallable(createAgentPairRequestSchema, async ({ db, actor, input }) => {
  const result = await db.transaction((tx) => createAgentPair(tx, actor, input));
  const auth = getAuth();
  for (const uid of [input.agentAUid, input.agentBUid]) {
    const claims: AuthClaims = { role: 'AGENT', branchIds: [input.branchId], agentPairId: result.agentPairId };
    await auth.setCustomUserClaims(uid, claims);
  }
  return result;
});

export const bindDeviceFn = staffCallable(bindDeviceRequestSchema, ({ db, actor, input }) =>
  db.transaction((tx) => bindDevice(tx, actor, input)),
);

export const revokeDeviceFn = staffCallable(revokeDeviceRequestSchema, ({ db, actor, input }) =>
  db.transaction((tx) => revokeDevice(tx, actor, input)),
);

export const registerMemberFn = staffCallable(registerMemberRequestSchema, ({ db, actor, input }) =>
  db.transaction((tx) => registerMember(tx, actor, input)),
);

export const approveMemberFn = staffCallable(approveMemberRequestSchema, ({ db, actor, input }) =>
  db.transaction((tx) => approveMember(tx, actor, input)),
);

export const createSusuProductFn = staffCallable(createSusuProductRequestSchema, ({ db, actor, input }) =>
  db.transaction((tx) => createSusuProduct(tx, actor, input)),
);

export const openSusuAccountFn = staffCallable(openSusuAccountRequestSchema, ({ db, actor, input }) =>
  db.transaction((tx) => openSusuAccount(tx, actor, input)),
);
