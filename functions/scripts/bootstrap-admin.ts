/**
 * Create the FIRST super admin of a real (non-demo) Firebase project, in both Firebase Auth and
 * staff_users — callables check both (audit M1). Everyone after that is created in the portal.
 *
 *   cloud-sql-proxy PROJECT:REGION:INSTANCE --port 6543 &             # reach the database
 *   DATABASE_URL=postgresql://USER:PASS@127.0.0.1:6543/DB \
 *     corepack pnpm --filter @susu/functions bootstrap:admin -- \
 *       --project microcreditplatform --email you@example.com --name "Your Name"
 *
 * Uses your Application Default Credentials (`gcloud auth application-default login`). Refuses demo-
 * projects (use seed:local) and refuses to run if a super admin already exists. No password is ever
 * handled here: it prints a one-time password-setup link for the new admin to open.
 */
import { parseArgs } from 'node:util';
import { getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { createPgDatabase } from '../src/db/pg.js';

const { values } = parseArgs({
  options: { project: { type: 'string' }, email: { type: 'string' }, name: { type: 'string' } },
});
const project = values.project;
const email = values.email?.trim().toLowerCase();
const name = values.name?.trim();
const databaseUrl = process.env.DATABASE_URL;

if (!project || !email || !name || !databaseUrl) {
  console.error('Usage: DATABASE_URL=… bootstrap:admin -- --project <id> --email <email> --name "<name>"');
  process.exit(1);
}
if (project.startsWith('demo-')) {
  console.error('This is for real projects. For the emulator use: corepack pnpm --filter @susu/functions seed:local');
  process.exit(1);
}
if (process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error('FIREBASE_AUTH_EMULATOR_HOST is set; unset it to bootstrap a real project.');
  process.exit(1);
}
if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
  console.error(`"${email}" is not an email address`);
  process.exit(1);
}

// User credentials need a quota project for the Identity Toolkit API.
process.env.GOOGLE_CLOUD_QUOTA_PROJECT ??= project;
if (!getApps().length) initializeApp({ projectId: project });
const auth = getAuth();
const db = createPgDatabase(databaseUrl, 1);

try {
  const existing = await db.query<{ uid: string; email: string }>(`select uid, email from staff_users where role = 'SUPER_ADMIN'`);
  if (existing.rowCount > 0) {
    console.error(`A super admin already exists (${existing.rows.map((r) => r.email).join(', ')}). Create further staff in the portal.`);
    process.exitCode = 1;
  } else {
    const user = await auth.getUserByEmail(email).catch(() => auth.createUser({ email, displayName: name, emailVerified: false }));
    await db.transaction(async (tx) => {
      await tx.query(
        `insert into staff_users (uid, email, display_name, role, branch_ids, created_by)
         values ($1, $2, $3, 'SUPER_ADMIN', '{}', 'system:bootstrap')`,
        [user.uid, email, name],
      );
      await tx.query(
        `insert into audit_events (actor_uid, action, entity_kind, entity_id, channel, data)
         values ('system:bootstrap', 'staff.bootstrapped', 'staff_user', $1, 'SYSTEM', $2)`,
        [user.uid, JSON.stringify({ project, email, source: 'bootstrap-admin' })],
      );
    });
    await auth.setCustomUserClaims(user.uid, { role: 'SUPER_ADMIN', branchIds: [] });
    const link = await auth.generatePasswordResetLink(email);
    console.log(`Super admin ready in ${project}: ${email} (uid ${user.uid}).`);
    console.log('Open this link once to set the password (it expires):');
    console.log(link);
  }
} finally {
  await db.close();
}
