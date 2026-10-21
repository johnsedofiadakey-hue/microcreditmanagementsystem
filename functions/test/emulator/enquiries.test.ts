import { initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { ENQUIRY_DAILY_LIMIT_PER_PHONE, submitEnquiryRequestSchema } from '@susu/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { listEnquiries, updateEnquiry } from '../../src/enquiries/staff.js';
import { enquiryLimitKey, enquiryReference, submitEnquiry } from '../../src/enquiries/submit.js';
import type { Actor } from '../../src/lib/actor.js';

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

const staff = (role: Actor['claims']['role'], uid = `${role.toLowerCase()}-1`): Actor => ({ uid, claims: { role, branchIds: [] }, channel: 'PORTAL' });

describe('staff follow-up', () => {
  async function seed(n: number) {
    for (let i = 0; i < n; i++) {
      await submitEnquiry(firestore, parse({ phone: `024 000 00${String(i).padStart(2, '0')}`, interest: i % 2 ? 'WELFARE' : 'SUSU' }), { appCheckAppId: null, now });
    }
  }

  it('lists newest first with cursor paging and filters', async () => {
    await seed(5);
    const first = await listEnquiries(firestore, staff('BRANCH_MANAGER'), { limit: 3 });
    expect(first.enquiries).toHaveLength(3);
    expect(first.nextCursor).not.toBeNull();
    const second = await listEnquiries(firestore, staff('BRANCH_MANAGER'), { limit: 3, cursor: first.nextCursor });
    expect(second.enquiries).toHaveLength(2);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.enquiries, ...second.enquiries].map((e) => e.id);
    expect(new Set(ids).size).toBe(5);
    expect((await listEnquiries(firestore, staff('COMPLIANCE'), { interest: 'WELFARE' })).enquiries).toHaveLength(2);
    expect((await listEnquiries(firestore, staff('SUPER_ADMIN'), { status: 'NEW' })).enquiries).toHaveLength(5);
  });

  it('keeps cashiers and agents out', async () => {
    await expect(listEnquiries(firestore, staff('CASHIER'), {})).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
    await expect(listEnquiries(firestore, staff('AGENT'), {})).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
  });

  it('records calls as notes, closes once with an outcome, and compliance cannot update', async () => {
    await seed(1);
    const [e] = (await listEnquiries(firestore, staff('SUPERVISOR'), {})).enquiries;
    await expect(updateEnquiry(firestore, staff('COMPLIANCE'), { enquiryId: e!.id, status: 'CONTACTED', note: 'Called' })).rejects.toMatchObject({ reason: 'NOT_PERMITTED' });
    await updateEnquiry(firestore, staff('SUPERVISOR'), { enquiryId: e!.id, status: 'CONTACTED', note: 'No answer, try Friday' });
    await updateEnquiry(firestore, staff('SUPERVISOR'), { enquiryId: e!.id, status: 'CONTACTED', note: 'Spoke, visit booked' });
    const closed = await updateEnquiry(firestore, staff('BRANCH_MANAGER'), { enquiryId: e!.id, status: 'CLOSED', outcome: 'JOINED', note: 'Registered at the office' });
    expect(closed).toMatchObject({ status: 'CLOSED', outcome: 'JOINED' });
    expect(closed.notes.map((n) => n.note)).toEqual(['No answer, try Friday', 'Spoke, visit booked', 'Registered at the office']);
    expect(closed.notes[2]).toMatchObject({ byUid: 'branch_manager-1', outcome: 'JOINED' });
    await expect(updateEnquiry(firestore, staff('SUPER_ADMIN'), { enquiryId: e!.id, status: 'CONTACTED', note: 'Again' })).rejects.toMatchObject({ reason: 'CONFLICT' });
  });
});
