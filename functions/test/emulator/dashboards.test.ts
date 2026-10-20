import { deleteApp, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { BranchDayDashboard, CompanyDayDashboard } from '@susu/shared';
import { today } from '../../src/cash/common.js';
import type { Database } from '../../src/db/types.js';
import { previousDayKey, publishAllDayDashboards, publishBranchDay, publishCompanyDay } from '../../src/projections/firestore.js';
import { freshDatabase, seedBranch } from '../helpers.js';
import { closedDay, type Seed } from '../bankHelpers.js';

/**
 * Step 7 publishers write the documents the portal reads (API.md §4), at the paths it reads them from.
 * Runs against the Firestore emulator under its own project ID (corepack pnpm test:rules).
 */
const PROJECT = 'demo-susu-dashboards';
let db: Database;
let seed: Seed;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run with the Firestore emulator (corepack pnpm test:rules)');
  // The publishers use the default Admin app, as in production.
  initializeApp({ projectId: PROJECT });
});

afterAll(async () => {
  await getFirestore().terminate();
  await Promise.all(getApps().map((a) => deleteApp(a)));
});

beforeEach(async () => {
  await fetch(`http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`, { method: 'DELETE' });
  db = await freshDatabase();
  seed = await seedBranch(db);
});

describe('day dashboard documents', () => {
  it('branch day: branchDashboards/{branchId}/days/{day} with the portal’s fields', async () => {
    const { day } = await closedDay(db, seed, [2_000, 3_000]);
    await publishBranchDay(db, seed.branchId, day);
    const snap = await getFirestore().doc(`branchDashboards/${seed.branchId}/days/${day}`).get();
    expect(snap.exists).toBe(true);
    const doc = snap.data() as BranchDayDashboard & { updatedAt: unknown };
    expect(doc).toMatchObject({ collectedPesewas: 5_000, collectionCount: 2, activePairs: 1, handedOverPesewas: 5_000, pendingSyncCount: 0, closed: true });
    expect(doc.updatedAt).toBeDefined();
    await db.close();
  });

  it('company day: dashboards/company/days/{day}, counting open Firestore exceptions', async () => {
    const { day } = await closedDay(db, seed, [1_000]);
    await getFirestore().doc('exceptions/command-x').set({ kind: 'COMMAND_FAILED', status: 'OPEN' });
    await getFirestore().doc('exceptions/command-y').set({ kind: 'COMMAND_FAILED', status: 'RESOLVED' });
    await publishCompanyDay(db, day);
    const doc = (await getFirestore().doc(`dashboards/company/days/${day}`).get()).data() as CompanyDayDashboard;
    expect(doc).toMatchObject({ collectedPesewas: 1_000, branchesClosed: 1, branchesOpen: 0, exceptions: 1, openCases: 0 });
    await db.close();
  });

  it('the schedule publishes today and yesterday for every branch and the company', async () => {
    await publishAllDayDashboards(db);
    const t = today();
    for (const path of [
      `branchDashboards/${seed.branchId}/days/${t}`,
      `branchDashboards/${seed.branchId}/days/${previousDayKey(t)}`,
      `dashboards/company/days/${t}`,
      `dashboards/company/days/${previousDayKey(t)}`,
    ]) {
      expect((await getFirestore().doc(path).get()).exists, path).toBe(true);
    }
    await db.close();
  });
});
