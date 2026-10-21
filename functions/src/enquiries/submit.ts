import { createHash, randomUUID } from 'node:crypto';
import { FieldValue, type Firestore } from 'firebase-admin/firestore';
import { ENQUIRY_DAILY_LIMIT_PER_PHONE, routeDayKey, type ParsedEnquiry, type SubmitEnquiryResult } from '@susu/shared';

/**
 * Public website enquiries (API.md §2). Stored in Firestore `enquiries/{id}`, which clients can
 * neither read nor write (firestore.rules default deny); staff will read them through a callable.
 * Not financial data, so not in Postgres.
 *
 * Limit: ENQUIRY_DAILY_LIMIT_PER_PHONE per phone number per Accra day, counted in
 * `enquiryLimits/{sha256(phone):day}` so the counter documents never hold the number itself.
 */

/**
 * Too many enquiries from one number today. Not a DomainError: website reasons stay out of
 * REJECT_REASONS, which the portal maps exhaustively. The callable answers `resource-exhausted`.
 */
export class EnquiryRateLimitedError extends Error {
  readonly reason = 'RATE_LIMITED';
  constructor() {
    super('We already have your details for today. We will call you back.');
    this.name = 'EnquiryRateLimitedError';
  }
}

const REFERENCE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Short reference for the phone call: ENQ- plus six characters from the id, no 0/O/1/I. */
export function enquiryReference(id: string): string {
  const digest = createHash('sha256').update(id).digest();
  let out = '';
  for (let i = 0; i < 6; i++) out += REFERENCE_ALPHABET[digest[i]! % REFERENCE_ALPHABET.length];
  return `ENQ-${out}`;
}

export function enquiryLimitKey(phone: string, day: string): string {
  return `${createHash('sha256').update(phone).digest('hex').slice(0, 32)}:${day}`;
}

export async function submitEnquiry(
  firestore: Firestore,
  input: ParsedEnquiry,
  context: { appCheckAppId: string | null; now?: Date },
): Promise<SubmitEnquiryResult> {
  const id = randomUUID();
  const reference = enquiryReference(id);

  // Honeypot filled in: answer as if it worked, store nothing.
  if (input.website) return { reference };

  const day = routeDayKey(context.now);
  const limitRef = firestore.collection('enquiryLimits').doc(enquiryLimitKey(input.phone, day));
  const enquiryRef = firestore.collection('enquiries').doc(id);

  await firestore.runTransaction(async (tx) => {
    const limit = await tx.get(limitRef);
    const count = (limit.get('count') as number | undefined) ?? 0;
    if (count >= ENQUIRY_DAILY_LIMIT_PER_PHONE) {
      throw new EnquiryRateLimitedError();
    }
    tx.set(limitRef, { day, count: count + 1, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    tx.set(enquiryRef, {
      reference,
      fullName: input.fullName,
      phone: input.phone,
      town: input.town ?? null,
      interest: input.interest,
      message: input.message ?? null,
      consent: true,
      consentText: 'Agreed to be contacted about this enquiry',
      status: 'NEW',
      channel: 'WEBSITE',
      appCheckAppId: context.appCheckAppId,
      createdAt: FieldValue.serverTimestamp(),
    });
  });

  return { reference };
}
