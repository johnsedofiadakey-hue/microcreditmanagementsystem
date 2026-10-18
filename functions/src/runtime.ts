import { defineSecret, defineString } from 'firebase-functions/params';
import { createPgDatabase } from './db/pg.js';
import type { Database } from './db/types.js';

/** Region for every function. Decide in Stage 0 (BUILD_PLAN §4); all Firebase products share it. */
export const REGION = defineString('FUNCTIONS_REGION', { default: 'europe-west1' });

/**
 * Postgres connection string for the Data Connect / Cloud SQL instance, e.g.
 * postgresql://susu_app:…@/susu?host=/cloudsql/PROJECT:REGION:INSTANCE
 */
export const DATABASE_URL = defineSecret('DATABASE_URL');

let database: Database | undefined;

/** One pool per function instance, created on first use. */
export function getDatabase(): Database {
  database ??= createPgDatabase(DATABASE_URL.value());
  return database;
}
