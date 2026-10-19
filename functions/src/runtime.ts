import { defineSecret, defineString } from 'firebase-functions/params';
import { createPgDatabase } from './db/pg.js';
import type { Database } from './db/types.js';
import { ArkeselSmsProvider, LogSmsProvider, type SmsProvider } from './messaging/providers.js';

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

/**
 * SMS (BUILD_PLAN Step 5). SMS_PROVIDER picks the adapter: `log` (default; sends nothing) or `arkesel`.
 * SMS_SENDER_ID is the approved sender name (max 11 characters); SMS_BRAND starts every message.
 * SMS_API_KEY is only read when the provider needs it; in the emulator it may be empty.
 */
export const SMS_PROVIDER = defineString('SMS_PROVIDER', { default: 'log' });
export const SMS_SENDER_ID = defineString('SMS_SENDER_ID', { default: 'Susu' });
export const SMS_BRAND = defineString('SMS_BRAND', { default: 'Susu' });
export const SMS_API_KEY = defineSecret('SMS_API_KEY');

let smsProvider: SmsProvider | undefined;

export function getSmsProvider(): SmsProvider {
  if (smsProvider) return smsProvider;
  const name = SMS_PROVIDER.value();
  if (name === 'arkesel') smsProvider = new ArkeselSmsProvider(SMS_API_KEY.value(), SMS_SENDER_ID.value());
  else if (name === 'log') smsProvider = new LogSmsProvider();
  else throw new Error(`Unknown SMS_PROVIDER "${name}" (use log or arkesel)`);
  return smsProvider;
}
