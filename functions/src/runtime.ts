import { defineBoolean, defineSecret, defineString } from 'firebase-functions/params';
import { Connector, IpAddressTypes } from '@google-cloud/cloud-sql-connector';
import { createLazyDatabase } from './db/lazy.js';
import { createPgDatabase } from './db/pg.js';
import type { Database } from './db/types.js';
import { ArkeselSmsProvider, LogSmsProvider, type SmsProvider } from './messaging/providers.js';

/**
 * Callables refuse requests without a valid App Check token. On by default and for every production
 * project; a test project may switch it off in `functions/.env.<projectId>` until its web and Android
 * apps are registered with App Check (docs/ops/ENVIRONMENT_CHECKLIST.md item 3).
 */
export const ENFORCE_APP_CHECK = defineBoolean('ENFORCE_APP_CHECK', { default: true });

/** Region for every function. Decide in Stage 0 (BUILD_PLAN §4); all Firebase products share it. */
export const REGION = defineString('FUNCTIONS_REGION', { default: 'europe-west1' });

/**
 * Postgres credentials. With CLOUD_SQL_INSTANCE set (deployed): user, password and database only, e.g.
 * postgresql://susu_app:…@localhost/susu — the connector supplies the secure connection and the host is
 * ignored. Without it (emulator, tests, local scripts): a full connection string to a reachable server.
 */
export const DATABASE_URL = defineSecret('DATABASE_URL');

/**
 * Cloud SQL instance connection name, PROJECT:REGION:INSTANCE. Empty = connect with DATABASE_URL directly.
 * Connections go through the Cloud SQL Node.js connector: TLS with certificates issued to the
 * function's service account (it needs roles/cloudsql.client), no authorised networks to open.
 */
export const CLOUD_SQL_INSTANCE = defineString('CLOUD_SQL_INSTANCE', { default: '' });

let database: Database | undefined;

/** One pool per function instance, created on first use. */
export function getDatabase(): Database {
  if (database) return database;
  const instanceConnectionName = CLOUD_SQL_INSTANCE.value();
  if (!instanceConnectionName) {
    database = createPgDatabase(DATABASE_URL.value());
    return database;
  }
  database = createLazyDatabase(async () => {
    const connector = new Connector();
    const options = await connector.getOptions({ instanceConnectionName, ipType: IpAddressTypes.PUBLIC });
    return createPgDatabase(DATABASE_URL.value(), 5, options);
  });
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
