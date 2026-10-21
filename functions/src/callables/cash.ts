import {
  closeBranchDayRequestSchema,
  decideCorrectionRequestSchema,
  listCorrectionsRequestSchema,
  rejectCorrectionRequestSchema,
  requestCollectionCorrectionRequestSchema,
  decideWithdrawalRequestSchema,
  getBranchCashDayRequestSchema,
  getBranchCloseRequestSchema,
  listCasesRequestSchema,
  listHandoversRequestSchema,
  listWithdrawalsRequestSchema,
  confirmHandoverRequestSchema,
  listHandoverDeclarationsRequestSchema,
  rejectWithdrawalRequestSchema,
  requestWithdrawalRequestSchema,
  resolveCaseRequestSchema,
  submitBranchCountRequestSchema,
} from '@susu/shared';
import { logger } from 'firebase-functions';
import type { Database } from '../db/types.js';
import { resolveCase } from '../cash/cases.js';
import { approveCorrection, listCorrections, rejectCorrection, requestCollectionCorrection } from '../cash/corrections.js';
import { closeBranchDay, submitBranchCount } from '../cash/close.js';
import { confirmHandover, listHandoverDeclarations } from '../cash/handovers.js';
import { publishBranchAndCompanyDay, publishBranchDay, publishHandoverDeclaration } from '../projections/firestore.js';
import { branchOfRecord } from '../reads/dashboards.js';
import { getBranchCashDay, getBranchClose, listCases, listHandovers, listWithdrawals } from '../cash/reads.js';
import { approveWithdrawal, payWithdrawal, rejectWithdrawal, requestWithdrawal } from '../cash/withdrawals.js';
import { SMS_API_KEY, getDatabase } from '../runtime.js';
import { sendSms } from '../triggers/sms.js';
import { staffCallable } from './staffCallable.js';

// ── Handover: the agents declare on the phone (command), a cashier confirms each business line ──
export const confirmHandoverFn = staffCallable(confirmHandoverRequestSchema, async ({ db, actor, input }) => {
  const result = await db.transaction((tx) => confirmHandover(tx, actor, input));
  // The agents see the cashier's count on their phone.
  await publishHandoverDeclaration(db, input.declarationId);
  await refreshBranchDay(db, 'declaration', input.declarationId);
  return result;
});
export const listHandoverDeclarationsFn = staffCallable(listHandoverDeclarationsRequestSchema, ({ db, actor, input }) =>
  listHandoverDeclarations(db, actor, input),
);
export const listHandoversFn = staffCallable(listHandoversRequestSchema, ({ db, actor, input }) => listHandovers(db, actor, input));

// ── Withdrawals: request → approve (other person) → pay (third person) ──
export const requestWithdrawalFn = staffCallable(requestWithdrawalRequestSchema, ({ db, actor, input }) =>
  db.transaction((tx) => requestWithdrawal(tx, actor, input)),
);
export const approveWithdrawalFn = staffCallable(decideWithdrawalRequestSchema, async ({ db, actor, input }) => {
  await db.transaction((tx) => approveWithdrawal(tx, actor, input));
  return null;
});
export const rejectWithdrawalFn = staffCallable(rejectWithdrawalRequestSchema, async ({ db, actor, input }) => {
  await db.transaction((tx) => rejectWithdrawal(tx, actor, input));
  return null;
});
export const payWithdrawalFn = staffCallable(
  decideWithdrawalRequestSchema,
  async ({ db, actor, input }) => {
    const result = await db.transaction((tx) => payWithdrawal(tx, actor, input));
    try {
      await sendSms(getDatabase(), { dedupeKeys: [`sms:withdrawal:${input.withdrawalId}`], limit: 1 });
    } catch (error) {
      logger.warn('Immediate withdrawal receipt failed; the outbox sweep will retry', { withdrawalId: input.withdrawalId, error });
    }
    await refreshBranchDay(db, 'withdrawal', input.withdrawalId);
    return result;
  },
  { secrets: [SMS_API_KEY] },
);
export const listWithdrawalsFn = staffCallable(listWithdrawalsRequestSchema, ({ db, actor, input }) => listWithdrawals(db, actor, input));

// ── Branch close and cases ──
export const getBranchCloseFn = staffCallable(getBranchCloseRequestSchema, ({ db, actor, input }) => getBranchClose(db, actor, input));
export const getBranchCashDayFn = staffCallable(getBranchCashDayRequestSchema, ({ db, actor, input }) => getBranchCashDay(db, actor, input));
export const submitBranchCountFn = staffCallable(submitBranchCountRequestSchema, ({ db, actor, input }) =>
  db.transaction((tx) => submitBranchCount(tx, actor, input)),
);
export const closeBranchDayFn = staffCallable(closeBranchDayRequestSchema, async ({ db, actor, input }) => {
  const result = await db.transaction((tx) => closeBranchDay(tx, actor, input));
  await publishBranchAndCompanyDay(db, input.branchId, input.day);
  return result;
});
export const listCasesFn = staffCallable(listCasesRequestSchema, ({ db, actor, input }) => listCases(db, actor, input));
export const resolveCaseFn = staffCallable(resolveCaseRequestSchema, async ({ db, actor, input }) => {
  await db.transaction((tx) => resolveCase(tx, actor, input));
  await refreshBranchDay(db, 'case', input.caseId);
  return null;
});

// ── Corrections: request (maker) → approve or reject (a different person); approval posts ──
export const requestCollectionCorrectionFn = staffCallable(requestCollectionCorrectionRequestSchema, ({ db, actor, input }) =>
  db.transaction((tx) => requestCollectionCorrection(tx, actor, input)),
);
export const approveCorrectionFn = staffCallable(decideCorrectionRequestSchema, async ({ db, actor, input }) => {
  const result = await db.transaction((tx) => approveCorrection(tx, actor, input));
  await refreshBranchDay(db, 'correction', input.correctionId);
  return result;
});
export const rejectCorrectionFn = staffCallable(rejectCorrectionRequestSchema, async ({ db, actor, input }) => {
  await db.transaction((tx) => rejectCorrection(tx, actor, input));
  return null;
});
export const listCorrectionsFn = staffCallable(listCorrectionsRequestSchema, ({ db, actor, input }) => listCorrections(db, actor, input));

/** Best-effort: today's dashboard for the branch a record belongs to. */
async function refreshBranchDay(db: Database, kind: 'withdrawal' | 'declaration' | 'case' | 'correction', id: string): Promise<void> {
  const branchId = await branchOfRecord(db, kind, id).catch(() => null);
  if (branchId) await publishBranchDay(db, branchId);
}
