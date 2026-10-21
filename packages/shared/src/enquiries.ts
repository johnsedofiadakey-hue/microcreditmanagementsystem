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
