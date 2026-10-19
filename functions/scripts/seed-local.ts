/**
 * Local development only: migrate the local database, then create a SUPER_ADMIN in the Auth
 * emulator *and* in staff_users (callables check both since audit M1), plus one demo branch and
 * one Susu product so the portal has something to show.
 *
 *   createdb susu_dev
 *   firebase emulators:start --project demo-susu        # in another terminal
 *   corepack pnpm --filter @susu/functions seed:local
 *
 * Refuses to run unless the Auth emulator host is local and the project is a demo- project.
 */
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { migrate } from '../src/db/migrate.js';
import { createPgDatabase } from '../src/db/pg.js';

const AUTH_HOST = (process.env.FIREBASE_AUTH_EMULATOR_HOST ??= '127.0.0.1:9099');
const PROJECT = process.env.GCLOUD_PROJECT ?? 'demo-susu';
const DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql:///susu_dev';

// Emulator-only test credentials. Never used anywhere else.
const ADMIN = {
  email: 'admin@susu.test',
  password: 'emulator-only-Admin1',
  displayName: 'Dev Administrator',
};

if (!/^(127\.0\.0\.1|localhost|\[::1\]):\d+$/.test(AUTH_HOST) || !PROJECT.startsWith('demo-')) {
  console.error(`Refusing to seed: auth host ${AUTH_HOST}, project ${PROJECT}. Local demo- projects only.`);
  process.exit(1);
}

if (!getApps().length) initializeApp({ projectId: PROJECT });
const auth = getAuth();
const db = createPgDatabase(DATABASE_URL, 1);

try {
  const ran = await migrate(db);
  console.log(ran.length ? `Migrations applied: ${ran.join(', ')}` : 'Database is up to date.');

  const user = await auth.getUserByEmail(ADMIN.email).catch(() =>
    auth.createUser({ email: ADMIN.email, password: ADMIN.password, displayName: ADMIN.displayName }),
  );

  await db.transaction(async (tx) => {
    await tx.query(
      `insert into staff_users (uid, email, display_name, role, branch_ids, created_by)
       values ($1, $2, $3, 'SUPER_ADMIN', '{}', 'system')
       on conflict (uid) do nothing`,
      [user.uid, ADMIN.email, ADMIN.displayName],
    );
    await tx.query(
      `insert into audit_events (actor_uid, action, entity_kind, entity_id, channel, data)
       select 'system', 'staff.bootstrapped', 'staff_user', $1, 'SYSTEM', '{"source":"seed-local"}'
        where not exists (select 1 from audit_events where action = 'staff.bootstrapped' and entity_id = $1)`,
      [user.uid],
    );
  });
  await auth.setCustomUserClaims(user.uid, { role: 'SUPER_ADMIN', branchIds: [] });
  console.log(`Admin ready: ${ADMIN.email} (uid ${user.uid}). Password is in functions/scripts/seed-local.ts.`);

  // Demo branch and product through the real services, so ledger accounts and audit rows exist.
  const { createBranch } = await import('../src/org/branches.js');
  const { createSusuProduct } = await import('../src/members/members.js');
  const actor = { uid: user.uid, claims: { role: 'SUPER_ADMIN' as const, branchIds: [] }, channel: 'SYSTEM' as const };
  const hasBranch = (await db.query('select 1 from branches where code = $1', ['KSI-01'])).rowCount > 0;
  if (!hasBranch) {
    await db.transaction((tx) => createBranch(tx, actor, { name: 'Kumasi Central', code: 'KSI-01' }));
    await db.transaction((tx) => createSusuProduct(tx, actor, { code: 'DAILY', name: 'Daily Susu', frequency: 'DAILY' }));
    console.log('Demo branch KSI-01 and product DAILY created.');
  }
} finally {
  await db.close();
}
