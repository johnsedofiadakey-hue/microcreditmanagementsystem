import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { assertFails, assertSucceeds, initializeTestEnvironment, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteObject, getBytes, getMetadata, ref, uploadBytes } from 'firebase/storage';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

/**
 * storage.rules for KYC evidence (audit M7, REQUESTS #32). Staff and agents may only create a new image
 * in their own inbox; nobody reads, replaces or deletes KYC files from a client. The server moves inbox
 * files into `kyc/{memberId}/` and gives authorised roles 5-minute signed URLs.
 */
const BRANCH = '0b1c8a52-7d64-4c5e-9f1a-2a3b4c5d6e7f';
const FILE = '3f2504e0-4f89-41d3-9a0c-0305e82c3301.jpg';
const MEMBER = '7d1e2f30-4a5b-4c6d-9e7f-8a9b0c1d2e01';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-susu-storage-rules',
    storage: { rules: readFileSync(resolve(__dirname, '../../../storage.rules'), 'utf8') },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearStorage();
});

const as = (uid: string, role: string) => env.authenticatedContext(uid, { role, branchIds: [BRANCH] }).storage();
const cashier = () => as('cashier-1', 'CASHIER');
const upload = (storage: ReturnType<typeof cashier>, path: string, bytes: Uint8Array = JPEG, contentType = 'image/jpeg') =>
  uploadBytes(ref(storage, path), bytes, { contentType });

async function seedFile(path: string) {
  await env.withSecurityRulesDisabled(async (context) => {
    await uploadBytes(ref(context.storage(), path), JPEG, { contentType: 'image/jpeg' });
  });
}

describe('kyc-inbox/{uid}/{uuid}.{ext} — uploads', () => {
  it('staff and agents upload an image into their own inbox', async () => {
    for (const [uid, role] of [
      ['cashier-1', 'CASHIER'],
      ['manager-1', 'BRANCH_MANAGER'],
      ['supervisor-1', 'SUPERVISOR'],
      ['agent-a', 'AGENT'],
      ['admin-1', 'SUPER_ADMIN'],
    ] as const) {
      await assertSucceeds(upload(as(uid, role), `kyc-inbox/${uid}/${FILE}`));
    }
    await assertSucceeds(upload(cashier(), `kyc-inbox/cashier-1/${FILE.replace('.jpg', '.png')}`, JPEG, 'image/png'));
    await assertSucceeds(upload(cashier(), `kyc-inbox/cashier-1/${FILE.replace('.jpg', '.webp')}`, JPEG, 'image/webp'));
  });

  it('not into someone else’s inbox', async () => {
    await assertFails(upload(cashier(), `kyc-inbox/cashier-2/${FILE}`));
  });

  it('only {uuid}.jpg|jpeg|png|webp file names', async () => {
    await assertFails(upload(cashier(), 'kyc-inbox/cashier-1/ghana-card.jpg'));
    await assertFails(upload(cashier(), `kyc-inbox/cashier-1/${FILE.replace('.jpg', '.pdf')}`));
    await assertFails(upload(cashier(), `kyc-inbox/cashier-1/nested/${FILE}`));
  });

  it('only JPEG, PNG or WebP content under 8 MB', async () => {
    await assertFails(upload(cashier(), `kyc-inbox/cashier-1/${FILE}`, JPEG, 'application/pdf'));
    await assertFails(upload(cashier(), `kyc-inbox/cashier-1/${FILE}`, JPEG, 'image/gif'));
    await assertFails(upload(cashier(), `kyc-inbox/cashier-1/${FILE}`, new Uint8Array(8 * 1024 * 1024)));
  });

  it('roles without KYC capture, and signed-out users, cannot upload', async () => {
    await assertFails(upload(as('finance-1', 'FINANCE'), `kyc-inbox/finance-1/${FILE}`));
    await assertFails(upload(as('compliance-1', 'COMPLIANCE'), `kyc-inbox/compliance-1/${FILE}`));
    await assertFails(upload(env.authenticatedContext('no-role').storage(), `kyc-inbox/no-role/${FILE}`));
    await assertFails(upload(env.unauthenticatedContext().storage(), `kyc-inbox/anyone/${FILE}`));
  });
});

describe('KYC evidence is never read, replaced or deleted from a client', () => {
  it('the uploader cannot read, overwrite or delete their own inbox file', async () => {
    await seedFile(`kyc-inbox/cashier-1/${FILE}`);
    const file = ref(cashier(), `kyc-inbox/cashier-1/${FILE}`);
    await assertFails(getBytes(file));
    await assertFails(getMetadata(file));
    await assertFails(upload(cashier(), `kyc-inbox/cashier-1/${FILE}`));
    await assertFails(deleteObject(file));
  });

  it('kyc/{memberId}/ is closed to every role, including SUPER_ADMIN and COMPLIANCE', async () => {
    await seedFile(`kyc/${MEMBER}/${FILE}`);
    for (const [uid, role] of [
      ['admin-1', 'SUPER_ADMIN'],
      ['compliance-1', 'COMPLIANCE'],
      ['manager-1', 'BRANCH_MANAGER'],
    ] as const) {
      const storage = as(uid, role);
      await assertFails(getBytes(ref(storage, `kyc/${MEMBER}/${FILE}`)));
      await assertFails(upload(storage, `kyc/${MEMBER}/${FILE}`));
      await assertFails(deleteObject(ref(storage, `kyc/${MEMBER}/${FILE}`)));
    }
  });

  it('everything else in the bucket is denied', async () => {
    await assertFails(upload(as('admin-1', 'SUPER_ADMIN'), 'exports/report.jpg'));
    await assertFails(getBytes(ref(as('admin-1', 'SUPER_ADMIN'), 'exports/report.jpg')));
  });
});
