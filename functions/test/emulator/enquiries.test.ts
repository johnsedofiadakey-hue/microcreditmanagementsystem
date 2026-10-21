import { initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { ENQUIRY_DAILY_LIMIT_PER_PHONE, submitEnquiryRequestSchema } from '@susu/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { enquiryLimitKey, enquiryReference, submitEnquiry } from '../../src/enquiries/submit.js';

/** Runs against the Firestore emulator (corepack pnpm test:rules). Own project ID. */
const PROJECT = 'demo-susu-enquiries';
let app: App;
let firestore: Firestore;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run with the Firestore emulator (corepack pnpm test:rules)');
  app = initializeApp({ projectId: PROJECT }, 'enquiries');
  firestore = getFirestore(app);
});

afterAll(async () => {
  await firestore.terminate();
});

beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, {
    method: 'DELETE',
  });
});

const parse = (overrides: Record<string, unknown> = {}) =>
  submitEnquiryRequestSchema.parse({
    fullName: 'Ama Mensah',
    phone: '024 123 4567',
    interest: 'SUSU',
    consent: true,
    ...overrides,
  });
const now = new Date('2026-10-21T10:00:00Z');

describe('submitEnquiry', () => {
  it('stores the enquiry with a normalised phone and returns its reference', async () => {
    const { reference } = await submitEnquiry(firestore, parse({ town: 'Aflao' }), { appCheckAppId: 'web-app', now });
    expect(reference).toMatch(/^ENQ-[2-9A-HJ-NP-Z]{6}$/);
    const docs = (await firestore.collection('enquiries').get()).docs.map((d) => d.data());
    expect(docs).toHaveLength(1);
    expect(docs[0]).toMatchObject({ reference, phone: '+233241234567', town: 'Aflao', status: 'NEW', consent: true, appCheckAppId: 'web-app' });
    // The counter is keyed by a hash, never the number itself.
    const limits = (await firestore.collection('enquiryLimits').get()).docs;
    expect(limits.map((d) => d.id)).toEqual([enquiryLimitKey('+233241234567', '2026-10-21')]);
    expect(limits[0]!.id).not.toContain('241234567');
  });

  it(`refuses more than ${ENQUIRY_DAILY_LIMIT_PER_PHONE} a day from one number, whatever its format`, async () => {
    const formats = ['0241234567', '+233 24 123 4567', '024-123-4567'];
    for (const phone of formats) await submitEnquiry(firestore, parse({ phone }), { appCheckAppId: null, now });
    await expect(submitEnquiry(firestore, parse(), { appCheckAppId: null, now })).rejects.toMatchObject({ reason: 'RATE_LIMITED' });
    // A new Accra day starts a new count.
    await submitEnquiry(firestore, parse(), { appCheckAppId: null, now: new Date('2026-10-22T00:00:01Z') });
    expect((await firestore.collection('enquiries').get()).size).toBe(4);
  });

  it('drops honeypot submissions silently', async () => {
    const { reference } = await submitEnquiry(firestore, parse({ website: 'http://spam.example' }), { appCheckAppId: null, now });
    expect(reference).toMatch(/^ENQ-/);
    expect((await firestore.collection('enquiries').get()).size).toBe(0);
  });

  it('gives stable references', () => {
    expect(enquiryReference('a')).toBe(enquiryReference('a'));
    expect(enquiryReference('a')).not.toBe(enquiryReference('b'));
  });
});

describe('submitEnquiryRequestSchema', () => {
  it('requires consent and a Ghana number', () => {
    expect(submitEnquiryRequestSchema.safeParse({ fullName: 'Ama', phone: '0241234567', interest: 'SUSU', consent: false }).success).toBe(false);
    expect(submitEnquiryRequestSchema.safeParse({ fullName: 'Ama', phone: '12345', interest: 'SUSU', consent: true }).success).toBe(false);
    expect(submitEnquiryRequestSchema.safeParse({ fullName: 'Ama', phone: '0201234567', interest: 'WELFARE', consent: true }).success).toBe(true);
  });
});

describe('submitEnquiryRequestSchema from the callable SDK', () => {
  it('accepts null for empty optional fields (the Firebase client sends undefined as null)', () => {
    const parsed = submitEnquiryRequestSchema.safeParse({ fullName: 'Ama', phone: '0241234567', interest: 'SUSU', consent: true, town: null, message: null, website: null });
    expect(parsed.success).toBe(true);
  });
});
