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
export {
  getAccountStatementFn as getAccountStatement,
  getMemberFn as getMember,
  listAgentPairsFn as listAgentPairs,
  listBusinessesFn as listBusinesses,
  listAuditEventsFn as listAuditEvents,
  listBranchesFn as listBranches,
  listDevicesFn as listDevices,
  listPendingApprovalsFn as listPendingApprovals,
  listStaffFn as listStaff,
  listSusuProductsFn as listSusuProducts,
  searchMembersFn as searchMembers,
  setBusinessModuleFn as setBusinessModule,
} from './callables/reads.js';
export {
  approveCorrectionFn as approveCorrection,
  approveWithdrawalFn as approveWithdrawal,
  closeBranchDayFn as closeBranchDay,
  confirmHandoverFn as confirmHandover,
  getBranchCashDayFn as getBranchCashDay,
  getBranchCloseFn as getBranchClose,
  listCasesFn as listCases,
  listCorrectionsFn as listCorrections,
  listHandoverDeclarationsFn as listHandoverDeclarations,
  listHandoversFn as listHandovers,
  listWithdrawalsFn as listWithdrawals,
  payWithdrawalFn as payWithdrawal,
  rejectCorrectionFn as rejectCorrection,
  rejectWithdrawalFn as rejectWithdrawal,
  requestCollectionCorrectionFn as requestCollectionCorrection,
  requestWithdrawalFn as requestWithdrawal,
  resolveCaseFn as resolveCase,
  submitBranchCountFn as submitBranchCount,
} from './callables/cash.js';
export { assignCollectorFn as assignCollector, unassignCollectorFn as unassignCollector } from './callables/routes.js';
export { onAgentCommandCreated, retryFailedCommands } from './triggers/agentCommands.js';
export { reconcileBalances } from './triggers/reconcile.js';
export { publishDailyRoutes } from './triggers/routes.js';
export { dispatchSmsOutboxJob as dispatchSmsOutbox } from './triggers/sms.js';
export {
  createBankAccountFn as createBankAccount,
  ignoreBankStatementLineFn as ignoreBankStatementLine,
  importBankStatementFn as importBankStatement,
  listBankAccountsFn as listBankAccounts,
  listBankDepositsFn as listBankDeposits,
  listBankStatementLinesFn as listBankStatementLines,
  matchBankDepositFn as matchBankDeposit,
  recordBankDepositFn as recordBankDeposit,
} from './callables/bank.js';
export { publishDayDashboards } from './triggers/dashboards.js';
