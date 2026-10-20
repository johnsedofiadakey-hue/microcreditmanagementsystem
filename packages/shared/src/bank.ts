import { z } from 'zod';
import { branchDaySchema } from './cash';
import { positivePesewasSchema } from './money';

/**
 * Step 7 (BUILD_PLAN §7.2, API.md §2): branch close → bank deposit → bank statement match.
 *
 *  1. A cashier or branch manager records a deposit: cash leaving the vault for one business's bank
 *     account, against one or more of that business's closed branch days.
 *  2. Finance imports the bank statement lines.
 *  3. Finance (not the person who recorded the deposit) matches each deposit to its statement line.
 *     A difference is posted to the branch's variance and opens a DEPOSIT_DIFFERENCE case.
 * An unmatched deposit stays visible on the dashboards until it is matched.
 */

const note = z.string().trim().max(500).optional();
const reason = z.string().trim().min(3).max(500);

// ── Bank accounts ──

export const createBankAccountRequestSchema = z
  .object({
    businessId: z.uuid(),
    bankName: z.string().trim().min(2).max(80),
    accountName: z.string().trim().min(2).max(120),
    /** Only the last four digits are stored. */
    accountNumberLast4: z.string().regex(/^\d{4}$/, 'Last four digits of the account number'),
  })
  .strict();
export type CreateBankAccountRequest = z.infer<typeof createBankAccountRequestSchema>;

export const listBankAccountsRequestSchema = z.object({ businessId: z.uuid().optional() }).strict();
export interface BankAccountSummary {
  id: string;
  businessId: string;
  bankName: string;
  accountName: string;
  accountNumberLast4: string;
  status: 'ACTIVE' | 'CLOSED';
  /** What the ledger says is in the bank from matched deposits. */
  balancePesewas: number;
}

// ── Deposits ──

export const recordBankDepositRequestSchema = z
  .object({
    branchId: z.uuid(),
    businessId: z.uuid(),
    bankAccountId: z.uuid(),
    amountPesewas: positivePesewasSchema,
    /** The bank's deposit slip / teller reference, as printed. Unique per bank account. */
    slipReference: z.string().trim().min(1).max(64),
    depositedOn: branchDaySchema,
    /** Which closed days this cash came from; amounts sum to `amountPesewas`. */
    days: z
      .array(z.object({ day: branchDaySchema, amountPesewas: positivePesewasSchema }).strict())
      .min(1)
      .max(31),
    note,
  })
  .strict();
export type RecordBankDepositRequest = z.infer<typeof recordBankDepositRequestSchema>;

export const BANK_DEPOSIT_STATUSES = ['UNMATCHED', 'MATCHED'] as const;
export type BankDepositStatus = (typeof BANK_DEPOSIT_STATUSES)[number];

export const listBankDepositsRequestSchema = z
  .object({
    branchId: z.uuid().optional(),
    businessId: z.uuid().optional(),
    status: z.enum(BANK_DEPOSIT_STATUSES).optional(),
    cursor: z.string().max(400).nullish(),
    limit: z.int().min(1).max(200).optional(),
  })
  .strict();

export interface BankDepositSummary {
  id: string;
  branchId: string;
  businessId: string;
  bankAccountId: string;
  amountPesewas: number;
  slipReference: string;
  depositedOn: string;
  recordedBy: string;
  recordedAt: string;
  note: string | null;
  days: { day: string; amountPesewas: number }[];
  status: BankDepositStatus;
  match: {
    statementLineId: string;
    lineDate: string;
    bankAmountPesewas: number;
    differencePesewas: number;
    matchedBy: string;
    matchedAt: string;
    caseId: string | null;
  } | null;
  /**
   * For an unmatched deposit: unmatched credit lines on its bank account dated within 14 days on or
   * after it, best first (same amount and reference, then same amount, then nearest date). Max 5.
   */
  candidates: { statementLineId: string; lineDate: string; amountPesewas: number; reference: string; description: string; sameAmount: boolean; referenceMatches: boolean }[];
}

// ── Statement lines ──

export const importBankStatementRequestSchema = z
  .object({
    bankAccountId: z.uuid(),
    lines: z
      .array(
        z
          .object({
            date: branchDaySchema,
            /** Signed: credits (money in) positive, debits negative. Never zero. */
            amountPesewas: z.int().refine((v) => v !== 0, 'Amount cannot be zero'),
            reference: z.string().trim().max(120).default(''),
            description: z.string().trim().max(300).default(''),
            /** Running balance after the line, if the statement has one. Helps tell identical lines apart. */
            balanceAfterPesewas: z.int().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(1000),
  })
  .strict();
export type ImportBankStatementRequest = z.input<typeof importBankStatementRequestSchema>;
export interface ImportBankStatementResult {
  importId: string;
  imported: number;
  /** Lines already imported before (same date, amount, reference, description and balance). */
  duplicates: number;
}

export const BANK_LINE_STATUSES = ['UNMATCHED', 'MATCHED', 'IGNORED'] as const;
export type BankLineStatus = (typeof BANK_LINE_STATUSES)[number];

export const listBankStatementLinesRequestSchema = z
  .object({
    bankAccountId: z.uuid(),
    status: z.enum(BANK_LINE_STATUSES).optional(),
    cursor: z.string().max(400).nullish(),
    limit: z.int().min(1).max(200).optional(),
  })
  .strict();
export interface BankStatementLineSummary {
  id: string;
  bankAccountId: string;
  lineDate: string;
  amountPesewas: number;
  reference: string;
  description: string;
  balanceAfterPesewas: number | null;
  status: BankLineStatus;
  depositId: string | null;
  ignoredReason: string | null;
  importedBy: string;
  importedAt: string;
}

export const matchBankDepositRequestSchema = z
  .object({ depositId: z.uuid(), statementLineId: z.uuid(), note })
  .strict();
export type MatchBankDepositRequest = z.infer<typeof matchBankDepositRequestSchema>;
export interface MatchBankDepositResult {
  matchId: string;
  differencePesewas: number;
  caseId: string | null;
}

/** Set aside a bank line that is not a branch deposit (bank charges, transfers, interest). */
export const ignoreBankStatementLineRequestSchema = z.object({ statementLineId: z.uuid(), reason }).strict();
export type IgnoreBankStatementLineRequest = z.infer<typeof ignoreBankStatementLineRequestSchema>;

// ── Dashboards (Firestore read models, API.md §4) ──

export interface BranchDayBusiness {
  businessId: string;
  businessCode: string;
  collectedPesewas: number;
  collectionCount: number;
  handedOverPesewas: number;
  paidOutPesewas: number;
  closed: boolean;
  /** Cash recorded as deposited against this day's close. */
  depositedPesewas: number;
  /** Of that, what a matched bank line confirms. */
  bankConfirmedPesewas: number;
  openCases: number;
}

/** `branchDashboards/{branchId}/days/{yyyy-mm-dd}` */
export interface BranchDayDashboard {
  branchId: string;
  day: string;
  collectedPesewas: number;
  collectionCount: number;
  /** Pairs that posted at least one collection counted on this day. */
  activePairs: number;
  handedOverPesewas: number;
  /** Records phones numbered that have not reached the server (all the branch's active phones). */
  pendingSyncCount: number;
  /** True when every active business has closed this branch day. */
  closed: boolean;
  paidOutPesewas: number;
  openCases: number;
  unmatchedDeposits: { count: number; amountPesewas: number };
  businesses: BranchDayBusiness[];
  computedAt: string;
}

/** `dashboards/company/days/{yyyy-mm-dd}` */
export interface CompanyDayDashboard {
  day: string;
  collectedPesewas: number;
  collectionCount: number;
  /** Branches where every active business has closed the day. */
  branchesClosed: number;
  branchesOpen: number;
  /** Open cases plus open exceptions (failed commands, SMS, reconciliation). */
  exceptions: number;
  openCases: number;
  unmatchedDeposits: { count: number; amountPesewas: number; oldestDepositedOn: string | null };
  branches: { branchId: string; code: string; name: string; collectedPesewas: number; collectionCount: number; closed: boolean }[];
  businesses: { businessId: string; businessCode: string; collectedPesewas: number; paidOutPesewas: number }[];
  computedAt: string;
}
