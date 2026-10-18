import { initializeApp } from 'firebase-admin/app';
import { setGlobalOptions } from 'firebase-functions/v2';

initializeApp();
setGlobalOptions({ maxInstances: 20 });

export {
  approveMemberFn as approveMember,
  bindDeviceFn as bindDevice,
  createAgentPairFn as createAgentPair,
  createBranchFn as createBranch,
  createStaffUserFn as createStaffUser,
  createSusuProductFn as createSusuProduct,
  openSusuAccountFn as openSusuAccount,
  registerMemberFn as registerMember,
  revokeDeviceFn as revokeDevice,
} from './callables/index.js';
export { onAgentCommandCreated } from './triggers/agentCommands.js';
