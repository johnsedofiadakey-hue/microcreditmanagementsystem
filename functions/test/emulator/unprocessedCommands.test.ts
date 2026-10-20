import { initializeApp, type App } from 'firebase-admin/app';
import { getFirestore, type Firestore } from 'firebase-admin/firestore';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { UNPROCESSED_MIN_AGE_MS, findUnprocessedCommands, unboundEnrolledDeviceIds, type DeviceSeqState } from '../../src/commands/unprocessed.js';

/**
 * Runs against the Firestore emulator (corepack pnpm test:rules). Own project ID, so rules tests are
 * untouched. Recovery is driven by what Postgres knows per device (highest seq, gaps), never by the
 * phone's capturedAt (audit M4, REQUESTS #30).
 */
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

const command = (deviceId: string, seq: number, extra: Record<string, unknown> = {}) => ({
  type: 'COLLECTION',
  agentUid: 'agent-a',
  deviceId,
  seq,
  // A phone whose clock is years behind: must not matter.
  capturedAt: '2019-01-01T00:00:00Z',
  appVersion: '0.1.0',
  payload: { memberId: 'm', susuAccountId: 'a', amountPesewas: 1500 },
  sig: 'x',
  ...extra,
});
/** "Now" as the sweep would see it once the documents are old enough. */
const later = () => new Date(Date.now() + UNPROCESSED_MIN_AGE_MS + 1_000);
const device = (deviceId: string, maxSeq: number, missingSeqs: number[] = []): DeviceSeqState => ({ deviceId, maxSeq, missingSeqs });

describe('findUnprocessedCommands (clock-free)', () => {
  it('finds a command above the device’s highest processed seq, whatever the phone clock said', async () => {
    await firestore.doc('commands/done').set(command('device-a', 4, { status: 'POSTED' }));
    await firestore.doc('commands/stuck').set(command('device-a', 5));
    expect(await findUnprocessedCommands(firestore, [device('device-a', 4)])).toEqual([]); // too young: the trigger may still run
    const found = await findUnprocessedCommands(firestore, [device('device-a', 4)], { now: later() });
    expect(found.map((c) => c.id)).toEqual(['stuck']);
    expect(found[0]!.data).toMatchObject({ seq: 5, capturedAt: '2019-01-01T00:00:00Z' });
  });

  it('finds gaps below the highest seq (a lost trigger before later ones succeeded)', async () => {
    await firestore.doc('commands/gap').set(command('device-a', 2));
    await firestore.doc('commands/other-device').set(command('device-b', 2));
    const found = await findUnprocessedCommands(firestore, [device('device-a', 9, [2, 7])], { now: later() });
    expect(found.map((c) => c.id)).toEqual(['gap']);
  });

  it('ignores commands that already have a result', async () => {
    for (const status of ['POSTED', 'REJECTED', 'FAILED', 'RECORDED']) {
      await firestore.doc(`commands/${status}`).set(command('device-a', 10 + status.length, { status }));
    }
    expect(await findUnprocessedCommands(firestore, [device('device-a', 0)], { now: later() })).toEqual([]);
  });

  it('covers phones that enrolled but were never bound', async () => {
    await firestore.doc('deviceEnrollments/new-phone').set({ agentUid: 'agent-a' });
    await firestore.doc('deviceEnrollments/device-a').set({ agentUid: 'agent-a' });
    await firestore.doc('commands/unbound').set(command('new-phone', 1));
    const unbound = await unboundEnrolledDeviceIds(firestore, [device('device-a', 0)]);
    expect(unbound).toEqual(['new-phone']);
    const found = await findUnprocessedCommands(firestore, [], { now: later(), unboundDeviceIds: unbound });
    expect(found.map((c) => c.id)).toEqual(['unbound']);
  });

  it('pages beyond one query page, oldest first, and respects max', async () => {
    const batch = firestore.batch();
    for (let i = 1; i <= 130; i += 1) batch.set(firestore.doc(`commands/c-${String(i).padStart(3, '0')}`), command('device-a', i));
    await batch.commit();
    expect(await findUnprocessedCommands(firestore, [device('device-a', 0)], { now: later(), max: 1_000 })).toHaveLength(130);
    expect(await findUnprocessedCommands(firestore, [device('device-a', 0)], { now: later(), max: 25 })).toHaveLength(25);
  });
});
