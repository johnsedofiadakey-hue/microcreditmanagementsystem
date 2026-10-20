import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { deviceSeqStates } from '../src/commands/unprocessed.js';
import { processAgentCommand } from '../src/commands/processAgentCommand.js';
import type { Database } from '../src/db/types.js';
import { freshDatabase, seedBranch, signedCollection } from './helpers.js';

let db: Database;
let seed: Awaited<ReturnType<typeof seedBranch>>;

beforeEach(async () => {
  db = await freshDatabase();
  seed = await seedBranch(db);
});

afterEach(async () => {
  await db.close();
});

describe('deviceSeqStates — what recovery looks for (audit M4)', () => {
  it('reports each bound device’s highest processed seq and the numbers it never received', async () => {
    expect(await deviceSeqStates(db)).toEqual([{ deviceId: 'device-a', maxSeq: 0, missingSeqs: [] }]);
    for (const seq of [1, 3, 6]) {
      const c = signedCollection(seed.key, { ...seed, seq, amountPesewas: 100 });
      await processAgentCommand(db, c.id, c.body);
    }
    expect(await deviceSeqStates(db)).toEqual([{ deviceId: 'device-a', maxSeq: 6, missingSeqs: [2, 4, 5] }]);
  });

  it('counts rejected commands as processed', async () => {
    const c = signedCollection(seed.key, { ...seed, seq: 1, amountPesewas: 100, susuAccountId: '00000000-0000-4000-8000-000000000000' });
    expect((await processAgentCommand(db, c.id, c.body)).status).toBe('REJECTED');
    expect(await deviceSeqStates(db)).toEqual([{ deviceId: 'device-a', maxSeq: 1, missingSeqs: [] }]);
  });
});
