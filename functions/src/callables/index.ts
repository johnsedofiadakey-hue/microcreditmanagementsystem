import {
  approveMemberRequestSchema,
  bindDeviceRequestSchema,
  createAgentPairRequestSchema,
  createBranchRequestSchema,
  createStaffUserRequestSchema,
  createSusuProductRequestSchema,
  deviceEnrollmentSchema,
  getDeviceEnrollmentRequestSchema,
  openSusuAccountRequestSchema,
  registerMemberRequestSchema,
  revokeDeviceRequestSchema,
  type AuthClaims,
} from '@susu/shared';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { logger } from 'firebase-functions';
import { DomainError } from '../lib/errors.js';
import { approveMember, createSusuProduct, openSusuAccount, registerMember } from '../members/members.js';
import { createAgentPair } from '../org/agentPairs.js';
import { createBranch } from '../org/branches.js';
import { bindDevice, describeEnrollment, revokeDevice, type EnrollmentRecord } from '../org/devices.js';
import { createStaffUserFlow, type StaffAuth } from '../org/staff.js';
import { staffCallable } from './staffCallable.js';

export const createBranchFn = staffCallable(createBranchRequestSchema, ({ db, actor, input }) =>
  db.transaction((tx) => createBranch(tx, actor, input)),
);

const adminStaffAuth: StaffAuth = {
  createUser: (input) => getAuth().createUser({ ...input, disabled: false }),
  deleteUser: (uid) => getAuth().deleteUser(uid),
  setClaims: (uid, claims) => getAuth().setCustomUserClaims(uid, claims),
  passwordSetupLink: (email) => getAuth().generatePasswordResetLink(email),
};

export const createStaffUserFn = staffCallable(createStaffUserRequestSchema, ({ db, actor, input }) =>
  createStaffUserFlow(db, adminStaffAuth, actor, input),
);

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

/** The phone's own enrolment (written by the agent app), validated; null when it hasn't enrolled. */
async function readEnrollment(deviceId: string): Promise<EnrollmentRecord | null> {
  const snapshot = await getFirestore().collection('deviceEnrollments').doc(deviceId).get();
  if (!snapshot.exists) return null;
  const parsed = deviceEnrollmentSchema.safeParse(snapshot.data());
  if (!parsed.success) throw new DomainError('DEVICE_NOT_ENROLLED', 'This phone’s enrolment is malformed. Reinstall the app.');
  return { agentUid: parsed.data.agentUid, publicKey: parsed.data.publicKey };
}

/** Lets a supervisor compare the key fingerprint shown on the phone before binding it. */
export const getDeviceEnrollmentFn = staffCallable(getDeviceEnrollmentRequestSchema, async ({ db, actor, input }) => {
  const enrollment = await readEnrollment(input.deviceId);
  return db.transaction((tx) => describeEnrollment(tx, actor, input.deviceId, enrollment));
});

export const bindDeviceFn = staffCallable(bindDeviceRequestSchema, async ({ db, actor, input }) => {
  const enrollment = await readEnrollment(input.deviceId);
  return db.transaction((tx) => bindDevice(tx, actor, input, enrollment));
});

export const revokeDeviceFn = staffCallable(revokeDeviceRequestSchema, ({ db, actor, input }) =>
  db.transaction((tx) => revokeDevice(tx, actor, input)),
);

/**
 * Checks the caller's uploaded photos exist, registers the member, then moves the photos from the
 * caller's inbox into `kyc/{memberId}/`, where only server-signed URLs can reach them.
 */
export const registerMemberFn = staffCallable(registerMemberRequestSchema, async ({ db, actor, input }) => {
  const bucket = getStorage().bucket();
  for (const path of input.photoPaths) {
    const [exists] = await bucket.file(path).exists();
    if (!exists) throw new DomainError('NOT_FOUND', 'A photo upload was not found. Upload it again.', { path });
  }
  const { memberId, photoMoves } = await db.transaction((tx) => registerMember(tx, actor, input));
  for (const move of photoMoves) {
    try {
      await bucket.file(move.from).move(move.to);
    } catch (error) {
      logger.error('KYC photo move failed; member record points at a missing file', { memberId, move, error });
    }
  }
  return { memberId };
});

export const approveMemberFn = staffCallable(approveMemberRequestSchema, ({ db, actor, input }) =>
  db.transaction((tx) => approveMember(tx, actor, input)),
);

export const createSusuProductFn = staffCallable(createSusuProductRequestSchema, ({ db, actor, input }) =>
  db.transaction((tx) => createSusuProduct(tx, actor, input)),
);

export const openSusuAccountFn = staffCallable(openSusuAccountRequestSchema, ({ db, actor, input }) =>
  db.transaction((tx) => openSusuAccount(tx, actor, input)),
);
