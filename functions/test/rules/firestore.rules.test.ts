import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
  type RulesTestEnvironment,
} from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';

const BRANCH = '0b1c8a52-7d64-4c5e-9f1a-2a3b4c5d6e7f';
const OTHER_BRANCH = '9e8d7c6b-5a49-4382-a716-151413121110';
const PAIR = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
const COMMAND_ID = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

let env: RulesTestEnvironment;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-susu',
    firestore: { rules: readFileSync(resolve(__dirname, '../../../firestore.rules'), 'utf8') },
  });
});

afterAll(async () => {
  await env?.cleanup();
});

beforeEach(async () => {
  await env.clearFirestore();
});

const agent = () =>
  env.authenticatedContext('agent-a', { role: 'AGENT', branchIds: [BRANCH], agentPairId: PAIR }).firestore();
const otherAgent = () =>
  env.authenticatedContext('agent-z', { role: 'AGENT', branchIds: [BRANCH], agentPairId: 'ffffffff-ffff-4fff-8fff-ffffffffffff' }).firestore();
const manager = () => env.authenticatedContext('manager-1', { role: 'BRANCH_MANAGER', branchIds: [BRANCH] }).firestore();
const admin = () => env.authenticatedContext('admin-1', { role: 'SUPER_ADMIN', branchIds: [] }).firestore();

function command(overrides: Record<string, unknown> = {}) {
  return {
    type: 'COLLECTION',
    agentUid: 'agent-a',
    deviceId: 'device-a',
    seq: 1,
    capturedAt: '2026-10-18T09:15:00+00:00',
    appVersion: '0.1.0',
    payload: { memberId: 'm', susuAccountId: 's', amountPesewas: 2000 },
    sig: 'MEUCIQDexampleexampleexampleexampleexampleexampleexampleexample==',
    ...overrides,
  };
}

describe('commands/{id} — the agent offline queue', () => {
  it('an agent can create a well-formed command as themselves', async () => {
    await assertSucceeds(setDoc(doc(agent(), 'commands', COMMAND_ID), command()));
  });

  it('an agent cannot submit a command as another agent', async () => {
    await assertFails(setDoc(doc(agent(), 'commands', COMMAND_ID), command({ agentUid: 'agent-b' })));
  });

  it('a command cannot carry server result fields', async () => {
    await assertFails(setDoc(doc(agent(), 'commands', COMMAND_ID), command({ status: 'POSTED' })));
    await assertFails(setDoc(doc(agent(), 'commands', COMMAND_ID), command({ postingId: 'x' })));
  });

  it('a command must carry a signature', async () => {
    const { sig: _sig, ...unsigned } = command();
    await assertFails(setDoc(doc(agent(), 'commands', COMMAND_ID), unsigned));
  });

  it('the document id must be a UUID v4', async () => {
    await assertFails(setDoc(doc(agent(), 'commands', 'not-a-uuid'), command()));
  });

  it('only known command types are accepted', async () => {
    await assertFails(setDoc(doc(agent(), 'commands', COMMAND_ID), command({ type: 'PAYOUT' })));
  });

  it('a command cannot be edited or deleted once written', async () => {
    await assertSucceeds(setDoc(doc(agent(), 'commands', COMMAND_ID), command()));
    await assertFails(updateDoc(doc(agent(), 'commands', COMMAND_ID), { seq: 2 }));
    await assertFails(deleteDoc(doc(agent(), 'commands', COMMAND_ID)));
  });

  it('agents read only their own commands', async () => {
    await assertSucceeds(setDoc(doc(agent(), 'commands', COMMAND_ID), command()));
    await assertSucceeds(getDoc(doc(agent(), 'commands', COMMAND_ID)));
    await assertFails(getDoc(doc(otherAgent(), 'commands', COMMAND_ID)));
  });

  it('staff cannot create commands', async () => {
    await assertFails(setDoc(doc(manager(), 'commands', COMMAND_ID), command({ agentUid: 'manager-1' })));
  });

  it('signed-out users can do nothing', async () => {
    const anon = env.unauthenticatedContext().firestore();
    await assertFails(setDoc(doc(anon, 'commands', COMMAND_ID), command()));
    await assertFails(getDoc(doc(anon, 'commands', COMMAND_ID)));
  });
});

const PUBLIC_KEY = 'MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE' + 'A'.repeat(88);

function enrollmentDoc(overrides: Record<string, unknown> = {}) {
  return { agentUid: 'agent-a', publicKey: PUBLIC_KEY, attestationChain: [], enrolledAt: serverTimestamp(), ...overrides };
}

describe('deviceEnrollments/{deviceId} — the phone registers its signing key once', () => {
  it('an agent can enrol a phone as themselves', async () => {
    await assertSucceeds(setDoc(doc(agent(), 'deviceEnrollments', 'device-a'), enrollmentDoc()));
    await assertSucceeds(getDoc(doc(agent(), 'deviceEnrollments', 'device-a')));
  });

  it('cannot enrol as another agent, add fields, or skip the server timestamp', async () => {
    await assertFails(setDoc(doc(agent(), 'deviceEnrollments', 'device-a'), enrollmentDoc({ agentUid: 'agent-b' })));
    await assertFails(setDoc(doc(agent(), 'deviceEnrollments', 'device-a'), enrollmentDoc({ trusted: true })));
    await assertFails(setDoc(doc(agent(), 'deviceEnrollments', 'device-a'), enrollmentDoc({ enrolledAt: '2026-01-01' })));
  });

  it('an enrolment can never be replaced, edited or deleted', async () => {
    await assertSucceeds(setDoc(doc(agent(), 'deviceEnrollments', 'device-a'), enrollmentDoc()));
    await assertFails(setDoc(doc(agent(), 'deviceEnrollments', 'device-a'), enrollmentDoc()));
    await assertFails(updateDoc(doc(agent(), 'deviceEnrollments', 'device-a'), { publicKey: PUBLIC_KEY }));
    await assertFails(deleteDoc(doc(agent(), 'deviceEnrollments', 'device-a')));
  });

  it('other agents and staff cannot read an enrolment', async () => {
    await assertSucceeds(setDoc(doc(agent(), 'deviceEnrollments', 'device-a'), enrollmentDoc()));
    await assertFails(getDoc(doc(otherAgent(), 'deviceEnrollments', 'device-a')));
    await assertFails(getDoc(doc(manager(), 'deviceEnrollments', 'device-a')));
  });
});

describe('exceptions/{id}', () => {
  it('head office reads, nobody writes', async () => {
    await assertSucceeds(getDoc(doc(admin(), 'exceptions', 'command-x')));
    await assertFails(getDoc(doc(manager(), 'exceptions', 'command-x')));
    await assertFails(setDoc(doc(admin(), 'exceptions', 'command-x'), { status: 'RESOLVED' }));
  });
});

describe('projections are read-only and scoped', () => {
  it('an agent reads only their own pair route', async () => {
    await assertSucceeds(getDoc(doc(agent(), 'agentPairs', PAIR, 'routes', 'today')));
    await assertFails(getDoc(doc(otherAgent(), 'agentPairs', PAIR, 'routes', 'today')));
    await assertFails(setDoc(doc(agent(), 'agentPairs', PAIR, 'routes', 'today'), { x: 1 }));
  });

  it('branch dashboards are visible to that branch staff and head office only', async () => {
    await assertSucceeds(getDoc(doc(manager(), 'dashboards', 'branches', BRANCH, 'today')));
    await assertFails(getDoc(doc(manager(), 'dashboards', 'branches', OTHER_BRANCH, 'today')));
    await assertSucceeds(getDoc(doc(admin(), 'dashboards', 'branches', OTHER_BRANCH, 'today')));
    await assertFails(getDoc(doc(agent(), 'dashboards', 'branches', BRANCH, 'today')));
    await assertFails(setDoc(doc(admin(), 'dashboards', 'branches', BRANCH, 'today'), { x: 1 }));
  });

  it('everything else is denied by default', async () => {
    await assertFails(setDoc(doc(admin(), 'balances', 'anything'), { pesewas: 1 }));
    await assertFails(getDoc(doc(admin(), 'members', 'anything')));
  });
});
