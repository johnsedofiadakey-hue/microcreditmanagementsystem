import pg from 'pg';
import type { Database, Queryable, QueryResult } from './types.js';

// int8 (bigint) columns hold pesewas and sequence numbers; all stay below 2^53, so parse to number.
pg.types.setTypeParser(pg.types.builtins.INT8, (value) => Number(value));

const SERIALIZATION_FAILURE = '40001';
const DEADLOCK_DETECTED = '40P01';
const MAX_ATTEMPTS = 5;

export function createPgDatabase(connectionString: string, maxConnections = 5): Database {
  const pool = new pg.Pool({ connectionString, max: maxConnections });

  const run = async <T>(client: pg.Pool | pg.PoolClient, sql: string, params?: readonly unknown[]) => {
    const result = await client.query(sql, params as unknown[] | undefined);
    return { rows: result.rows as T[], rowCount: result.rowCount ?? 0 } satisfies QueryResult<T>;
  };

  return {
    query: (sql, params) => run(pool, sql, params),

    async exec(sql) {
      await pool.query(sql);
    },

    async transaction(fn) {
      for (let attempt = 1; ; attempt++) {
        const client = await pool.connect();
        try {
          await client.query('BEGIN');
          const tx: Queryable = { query: (sql, params) => run(client, sql, params) };
          const result = await fn(tx);
          await client.query('COMMIT');
          return result;
        } catch (error) {
          await client.query('ROLLBACK').catch(() => undefined);
          const code = (error as { code?: string }).code;
          if ((code === SERIALIZATION_FAILURE || code === DEADLOCK_DETECTED) && attempt < MAX_ATTEMPTS) {
            await new Promise((resolve) => setTimeout(resolve, 20 * attempt));
            continue;
          }
          throw error;
        } finally {
          client.release();
        }
      }
    },

    close: () => pool.end(),
  };
}
