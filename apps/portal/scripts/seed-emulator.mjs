#!/usr/bin/env node
/**
 * Creates a first SUPER_ADMIN in the Auth emulator so you can sign in to an empty portal.
 * Emulator only — refuses to run unless FIREBASE_AUTH_EMULATOR_HOST (or the default) is local.
 *
 *   node scripts/seed-emulator.mjs
 *
 * TODO(api): replace with the backend's planned seed script (API.md §6) once it exists.
 */

const HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST ?? '127.0.0.1:9099';
const PROJECT = process.env.FIREBASE_PROJECT_ID ?? 'demo-susu';

// Test credentials for the local emulator only. Never used anywhere else.
const ADMIN = {
  email: 'admin@susu.test',
  password: 'emulator-only-Admin1',
  displayName: 'Dev Administrator',
  claims: { role: 'SUPER_ADMIN', branchIds: [] },
};

if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(HOST)) {
  console.error(`Refusing to seed a non-local auth host: ${HOST}`);
  process.exit(1);
}

const base = `http://${HOST}/identitytoolkit.googleapis.com/v1`;
const owner = { 'Content-Type': 'application/json', Authorization: 'Bearer owner' };

async function post(path, body, headers = { 'Content-Type': 'application/json' }) {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, json };
}

let localId;
const signUp = await post('/accounts:signUp?key=emulator', {
  email: ADMIN.email,
  password: ADMIN.password,
  displayName: ADMIN.displayName,
  returnSecureToken: true,
});
if (signUp.ok) {
  localId = signUp.json.localId;
} else if (signUp.json?.error?.message === 'EMAIL_EXISTS') {
  const lookup = await post(`/projects/${PROJECT}/accounts:lookup`, { email: [ADMIN.email] }, owner);
  localId = lookup.json.users?.[0]?.localId;
} else {
  console.error('Could not create the admin user. Is the Auth emulator running?', signUp.json);
  process.exit(1);
}

const update = await post(
  `/projects/${PROJECT}/accounts:update`,
  { localId, displayName: ADMIN.displayName, customAttributes: JSON.stringify(ADMIN.claims) },
  owner,
);
if (!update.ok) {
  console.error('Could not set claims', update.json);
  process.exit(1);
}

console.log(`Seeded ${ADMIN.email} (uid ${localId}) as SUPER_ADMIN in project ${PROJECT}.`);
console.log('Password is in apps/portal/scripts/seed-emulator.mjs.');
