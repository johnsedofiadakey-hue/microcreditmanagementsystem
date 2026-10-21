import type { Database } from './types.js';

/**
 * A Database whose connection is set up asynchronously on first use (e.g. the Cloud SQL connector
 * fetching certificates), so callers can keep a synchronous `getDatabase()`. A failed setup is
 * retried on the next call instead of being cached.
 */
export function createLazyDatabase(init: () => Promise<Database>): Database {
  let ready: Promise<Database> | undefined;
  const get = () => {
    ready ??= init().catch((error: unknown) => {
      ready = undefined;
      throw error;
    });
    return ready;
  };
  return {
    query: async (sql, params) => (await get()).query(sql, params),
    exec: async (sql) => (await get()).exec(sql),
    transaction: async (fn) => (await get()).transaction(fn),
    close: async () => {
      if (ready) await (await ready).close();
      ready = undefined;
    },
  };
}
