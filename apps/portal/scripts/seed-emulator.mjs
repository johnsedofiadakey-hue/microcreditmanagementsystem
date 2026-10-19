#!/usr/bin/env node
/**
 * Replaced by the backend's seed (API.md §6), which creates the admin in Auth *and* staff_users —
 * callables refuse an Auth-only admin with STAFF_NOT_ACTIVE.
 *
 *   corepack pnpm --filter @susu/functions seed:local
 */
console.error('This script is retired. Run: corepack pnpm --filter @susu/functions seed:local');
process.exit(1);
