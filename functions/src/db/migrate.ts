import type { Database } from './types.js';
import { migration001Core } from './migrations/001_core.js';
import { migration002Hardening } from './migrations/002_hardening.js';
import { migration003Routes } from './migrations/003_routes.js';
import { migration004OutboxDispatch } from './migrations/004_outbox_dispatch.js';
import { migration005Cash } from './migrations/005_cash.js';
import { migration006Businesses } from './migrations/006_businesses.js';
import { migration007CashControls } from './migrations/007_cash_controls.js';
import { migration008Bank } from './migrations/008_bank.js';
import { migration009Corrections } from './migrations/009_corrections.js';

export interface Migration {
  id: string;
  sql: string;
}

/** Ordered list. Never edit a migration that has run anywhere; add a new one. */
export const MIGRATIONS: readonly Migration[] = [migration001Core, migration002Hardening, migration003Routes, migration004OutboxDispatch, migration005Cash, migration006Businesses, migration007CashControls, migration008Bank, migration009Corrections];

/** `until`: stop after this migration (tests that check a migration against data from earlier ones). */
export async function migrate(db: Database, options: { until?: string } = {}): Promise<string[]> {
  await db.exec(`
    create table if not exists schema_migrations (
      id text primary key,
      applied_at timestamptz not null default now()
    );
  `);
  const applied = new Set(
    (await db.query<{ id: string }>('select id from schema_migrations')).rows.map((row) => row.id),
  );
  const ran: string[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.id)) continue;
    await db.exec(`begin;\n${migration.sql}\ninsert into schema_migrations (id) values ('${migration.id}');\ncommit;`);
    ran.push(migration.id);
    if (migration.id === options.until) break;
  }
  return ran;
}
