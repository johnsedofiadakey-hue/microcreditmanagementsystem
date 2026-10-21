import { describe, expect, it } from 'vitest';
import { createLazyDatabase } from '../src/db/lazy.js';
import { createPgliteDatabase } from '../src/db/pglite.js';
import type { Database } from '../src/db/types.js';

describe('createLazyDatabase (Cloud SQL connector start-up)', () => {
  it('connects once on first use and reuses the connection', async () => {
    let inits = 0;
    const db = createLazyDatabase(async () => {
      inits += 1;
      return createPgliteDatabase();
    });
    expect(inits).toBe(0);
    expect((await db.query<{ n: number }>('select 1 as n')).rows[0]!.n).toBe(1);
    await db.transaction((tx) => tx.query('select 1'));
    expect(inits).toBe(1);
    await db.close();
  });

  it('retries a failed start-up instead of caching the failure', async () => {
    let attempts = 0;
    const db = createLazyDatabase(async (): Promise<Database> => {
      attempts += 1;
      if (attempts === 1) throw new Error('certificate fetch failed');
      return createPgliteDatabase();
    });
    await expect(db.query('select 1')).rejects.toThrow('certificate fetch failed');
    expect((await db.query('select 1')).rowCount).toBe(1);
    expect(attempts).toBe(2);
    await db.close();
  });
});
