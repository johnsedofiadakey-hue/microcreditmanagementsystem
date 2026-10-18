import { PGlite } from '@electric-sql/pglite';
import type { Database, Queryable } from './types.js';

/** In-process Postgres for tests. Same SQL, same triggers, no server needed. */
export async function createPgliteDatabase(): Promise<Database> {
  const db = new PGlite({
    parsers: { 20: (value: string) => Number(value) },
  });
  await db.waitReady;

  const wrap = (q: Pick<PGlite, 'query'>): Queryable => ({
    async query<T>(sql: string, params?: readonly unknown[]) {
      const result = await q.query<T>(sql, params as unknown[] | undefined);
      // Match node-postgres: statements that return rows report how many; others report rows affected.
      const rowCount = result.fields.length > 0 ? result.rows.length : (result.affectedRows ?? 0);
      return { rows: result.rows, rowCount };
    },
  });

  return {
    ...wrap(db),
    async exec(sql) {
      await db.exec(sql);
    },
    transaction: (fn) => db.transaction((tx) => fn(wrap(tx))),
    close: () => db.close(),
  };
}
