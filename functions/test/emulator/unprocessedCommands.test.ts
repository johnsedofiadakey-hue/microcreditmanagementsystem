import { initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UNPROCESSED_MIN_AGE_MS, findUnprocessedCommands } from '../../src/commands/unprocessed.js';

/** Runs against the Firestore emulator (corepack pnpm test:rules). Own project ID, so rules tests are untouched. */
const PROJECT = 'demo-susu-sweep';
let app: App;
let firestore: Firestore;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error('Run with the Firestore emulator (corepack pnpm test:rules)');
  app = initializeApp({ projectId: PROJECT }, 'unprocessed-sweep');
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

const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString().replace(/\.\d+Z$/, 'Z');
const command = (capturedAt: string, extra: Record<string, unknown> = {}) => ({
  type: 'COLLECTION',
  agentUid: 'agent-a',
  deviceId: 'device-a',
  seq: 1,
  capturedAt,
  appVersion: '0.1.0',
  payload: { memberId: 'm', susuAccountId: 'a', amountPesewas: 1500 },
  sig: 'x',
  ...extra,
});
/** "Now" as the sweep would see it once the documents are old enough. */
const later = () => new Date(Date.now() + UNPROCESSED_MIN_AGE_MS + 1_000);

describe('findUnprocessedCommands', () => {
  it('finds a command with no status once it is older than 10 minutes, and only then', async () => {
    await firestore.doc('commands/stuck').set(command(iso(60_000)));
    expect(await findUnprocessedCommands(firestore)).toEqual([]); // just written: the trigger may still be running
    const found = await findUnprocessedCommands(firestore, { now: later() });
    expect(found.map((c) => c.id)).toEqual(['stuck']);
    expect(found[0]!.data).toMatchObject({ seq: 1, payload: { amountPesewas: 1500 } });
  });

  it('ignores commands any trigger or sweep already handled', async () => {
    await firestore.doc('commands/posted').set(command(iso(60_000), { status: 'POSTED' }));
    await firestore.doc('commands/rejected').set(command(iso(60_000), { status: 'REJECTED' }));
    await firestore.doc('commands/failed').set(command(iso(60_000), { status: 'FAILED' }));
    await firestore.doc('commands/stuck').set(command(iso(60_000)));
    expect((await findUnprocessedCommands(firestore, { now: later() })).map((c) => c.id)).toEqual(['stuck']);
  });

  it('looks back about a day by capturedAt, including UTC offsets', async () => {
    await firestore.doc('commands/yesterday').set(command(iso(25 * 60 * 60 * 1000)));
    await firestore.doc('commands/last-week').set(command(iso(7 * 24 * 60 * 60 * 1000)));
    await firestore.doc('commands/offset').set(command(new Date(Date.now() - 60_000).toISOString().replace(/\.\d+Z$/, '+00:00')));
    const ids = (await findUnprocessedCommands(firestore, { now: later() })).map((c) => c.id).sort();
    expect(ids).toEqual(['offset', 'yesterday']);
  });

  it('pages through more than one query page and respects max', async () => {
    const batch = firestore.batch();
    for (let i = 0; i < 320; i += 1) {
      batch.set(firestore.doc(`commands/c-${String(i).padStart(3, '0')}`), command(iso(60_000 + i * 1_000), { seq: i + 1, ...(i % 2 ? { status: 'POSTED' } : {}) }));
    }
    await batch.commit();
    expect(await findUnprocessedCommands(firestore, { now: later(), max: 1_000 })).toHaveLength(160);
    expect(await findUnprocessedCommands(firestore, { now: later(), max: 25 })).toHaveLength(25);
  });
});
