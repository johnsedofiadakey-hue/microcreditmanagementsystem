/**
 * Apply pending SQL migrations.
 *   DATABASE_URL=postgresql:///susu_dev corepack pnpm --filter @susu/functions migrate
 */
import { migrate } from '../src/db/migrate.js';
import { createPgDatabase } from '../src/db/pg.js';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('Set DATABASE_URL, e.g. postgresql:///susu_dev');
  process.exit(1);
}

const db = createPgDatabase(url, 1);
try {
  const ran = await migrate(db);
  console.log(ran.length ? `Applied: ${ran.join(', ')}` : 'Database is up to date.');
} finally {
  await db.close();
}
