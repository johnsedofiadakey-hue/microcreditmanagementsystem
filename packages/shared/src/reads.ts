import { z } from 'zod';
import type { KycStatus, MemberStatus, SusuFrequency } from './enums';
import { memberStatusSchema } from './enums';
import type { Role } from './roles';
import type { AccountCollector } from './routes';

/**
 * Read endpoints for the portal (API.md §2). Lists are scoped to the caller's branches; head-office
 * roles (SUPER_ADMIN, FINANCE, COMPLIANCE) see every branch. Paged lists return an opaque
 * `nextCursor` (null on the last page); pass it back unchanged to get the next page.
 */

export const PAGE_SIZE_DEFAULT = 50;
export const PAGE_SIZE_MAX = 200;

const cursor = z.string().max(400).nullish();
const limit = z.int().min(1).max(PAGE_SIZE_MAX).optional();
const optionalBranch = z.uuid().optional();

// ── Masking (used by the server for responses and by the UI for display) ──

/** +233241234567 → "024 ••• ••67" */
export function maskPhone(e164: string): string {
  const local = e164.startsWith('+233') ? `0${e164.slice(4)}` : e164;
  return `${local.slice(0, 3)} ••• ••${local.slice(-2)}`;
}

/** GHA-123456789-0 → "GHA-•••••••••-0" */
export function maskGhanaCard(value: string): string {
  const match = /^GHA-\d{9}-(\d)$/.exec(value);
  return match ? `GHA-•••••••••-${match[1]}` : '•••';
}

// ── Organisation ──

/** The client's businesses (ADR-001). Every product, account and cash balance belongs to one. */
export const listBusinessesRequestSchema = z.object({}).strict();
export interface BusinessSummary {
  id: string;
  code: string;
  name: string;
  smsBrand: string;
  smsSenderId: string;
  address: string;
  status: 'ACTIVE' | 'INACTIVE';
  /** Modules switched on (audit M3). Only these may get new products and accounts. */
  enabledModules: BusinessModule[];
}

export const BUSINESS_MODULES = ['SUSU', 'LOANS', 'WELFARE'] as const;
export type BusinessModule = (typeof BUSINESS_MODULES)[number];

export const setBusinessModuleRequestSchema = z
  .object({ businessId: z.uuid(), module: z.enum(BUSINESS_MODULES), enabled: z.boolean(), reason: z.string().trim().min(3).max(500) })
  .strict();
export type SetBusinessModuleRequest = z.infer<typeof setBusinessModuleRequestSchema>;

export const listBranchesRequestSchema = z.object({}).strict();
export interface BranchSummary {
  id: string;
  code: string;
  name: string;
  status: 'ACTIVE' | 'CLOSED';
}

export const listStaffRequestSchema = z.object({ branchId: optionalBranch }).strict();
export interface StaffSummary {
  uid: string;
  email: string;
  displayName: string;
  role: Role;
  branchIds: string[];
  status: 'ACTIVE' | 'DISABLED';
}

export const listAgentPairsRequestSchema = z.object({ branchId: optionalBranch }).strict();
export interface AgentPairSummary {
  id: string;
  branchId: string;
  name: string;
  agentAUid: string;
  agentBUid: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export const listDevicesRequestSchema = z.object({ branchId: optionalBranch }).strict();
export interface DeviceSummary {
  id: string;
  agentUid: string;
  agentPairId: string;
  branchId: string;
  label: string | null;
  status: 'ACTIVE' | 'REVOKED';
  boundAt: string;
  keyFingerprint: string | null;
  revokeReason: string | null;
}

export const listSusuProductsRequestSchema = z.object({}).strict();
export interface ProductRow {
  id: string;
  businessId: string;
  code: string;
  version: number;
  name: string;
  frequency: SusuFrequency;
  status: 'ACTIVE' | 'RETIRED';
}

// ── Members ──

export const searchMembersRequestSchema = z
  .object({
    /** Optional for head office ("All branches"); others default to their own branches. */
    branchId: optionalBranch,
    /** Name (contains), phone (local or E.164) or full Ghana Card number. Empty lists everyone. */
    query: z.string().trim().max(120).default(''),
    status: memberStatusSchema.optional(),
    cursor,
    limit,
  })
  .strict();
export type SearchMembersRequest = z.input<typeof searchMembersRequestSchema>;
export interface MemberRow {
  id: string;
  fullName: string;
  phoneMasked: string;
  ghanaCardMasked: string;
  status: MemberStatus;
  kycStatus: KycStatus;
  branchId: string;
  createdAt: string;
}

export const getMemberRequestSchema = z.object({ memberId: z.uuid() }).strict();
export interface MemberAccount {
  id: string;
  /** The business the account (and its money) belongs to. */
  businessId: string;
  businessName: string;
  productName: string;
  balancePesewas: number;
  status: 'ACTIVE' | 'FROZEN' | 'CLOSED';
  /** The agent pair that collects this account, or null when it is on no route. */
  collector: AccountCollector | null;
}
export interface MemberProfile {
  id: string;
  branchId: string;
  fullName: string;
  phone: string;
  /** Full number only for SUPER_ADMIN, COMPLIANCE, or a BRANCH_MANAGER of the member's branch; otherwise null. */
  ghanaCardNumber: string | null;
  ghanaCardMasked: string;
  dateOfBirth: string;
  status: MemberStatus;
  kycStatus: KycStatus;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  photoCount: number;
  /** Signed URLs valid for 5 minutes, same roles as the full Ghana Card number; otherwise empty. */
  photoUrls: string[];
  accounts: MemberAccount[];
}

export const getAccountStatementRequestSchema = z
  .object({
    susuAccountId: z.uuid(),
    from: z.iso.datetime({ offset: true }).optional(),
    to: z.iso.datetime({ offset: true }).optional(),
    cursor,
    limit,
  })
  .strict();
export interface StatementLine {
  postedAt: string;
  kind: string;
  description: string;
  debitPesewas: number;
  creditPesewas: number;
  balanceAfterPesewas: number;
  batchId: string;
}
export interface AccountStatement {
  account: Omit<MemberAccount, 'collector'> & { memberId: string };
  /** Newest first. */
  lines: StatementLine[];
  nextCursor: string | null;
}

// ── Work queues and audit ──

export const listPendingApprovalsRequestSchema = z.object({ branchId: optionalBranch }).strict();
export interface PendingApproval {
  kind: 'MEMBER_REGISTRATION';
  id: string;
  summary: string;
  /** The maker. The UI hides "Review" when this is the signed-in user. */
  requestedBy: string;
  requestedAt: string;
  branchId: string;
}

export const listAuditEventsRequestSchema = z
  .object({
    entityKind: z.string().max(64).optional(),
    entityId: z.string().max(128).optional(),
    branchId: optionalBranch,
    cursor,
    limit,
  })
  .strict();
export interface AuditEventSummary {
  at: string;
  actorUid: string;
  action: string;
  entityKind: string;
  entityId: string;
  channel: string;
  branchId: string | null;
  data: Record<string, unknown>;
}
