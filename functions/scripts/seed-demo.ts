/**
 * Demo data for a TEST project, so every portal screen has something to show. Everything is
 * labelled DEMO: branch DEMO-AFL, product DEMO-DAILY, staff "DEMO …", members "… (Demo)" with
 * 020 000 00xx phone numbers and GHA-0000000xx Ghana Card numbers that belong to nobody.
 *
 * It goes through the real flow wherever the real flow exists:
 *   - staff get real Auth accounts (emails are +demo aliases of --email-base, so mail reaches you);
 *   - a scripted "phone" enrols an EC P-256 key in deviceEnrollments/ and is bound like a real one;
 *   - collections and the handover declaration are SIGNED commands written to commands/, which the
 *     deployed onAgentCommandCreated trigger posts to the ledger — the script only waits for them;
 *   - maker-checker and three-person rules apply (the services refuse otherwise).
 * Not seeded: a branch close and a bank deposit (closing today would freeze today's figures, and a
 * deposit needs a day closed before today).
 *
 *   cloud-sql-proxy PROJECT:REGION:INSTANCE --port 6543 &
 *   DATABASE_URL="$(gcloud secrets versions access latest --secret DATABASE_OWNER_URL --project P)" \
 *     corepack pnpm --filter @susu/functions seed:demo -- --project P --email-base you@gmail.com
 *
 * Re-running is refused once DEMO-AFL exists. With --process-locally (emulator dry runs, where no
 * trigger is deployed) the script posts its own commands; processing is idempotent per command ID.
 */
import { generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';
import { parseArgs } from 'node:util';
import { BUSINESS_IDS } from '../src/db/migrations/006_businesses.js';
import { commandSigningString, type AuthClaims, type Role } from '@susu/shared';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { confirmHandover } from '../src/cash/handovers.js';
import { approveWithdrawal, payWithdrawal, requestWithdrawal } from '../src/cash/withdrawals.js';
import { processAgentCommand } from '../src/commands/processAgentCommand.js';
import { createPgDatabase } from '../src/db/pg.js';
import type { Actor } from '../src/lib/actor.js';
import { approveMember, createSusuProduct, openSusuAccount, registerMember } from '../src/members/members.js';
import { createAgentPair } from '../src/org/agentPairs.js';
import { createBranch } from '../src/org/branches.js';
import { bindDevice } from '../src/org/devices.js';
import { createStaffUserFlow, type StaffAuth } from '../src/org/staff.js';
import {
  publishBranchAndCompanyDay,
  publishDeviceStatus,
  publishHandoverDeclaration,
  publishRoutes,
  publishSyncHealth,
} from '../src/projections/firestore.js';

const { values } = parseArgs({
  options: {
    project: { type: 'string' },
    'email-base': { type: 'string' },
    'process-locally': { type: 'boolean', default: false },
  },
});
const project = values.project;
const emailBase = values['email-base']?.trim().toLowerCase();
const processLocally = values['process-locally'] ?? false;
const databaseUrl = process.env.DATABASE_URL;
if (!project || !emailBase || !databaseUrl || !/^[^@\s+]+@[^@\s]+$/.test(emailBase)) {
  console.error('Usage: DATABASE_URL=… seed:demo -- --project <id> --email-base <you@example.com> [--process-locally]');
  process.exit(1);
}
const [mailbox, domain] = emailBase.split('@') as [string, string];
const demoEmail = (who: string) => `${mailbox}+demo-${who}@${domain}`;

process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= project;
if (!getApps().length) initializeApp({ projectId: project });
const auth = getAuth();
const firestore = getFirestore();
const db = createPgDatabase(databaseUrl, 2);
const GADUFIA = BUSINESS_IDS.GADUFIA;

const actorOf = (uid: string, role: Role, branchIds: string[], extra: Partial<AuthClaims> = {}): Actor => ({
  uid,
  claims: { role, branchIds, ...extra },
  channel: 'PORTAL',
});

const staffAuth: StaffAuth = {
  createUser: (input) => auth.createUser({ ...input, disabled: false }),
  deleteUser: (uid) => auth.deleteUser(uid),
  setClaims: (uid, claims) => auth.setCustomUserClaims(uid, claims),
  // The link is not printed: use "Forgot password" on the sign-in page to sign in as a demo person.
  passwordSetupLink: async () => '',
};

function log(step: string) {
  console.log(`· ${step}`);
}

/** Write a signed command and wait for the deployed trigger (or, in a dry run, post it here). */
async function submit(id: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ref = firestore.collection('commands').doc(id);
  await ref.set(body);
  if (processLocally) {
    const result = await processAgentCommand(db, id, body);
    await ref.update({ ...result, processedAt: FieldValue.serverTimestamp() });
    return result as unknown as Record<string, unknown>;
  }
  for (let waited = 0; waited < 120_000; waited += 1_000) {
    const data = (await ref.get()).data() ?? {};
    if (typeof data.status === 'string') return data;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  throw new Error(`Command ${id} was not processed within 2 minutes — is onAgentCommandCreated deployed?`);
}

function signed(key: KeyObject, id: string, body: Record<string, unknown>) {
  const sig = sign('sha256', Buffer.from(commandSigningString(id, body as never), 'utf8'), { key, dsaEncoding: 'der' }).toString('base64');
  return { ...body, sig };
}

try {
  if ((await db.query(`select 1 from branches where code = 'DEMO-AFL'`)).rowCount > 0) {
    console.error('Demo data already exists in this project (branch DEMO-AFL). Nothing changed.');
    process.exit(1);
  }
  const admin = (await db.query<{ uid: string }>(`select uid from staff_users where role = 'SUPER_ADMIN' and status = 'ACTIVE' order by created_at limit 1`)).rows[0];
  if (!admin) throw new Error('No super admin yet: run bootstrap:admin first');
  const adminActor = actorOf(admin.uid, 'SUPER_ADMIN', []);

  // ── Organisation ──
  const { branchId } = await db.transaction((tx) => createBranch(tx, adminActor, { name: 'DEMO Aflao Main', code: 'DEMO-AFL' }));
  log('branch DEMO Aflao Main (DEMO-AFL)');

  const people = [
    { key: 'manager', name: 'DEMO Branch Manager', role: 'BRANCH_MANAGER' },
    { key: 'cashier', name: 'DEMO Cashier', role: 'CASHIER' },
    { key: 'cashier2', name: 'DEMO Second Cashier', role: 'CASHIER' },
    { key: 'agent-a', name: 'DEMO Agent Kofi', role: 'AGENT' },
    { key: 'agent-b', name: 'DEMO Agent Esi', role: 'AGENT' },
  ] as const;
  const uid: Record<string, string> = {};
  for (const p of people) {
    const result = await createStaffUserFlow(db, staffAuth, adminActor, {
      email: demoEmail(p.key),
      displayName: p.name,
      role: p.role,
      branchIds: [branchId],
    });
    uid[p.key] = result.uid;
    log(`staff ${p.name} <${demoEmail(p.key)}>`);
  }
  const manager = actorOf(uid.manager!, 'BRANCH_MANAGER', [branchId]);
  const cashier = actorOf(uid.cashier!, 'CASHIER', [branchId]);
  const cashier2 = actorOf(uid['cashier2']!, 'CASHIER', [branchId]);

  const { productId } = await db.transaction((tx) =>
    createSusuProduct(tx, adminActor, { businessId: GADUFIA, code: 'DEMO-DAILY', name: 'Demo Daily Susu', frequency: 'DAILY' }),
  );
  log('product Demo Daily Susu (Gadufia Fiase Susu Services)');

  const { agentPairId } = await db.transaction((tx) =>
    createAgentPair(tx, manager, { branchId, name: 'DEMO Pair 1', agentAUid: uid['agent-a']!, agentBUid: uid['agent-b']! }),
  );
  for (const a of ['agent-a', 'agent-b']) {
    await auth.setCustomUserClaims(uid[a]!, { role: 'AGENT', branchIds: [branchId], agentPairId });
  }
  log('agent pair DEMO Pair 1');

  // ── The scripted phone: enrol its key, then bind it like a supervisor would ──
  const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const publicKeyBase64 = publicKey.export({ format: 'der', type: 'spki' }).toString('base64');
  const deviceId = `demo-phone-${randomUUID().slice(0, 8)}`;
  await firestore.collection('deviceEnrollments').doc(deviceId).set({
    agentUid: uid['agent-a'],
    publicKey: publicKeyBase64,
    attestationChain: [],
    enrolledAt: FieldValue.serverTimestamp(),
  });
  const { keyFingerprint } = await db.transaction((tx) =>
    bindDevice(tx, manager, { deviceId, agentUid: uid['agent-a']!, agentPairId, label: 'DEMO scripted phone' }, { agentUid: uid['agent-a']!, publicKey: publicKeyBase64 }),
  );
  await publishDeviceStatus(db, [deviceId]);
  log(`phone ${deviceId} enrolled and bound (key ${keyFingerprint})`);

  // ── Members: registered by the cashier, approved by the manager, on the pair's route ──
  const members = [
    { name: 'Akosua Mensah (Demo)', expected: 2_000 },
    { name: 'Kwame Asante (Demo)', expected: 1_000 },
    { name: 'Efua Boateng (Demo)', expected: 5_000 },
    { name: 'Yaw Owusu (Demo)', expected: 2_500 },
    { name: 'Abena Darko (Demo)', expected: 1_500 },
  ];
  const accounts: { memberId: string; susuAccountId: string; name: string; expected: number }[] = [];
  for (const [i, m] of members.entries()) {
    const n = String(i + 1).padStart(2, '0');
    const { memberId } = await db.transaction((tx) =>
      registerMember(tx, cashier, {
        branchId,
        fullName: m.name,
        phone: `020 000 00${n}`,
        ghanaCardNumber: `GHA-0000000${n}-${i + 1}`,
        dateOfBirth: `198${i}-0${i + 1}-15`,
        consentGiven: true,
      }),
    );
    await db.transaction((tx) => approveMember(tx, manager, { memberId }));
    const { susuAccountId } = await db.transaction((tx) =>
      openSusuAccount(tx, manager, { memberId, productId, collector: { agentPairId, expectedPesewas: m.expected } }),
    );
    accounts.push({ memberId, susuAccountId, name: m.name, expected: m.expected });
    log(`member ${m.name}: registered by DEMO Cashier, approved by DEMO Branch Manager, on DEMO Pair 1's route`);
  }
  await publishRoutes(db, [agentPairId]);

  // ── Collections: signed commands from the phone, posted by the deployed trigger ──
  let seq = 0;
  let collected = 0;
  let collections = 0;
  async function collect(a: (typeof accounts)[number], amount: number) {
    seq += 1;
    const id = randomUUID();
    const body = signed(privateKey, id, {
      type: 'COLLECTION',
      agentUid: uid['agent-a'],
      deviceId,
      seq,
      capturedAt: new Date().toISOString(),
      appVersion: 'demo-seed',
      payload: { memberId: a.memberId, susuAccountId: a.susuAccountId, amountPesewas: amount },
    });
    const result = await submit(id, body);
    if (result.status !== 'POSTED') throw new Error(`Collection for ${a.name} was ${String(result.status)}: ${String(result.message)}`);
    collections += 1;
    log(`collection GH₵ ${(amount / 100).toFixed(2)} from ${a.name}: POSTED`);
    return amount;
  }
  const late = accounts[3]!; // collected after the handover, so the pair still holds cash at day end
  for (const a of accounts) {
    if (a === late) continue;
    for (const amount of a === accounts[0] ? [a.expected, a.expected] : [a.expected]) collected += await collect(a, amount);
  }

  // ── Handover: the pair declares its whole custody from the phone; the cashier counts it ──
  seq += 1;
  const declarationId = randomUUID();
  const declaration = await submit(
    declarationId,
    signed(privateKey, declarationId, {
      type: 'HANDOVER_DECLARATION',
      agentUid: uid['agent-a'],
      deviceId,
      seq,
      capturedAt: new Date().toISOString(),
      appVersion: 'demo-seed',
      payload: { lines: [{ businessId: GADUFIA, declaredPesewas: collected }] },
    }),
  );
  if (declaration.status !== 'RECORDED') throw new Error(`Handover declaration was ${String(declaration.status)}: ${String(declaration.message)}`);
  await db.transaction((tx) =>
    confirmHandover(tx, cashier, { declarationId, businessId: GADUFIA, expectedPesewas: collected, countedPesewas: collected }),
  );
  await publishHandoverDeclaration(db, declarationId);
  log(`handover GH₵ ${(collected / 100).toFixed(2)} declared on the phone, counted by DEMO Cashier`);
  const handedOver = collected;
  collected += await collect(late, late.expected);

  // ── A withdrawal with three different people ──
  const first = accounts[0]!;
  const { withdrawalId } = await db.transaction((tx) =>
    requestWithdrawal(tx, cashier, { susuAccountId: first.susuAccountId, amountPesewas: 1_000, reason: 'DEMO: school fees' }),
  );
  await db.transaction((tx) => approveWithdrawal(tx, manager, { withdrawalId }));
  await db.transaction((tx) => payWithdrawal(tx, cashier2, { withdrawalId }));
  log(`withdrawal GH₵ 10.00 for ${first.name}: requested by DEMO Cashier, approved by DEMO Branch Manager, paid by DEMO Second Cashier`);

  // A second request left waiting, so the approvals queue has an item.
  await db.transaction((tx) =>
    requestWithdrawal(tx, cashier, { susuAccountId: accounts[2]!.susuAccountId, amountPesewas: 2_000, reason: 'DEMO: market stock' }),
  );
  log(`withdrawal GH₵ 20.00 for ${accounts[2]!.name}: waiting for approval`);

  await publishSyncHealth(db, deviceId);
  await publishBranchAndCompanyDay(db, branchId);
  log('dashboards published');
  console.log(`\nDemo data ready in ${project}: ${accounts.length} members, ${collections} collections (GH₵ ${(collected / 100).toFixed(2)}), GH₵ ${(handedOver / 100).toFixed(2)} handed over, 2 withdrawals.`);
} finally {
  await db.close();
  await firestore.terminate();
}
