import { z } from 'zod';
import { ghanaPhoneSchema } from './requests';

/**
 * Public website enquiries (API.md §2, `submitEnquiry`). No sign-in: anyone can register interest.
 * An enquiry is a lead for staff to call back. It never creates a member, an account or money.
 */

export const ENQUIRY_INTERESTS = ['SUSU', 'MICRO_CREDIT', 'WELFARE', 'OTHER'] as const;
export type EnquiryInterest = (typeof ENQUIRY_INTERESTS)[number];

export const submitEnquiryRequestSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your name').max(120),
    /** Normalised to +233XXXXXXXXX. */
    phone: ghanaPhoneSchema,
    town: z.string().trim().max(80).nullish(),
    interest: z.enum(ENQUIRY_INTERESTS),
    message: z.string().trim().max(1000).nullish(),
    /** Must be true: the person agreed to be contacted about this enquiry (Data Protection Act, 2012). */
    consent: z.literal(true, 'Tick the box so we may call you'),
    /** Honeypot, hidden from people. Anything here and the enquiry is quietly dropped. */
    website: z.string().max(200).nullish(),
  })
  .strict();
export type SubmitEnquiryRequest = z.input<typeof submitEnquiryRequestSchema>;
export type ParsedEnquiry = z.output<typeof submitEnquiryRequestSchema>;

export interface SubmitEnquiryResult {
  /** Short reference to quote on the phone, e.g. "ENQ-7F3K2Q". */
  reference: string;
}

/** At most this many enquiries per phone number per Accra day; more fail with RATE_LIMITED. */
export const ENQUIRY_DAILY_LIMIT_PER_PHONE = 3;

// ── Staff follow-up (portal) ──

export const ENQUIRY_STATUSES = ['NEW', 'CONTACTED', 'CLOSED'] as const;
export type EnquiryStatus = (typeof ENQUIRY_STATUSES)[number];

/** Why an enquiry was closed — counted on reports. */
export const ENQUIRY_OUTCOMES = ['JOINED', 'NOT_INTERESTED', 'UNREACHABLE', 'DUPLICATE', 'OTHER'] as const;
export type EnquiryOutcome = (typeof ENQUIRY_OUTCOMES)[number];

/** Roles that see and follow up website enquiries. COMPLIANCE may only read. */
export const ENQUIRY_VIEW_ROLES = ['SUPER_ADMIN', 'COMPLIANCE', 'BRANCH_MANAGER', 'SUPERVISOR'] as const;
export const ENQUIRY_UPDATE_ROLES = ['SUPER_ADMIN', 'BRANCH_MANAGER', 'SUPERVISOR'] as const;

export const listEnquiriesRequestSchema = z
  .object({
    status: z.enum(ENQUIRY_STATUSES).optional(),
    interest: z.enum(ENQUIRY_INTERESTS).optional(),
    cursor: z.string().max(400).nullish(),
    limit: z.int().min(1).max(200).optional(),
  })
  .strict();
export type ListEnquiriesRequest = z.input<typeof listEnquiriesRequestSchema>;

/**
 * Record a call or close the enquiry. CONTACTED may be recorded more than once (each call is a
 * note); CLOSED needs an outcome and is final.
 */
export const updateEnquiryRequestSchema = z
  .object({
    enquiryId: z.uuid(),
    status: z.enum(['CONTACTED', 'CLOSED']),
    outcome: z.enum(ENQUIRY_OUTCOMES).optional(),
    note: z.string().trim().min(3).max(500),
  })
  .strict()
  .refine((v) => v.status !== 'CLOSED' || v.outcome, { message: 'Choose an outcome to close the enquiry', path: ['outcome'] });
export type UpdateEnquiryRequest = z.input<typeof updateEnquiryRequestSchema>;

export interface EnquiryNote {
  status: 'CONTACTED' | 'CLOSED';
  outcome: EnquiryOutcome | null;
  note: string;
  byUid: string;
  /** Server time, ISO 8601. */
  at: string;
}

export interface EnquirySummary {
  id: string;
  reference: string;
  fullName: string;
  /** Full number: staff need it to call back. */
  phone: string;
  town: string | null;
  interest: EnquiryInterest;
  message: string | null;
  status: EnquiryStatus;
  outcome: EnquiryOutcome | null;
  createdAt: string;
  updatedAt: string | null;
  /** Oldest first. */
  notes: EnquiryNote[];
}

export interface ListEnquiriesResult {
  enquiries: EnquirySummary[];
  nextCursor: string | null;
}
