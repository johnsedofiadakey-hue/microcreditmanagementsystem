import { z } from 'zod';
import { pesewasSchema, positivePesewasSchema } from './money';

/**
 * Cash handover, withdrawals and branch close (BUILD_PLAN Step 6, API.md §2). Every money movement
 * here is a balanced journal batch; every money-out needs two different people.
 */

/** A branch day is the Accra date (GMT, no DST), yyyy-mm-dd. */
export const branchDaySchema = z.iso.date();

/**
 * Withdrawals above this need head-office approval (SUPER_ADMIN or FINANCE); at or below it a
 * BRANCH_MANAGER of the branch may approve. GH₵ 5,000.00 until the client's approval matrix
 * (BUILD_PLAN §7, decision 2) says otherwise.
 */
export const WITHDRAWAL_HEAD_OFFICE_THRESHOLD_PESEWAS = 500_000;

/** Largest single withdrawal the platform accepts: GH₵ 100,000.00. */
export const WITHDRAWAL_MAX_PESEWAS = 10_000_000;

const reason = z.string().trim().min(3).max(500);
const note = z.string().trim().max(500).optional();

// ── Handover ──

export const recordHandoverRequestSchema = z
  .object({
    agentPairId: z.uuid(),
    /** What the cashier saw as expected when counting; refused with CONFLICT if it has changed since. */
    expectedPesewas: pesewasSchema,
    countedPesewas: pesewasSchema,
    note,
  })
  .strict();
export type RecordHandoverRequest = z.infer<typeof recordHandoverRequestSchema>;

export interface HandoverResult {
  handoverId: string;
  /** counted − expected: negative is a shortage, positive an overage. */
  differencePesewas: number;
  /** Opened when the difference isn't zero. */
  caseId: string | null;
}

export const listHandoversRequestSchema = z.object({ branchId: z.uuid().optional(), day: branchDaySchema.optional() }).strict();
export interface HandoverSummary {
  id: string;
  branchId: string;
  agentPairId: string;
  agentPairName: string;
  day: string;
  expectedPesewas: number;
  countedPesewas: number;
  differencePesewas: number;
  receivedBy: string;
  receivedAt: string;
  note: string | null;
  caseId: string | null;
  batchId: string;
}

// ── Withdrawals ──

export const WITHDRAWAL_STATUSES = ['PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID'] as const;
export type WithdrawalStatus = (typeof WITHDRAWAL_STATUSES)[number];

export const requestWithdrawalRequestSchema = z
  .object({
    susuAccountId: z.uuid(),
    amountPesewas: positivePesewasSchema.max(WITHDRAWAL_MAX_PESEWAS),
    reason,
  })
  .strict();
export type RequestWithdrawalRequest = z.infer<typeof requestWithdrawalRequestSchema>;

export const decideWithdrawalRequestSchema = z.object({ withdrawalId: z.uuid() }).strict();
export type DecideWithdrawalRequest = z.infer<typeof decideWithdrawalRequestSchema>;

export const rejectWithdrawalRequestSchema = z.object({ withdrawalId: z.uuid(), reason }).strict();
export type RejectWithdrawalRequest = z.infer<typeof rejectWithdrawalRequestSchema>;

export const listWithdrawalsRequestSchema = z
  .object({ branchId: z.uuid().optional(), status: z.enum(WITHDRAWAL_STATUSES).optional() })
  .strict();
export interface WithdrawalSummary {
  id: string;
  branchId: string;
  memberId: string;
  memberName: string;
  susuAccountId: string;
  amountPesewas: number;
  reason: string;
  status: WithdrawalStatus;
  /** True when only SUPER_ADMIN or FINANCE may approve it. */
  needsHeadOffice: boolean;
  requestedBy: string;
  requestedAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  rejectReason: string | null;
  paidBy: string | null;
  paidAt: string | null;
  batchId: string | null;
}

// ── Cases (differences and other exceptions that need a person) ──

export const CASE_KINDS = ['HANDOVER_DIFFERENCE', 'CLOSE_DIFFERENCE'] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

export const resolveCaseRequestSchema = z.object({ caseId: z.uuid(), resolution: reason }).strict();
export type ResolveCaseRequest = z.infer<typeof resolveCaseRequestSchema>;

export const listCasesRequestSchema = z
  .object({ branchId: z.uuid().optional(), status: z.enum(['OPEN', 'RESOLVED']).optional() })
  .strict();
export interface CaseSummary {
  id: string;
  branchId: string;
  kind: CaseKind;
  status: 'OPEN' | 'RESOLVED';
  /** Signed: negative is a shortage. */
  amountPesewas: number;
  summary: string;
  entityKind: string;
  entityId: string;
  openedBy: string;
  openedAt: string;
  resolvedBy: string | null;
  resolvedAt: string | null;
  resolution: string | null;
}

// ── Branch close ──

export const submitBranchCountRequestSchema = z
  .object({ branchId: z.uuid(), day: branchDaySchema, countedPesewas: pesewasSchema, note })
  .strict();
export type SubmitBranchCountRequest = z.infer<typeof submitBranchCountRequestSchema>;

export const closeBranchDayRequestSchema = z.object({ branchId: z.uuid(), day: branchDaySchema, note }).strict();
export type CloseBranchDayRequest = z.infer<typeof closeBranchDayRequestSchema>;

export const getBranchCloseRequestSchema = z.object({ branchId: z.uuid(), day: branchDaySchema }).strict();

export interface PairCashPosition {
  agentPairId: string;
  agentPairName: string;
  /** Posted collections not yet handed over (the pair's custody balance). */
  custodyPesewas: number;
  /** Records the pair's phones numbered that never reached the server (sync health missingSeqCount). */
  missingRecordCount: number;
}

/** What a branch close is checked against. Computed live until the day is closed, then frozen. */
export interface BranchCloseChecklist {
  branchId: string;
  day: string;
  status: 'OPEN' | 'COUNTED' | 'CLOSED';
  /** BRANCH_CASH ledger balance — what the vault should hold. */
  expectedCashPesewas: number;
  /** Latest cashier count for the day, if any. */
  count: { countedPesewas: number; differencePesewas: number; countedBy: string; countedAt: string; note: string | null } | null;
  collectedTodayPesewas: number;
  handedOverTodayPesewas: number;
  paidOutTodayPesewas: number;
  pairs: PairCashPosition[];
  approvedUnpaid: { count: number; amountPesewas: number };
  pendingApprovals: number;
  openCases: number;
  /** Things the manager confirms they have seen; none of them blocks the close. */
  warnings: string[];
  closedBy: string | null;
  closedAt: string | null;
}
