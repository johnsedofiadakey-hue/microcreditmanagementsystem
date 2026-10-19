import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions/v2';

initializeApp();
// 10 instances × a pool of 5 = at most 50 Cloud SQL connections per function. See docs/ops/ENVIRONMENT_CHECKLIST.md.
setGlobalOptions({ maxInstances: 10 });

export {
  approveMemberFn as approveMember,
  bindDeviceFn as bindDevice,
  createAgentPairFn as createAgentPair,
  createBranchFn as createBranch,
  createStaffUserFn as createStaffUser,
  createSusuProductFn as createSusuProduct,
  getDeviceEnrollmentFn as getDeviceEnrollment,
  openSusuAccountFn as openSusuAccount,
  registerMemberFn as registerMember,
  revokeDeviceFn as revokeDevice,
} from './callables/index.js';
export { onAgentCommandCreated, retryFailedCommands } from './triggers/agentCommands.js';
export { reconcileBalances } from './triggers/reconcile.js';
