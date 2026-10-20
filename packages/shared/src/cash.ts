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

/**
 * Two parties (audit H3): the agent pair declares per-business amounts from the phone
 * (`HANDOVER_DECLARATION` command, API.md §3), then a cashier who is not one of the pair's agents
 * counts and confirms each business line. There is no cashier-only handover.
 */
export const confirmHandoverRequestSchema = z
  .object({
    declarationId: z.uuid(),
    businessId: z.uuid(),
    /** The pair's custody for this business as the cashier saw it; EXPECTED_CASH_CHANGED if it moved since. */
    expectedPesewas: pesewasSchema,
    countedPesewas: pesewasSchema,
    note,
  })
  .strict();
export type ConfirmHandoverRequest = z.infer<typeof confirmHandoverRequestSchema>;

export interface HandoverResult {
  handoverId: string;
  /** counted − expected custody: negative is a shortage (posted to variance). */
  differencePesewas: number;
  /** counted − what the agents declared. */
  declarationDifferencePesewas: number;
  /** Opened when either difference isn't zero. */
  caseId: string | null;
}

export const DECLARATION_LINE_STATUSES = ['DECLARED', 'CONFIRMED', 'SUPERSEDED'] as const;
export type DeclarationLineStatus = (typeof DECLARATION_LINE_STATUSES)[number];

export interface HandoverDeclarationLine {
  businessId: string;
  businessName: string;
  declaredPesewas: number;
  /** The pair's custody for this business when the server received the declaration (evidence). */
  custodyAtDeclarationPesewas: number;
  /** The pair's custody now: what `confirmHandover.expectedPesewas` must be. Only for DECLARED lines. */
  currentCustodyPesewas: number | null;
  status: DeclarationLineStatus;
  handoverId: string | null;
  countedPesewas: number | null;
  confirmedBy: string | null;
  confirmedAt: string | null;
}

export interface HandoverDeclarationSummary {
  id: string;
  branchId: string;
  agentPairId: string;
  agentPairName: string;
  agentUid: string;
  deviceId: string;
  /** Phone clock (evidence) and server receipt time (official). */
  capturedAt: string;
  receivedAt: string;
  lines: HandoverDeclarationLine[];
}

const cursor = z.string().max(400).nullish();
const limit = z.int().min(1).max(200).optional();

export const listHandoverDeclarationsRequestSchema = z
  .object({ branchId: z.uuid().optional(), status: z.enum(['OPEN', 'ALL']).default('OPEN'), cursor, limit })
  .strict();

export const listHandoversRequestSchema = z
  .object({ branchId: z.uuid().optional(), businessId: z.uuid().optional(), day: branchDaySchema.optional(), cursor, limit })
  .strict();
export interface HandoverSummary {
  id: string;
  branchId: string;
  businessId: string;
  declarationId: string | null;
  /** What the agents declared for this business; null for handovers recorded before audit H3. */
  declaredPesewas: number | null;
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
  .object({
    branchId: z.uuid().optional(),
    businessId: z.uuid().optional(),
    status: z.enum(WITHDRAWAL_STATUSES).optional(),
    cursor,
    limit,
  })
  .strict();
export interface WithdrawalSummary {
  id: string;
  branchId: string;
  /** The account's business, whose vault pays it. */
  businessId: string;
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

/**
 * HANDOVER_DIFFERENCE: counted ≠ expected custody (posted to variance). HANDOVER_DISPUTE: counted ≠ the
 * agents' declaration while matching custody. OFF_ROUTE_COLLECTION: posted by a pair the account is
 * not assigned to (audit H1). CLOSE_DIFFERENCE: vault count ≠ expected at close.
 */
export const CASE_KINDS = ['HANDOVER_DIFFERENCE', 'HANDOVER_DISPUTE', 'CLOSE_DIFFERENCE', 'OFF_ROUTE_COLLECTION', 'DEPOSIT_DIFFERENCE'] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

export const resolveCaseRequestSchema = z.object({ caseId: z.uuid(), resolution: reason }).strict();
export type ResolveCaseRequest = z.infer<typeof resolveCaseRequestSchema>;

export const listCasesRequestSchema = z
  .object({ branchId: z.uuid().optional(), businessId: z.uuid().optional(), status: z.enum(['OPEN', 'RESOLVED']).optional(), cursor, limit })
  .strict();
export interface CaseSummary {
  id: string;
  branchId: string;
  businessId: string;
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
  .object({ branchId: z.uuid(), businessId: z.uuid(), day: branchDaySchema, countedPesewas: pesewasSchema, note })
  .strict();
export type SubmitBranchCountRequest = z.infer<typeof submitBranchCountRequestSchema>;

export const closeBranchDayRequestSchema = z.object({ branchId: z.uuid(), businessId: z.uuid(), day: branchDaySchema, note }).strict();
export type CloseBranchDayRequest = z.infer<typeof closeBranchDayRequestSchema>;

export const getBranchCloseRequestSchema = z.object({ branchId: z.uuid(), businessId: z.uuid(), day: branchDaySchema }).strict();
/** Every business's checklist for one branch day — the cashier's and manager's main screen. */
export const getBranchCashDayRequestSchema = z.object({ branchId: z.uuid(), day: branchDaySchema }).strict();

export interface PairCashPosition {
  agentPairId: string;
  agentPairName: string;
  /** Posted collections of this business not yet handed over (the pair's custody balance for it). */
  custodyPesewas: number;
  /** Records the pair's phones numbered that never reached the server (sync health missingSeqCount). */
  missingRecordCount: number;
}

/** What a branch close is checked against, for one business. Computed live until that business's day is closed, then frozen. */
export interface BranchCloseChecklist {
  branchId: string;
  businessId: string;
  businessName: string;
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
  /** Handover declarations from this business's agents waiting for a cashier. */
  pendingDeclarations: { count: number; declaredPesewas: number };
  /** Collections counted on this day that were recorded off route or under a previous route (audit H1). */
  routeExceptions: { offRouteCount: number; offRoutePesewas: number; previousRouteCount: number };
  /** Collections that arrived after the previous day's close and count here instead (audit H2). */
  carriedIn: { count: number; amountPesewas: number };
  /**
   * Collections received after THIS day closed; they count towards the next day. Live, never part of
   * the frozen close. Always zero while the day is open.
   */
  postedAfterClose: { count: number; amountPesewas: number; countedOnDay: string | null };
  /** Things the manager confirms they have seen; none of them blocks the close. */
  warnings: string[];
  closedBy: string | null;
  closedAt: string | null;
}

export interface BranchCashDay {
  branchId: string;
  day: string;
  /** One per active business, in business-code order. */
  businesses: BranchCloseChecklist[];
}
