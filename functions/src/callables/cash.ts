import {
  closeBranchDayRequestSchema,
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
import { resolveCase } from '../cash/cases.js';
import { closeBranchDay, submitBranchCount } from '../cash/close.js';
import { confirmHandover, listHandoverDeclarations } from '../cash/handovers.js';
import { publishHandoverDeclaration } from '../projections/firestore.js';
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
export const closeBranchDayFn = staffCallable(closeBranchDayRequestSchema, ({ db, actor, input }) =>
  db.transaction((tx) => closeBranchDay(tx, actor, input)),
);
export const listCasesFn = staffCallable(listCasesRequestSchema, ({ db, actor, input }) => listCases(db, actor, input));
export const resolveCaseFn = staffCallable(resolveCaseRequestSchema, async ({ db, actor, input }) => {
  await db.transaction((tx) => resolveCase(tx, actor, input));
  return null;
});
