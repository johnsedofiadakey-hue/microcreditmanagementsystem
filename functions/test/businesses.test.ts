import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { branchCashDay, closeBranchDay, submitBranchCount } from '../src/cash/close.js';
import { today } from '../src/cash/common.js';
import { confirmHandover } from '../src/cash/handovers.js';
import { approveWithdrawal, payWithdrawal, requestWithdrawal } from '../src/cash/withdrawals.js';
import { processAgentCommand } from '../src/commands/processAgentCommand.js';
import type { Database } from '../src/db/types.js';
import { findLedgerAccountId, getBalance } from '../src/ledger/accounts.js';
import { postJournal } from '../src/ledger/post.js';
import { findBalanceMismatches } from '../src/ledger/reconcile.js';
import { createSusuProduct, openSusuAccount } from '../src/members/members.js';
import { getMember } from '../src/reads/members.js';
import { listBusinesses } from '../src/reads/org.js';
import { setBusinessModule } from '../src/org/modules.js';
import { assignCollector } from '../src/routes/routes.js';
import { GADUFIA, OPWS, STF, actor, freshDatabase, seedBranch, signedCollection, signedDeclaration } from './helpers.js';

let db: Database;
let seed: Awaited<ReturnType<typeof seedBranch>>;
/** The same member's account with the welfare business. */
let welfareAccountId: string;
let seq = 0;
const cashier2 = () => actor('cashier-2', 'CASHIER', [seed.branchId]);

beforeEach(async () => {
  db = await freshDatabase();
  seed = await seedBranch(db);
  seq = 0;
  // Only Gadufia's Susu is live in Stage 1 (audit M3); these tests switch OPWS on to prove separation.
  await db.transaction((tx) => setBusinessModule(tx, seed.admin, { businessId: OPWS, module: 'SUSU', enabled: true, reason: 'Separation test' }));
  const { productId } = await db.transaction((tx) =>
    createSusuProduct(tx, seed.admin, { businessId: OPWS, code: 'DAILY', name: 'Welfare contribution', frequency: 'DAILY' }),
  );
  ({ susuAccountId: welfareAccountId } = await db.transaction((tx) =>
    openSusuAccount(tx, seed.manager, { memberId: seed.memberId, productId }),
  ));
  await db.transaction((tx) =>
    assignCollector(tx, seed.manager, { susuAccountId: welfareAccountId, agentPairId: seed.agentPairId, expectedPesewas: 500 }),
  );
});

afterEach(async () => {
  await db.close();
});

async function collect(susuAccountId: string, amountPesewas: number) {
  seq += 1;
  const c = signedCollection(seed.key, { memberId: seed.memberId, susuAccountId, amountPesewas, seq });
  expect((await processAgentCommand(db, c.id, c.body)).status).toBe('POSTED');
  return c.id;
}
const balance = async (kind: Parameters<typeof findLedgerAccountId>[1], ownerId: string, businessId: string) => {
  const id = await findLedgerAccountId(db, kind, ownerId, businessId);
  return id ? getBalance(db, id) : 0;
};
const custody = (businessId: string) => balance('AGENT_CASH_CUSTODY', seed.agentPairId, businessId);
const vault = (businessId: string) => balance('BRANCH_CASH', seed.branchId, businessId);
async function handover(businessId: string, expectedPesewas: number, countedPesewas = expectedPesewas) {
  seq += 1;
  const d = signedDeclaration(seed.key, { seq, lines: [{ businessId, declaredPesewas: Math.max(countedPesewas, 1) }] });
  expect((await processAgentCommand(db, d.id, d.body)).status).toBe('RECORDED');
  return db.transaction((tx) => confirmHandover(tx, seed.cashier, { declarationId: d.id, businessId, expectedPesewas, countedPesewas }));
}

describe('three businesses on one platform (ADR-001)', () => {
  it('lists the client’s three businesses with their SMS identities', async () => {
    const { businesses } = await listBusinesses(db, seed.cashier);
    expect(businesses.map((b) => [b.code, b.name, b.smsSenderId])).toEqual([
      ['GADUFIA', 'Gadufia Fiase Susu Services', 'GadufiaSusu'],
      ['OPWS', 'Opportunity People’s Welfare Scheme International Association'.replace('’', "'"), 'OPWelfare'],
      ['STF', 'STF Micro-Credit Services', 'STFCredit'],
    ]);
  });

  it('one member profile holds accounts with two businesses', async () => {
    const { profile } = await getMember(db, seed.manager, { memberId: seed.memberId });
    expect(profile.accounts.map((a) => [a.businessId, a.productName])).toEqual([
      [GADUFIA, 'Daily Susu'],
      [OPWS, 'Welfare contribution'],
    ]);
  });

  it('product codes are per business: both may have DAILY v1', async () => {
    const products = await db.query<{ business_id: string; code: string; version: number }>(
      `select business_id, code, version from susu_products where code = 'DAILY' order by business_id`,
    );
    expect(products.rows.map((p) => p.version)).toEqual([1, 1]);
  });

  it('a pair carries each business’s cash in its own custody', async () => {
    await collect(seed.susuAccountId, 2_000);
    await collect(welfareAccountId, 500);
    expect([await custody(GADUFIA), await custody(OPWS), await custody(STF)]).toEqual([2_000, 500, 0]);
  });

  it('each receipt carries its own business’s name and sender ID', async () => {
    const susu = await collect(seed.susuAccountId, 2_000);
    const welfare = await collect(welfareAccountId, 500);
    const rows = await db.query<{ dedupe_key: string; payload: { brand: string; senderId: string } }>(
      'select dedupe_key, payload from outbox where dedupe_key = any($1::text[])',
      [[`sms:collection:${susu}`, `sms:collection:${welfare}`]],
    );
    const byKey = Object.fromEntries(rows.rows.map((r) => [r.dedupe_key, [r.payload.brand, r.payload.senderId]]));
    expect(byKey[`sms:collection:${susu}`]).toEqual(['Gadufia Susu', 'GadufiaSusu']);
    expect(byKey[`sms:collection:${welfare}`]).toEqual(['Opportunity Welfare', 'OPWelfare']);
  });

  it('handovers are per business and never move another business’s cash', async () => {
    await collect(seed.susuAccountId, 2_000);
    await collect(welfareAccountId, 500);
    await handover(GADUFIA, 2_000);
    expect([await custody(GADUFIA), await vault(GADUFIA), await custody(OPWS), await vault(OPWS)]).toEqual([0, 2_000, 500, 0]);
    // The welfare cash is still expected separately.
    await expect(handover(OPWS, 2_500)).rejects.toMatchObject({ reason: 'EXPECTED_CASH_CHANGED', details: { expectedPesewas: 500 } });
    await handover(OPWS, 500, 450);
    expect([await vault(OPWS), await balance('BRANCH_CASH_VARIANCE', seed.branchId, OPWS)]).toEqual([450, 50]);
    expect(await balance('BRANCH_CASH_VARIANCE', seed.branchId, GADUFIA)).toBe(0);
    expect(await findBalanceMismatches(db)).toEqual([]);
  });

  it('a withdrawal is paid from its own business’s vault, never another’s', async () => {
    await collect(welfareAccountId, 3_000);
    await collect(seed.susuAccountId, 10_000);
    await handover(GADUFIA, 10_000); // only the Susu vault holds cash
    const { withdrawalId } = await db.transaction((tx) =>
      requestWithdrawal(tx, seed.cashier, { susuAccountId: welfareAccountId, amountPesewas: 1_000, reason: 'Funeral support' }),
    );
    await db.transaction((tx) => approveWithdrawal(tx, seed.manager, { withdrawalId }));
    await expect(db.transaction((tx) => payWithdrawal(tx, cashier2(), { withdrawalId }))).rejects.toMatchObject({ reason: 'INSUFFICIENT_BALANCE' });
    await handover(OPWS, 3_000);
    await db.transaction((tx) => payWithdrawal(tx, cashier2(), { withdrawalId }));
    expect([await vault(OPWS), await vault(GADUFIA)]).toEqual([2_000, 10_000]);
  });

  it('the database refuses a journal batch that mixes two businesses', async () => {
    await collect(seed.susuAccountId, 1_000);
    const gadufiaCustody = (await findLedgerAccountId(db, 'AGENT_CASH_CUSTODY', seed.agentPairId, GADUFIA))!;
    const welfareMember = (await findLedgerAccountId(db, 'MEMBER_SUSU', welfareAccountId, OPWS))!;
    await expect(
      db.transaction((tx) =>
        postJournal(tx, {
          idempotencyKey: 'mix-1',
          kind: 'TEST',
          description: 'Susu cash credited to a welfare account',
          branchId: seed.branchId,
          actorUid: 'admin-1',
          channel: 'SYSTEM',
          lines: [
            { accountId: gadufiaCustody, side: 'DEBIT', amountPesewas: 100 },
            { accountId: welfareMember, side: 'CREDIT', amountPesewas: 100 },
          ],
        }),
      ),
    ).rejects.toThrow(/mix the money of two businesses/);
  });

  it('a ledger account’s business can never change', async () => {
    const id = (await findLedgerAccountId(db, 'MEMBER_SUSU', seed.susuAccountId, GADUFIA))!;
    await expect(db.query('update ledger_accounts set business_id = $2 where id = $1', [id, STF])).rejects.toThrow(/immutable/);
  });

  it('each business closes its own day; closing one leaves the others open', async () => {
    await collect(seed.susuAccountId, 2_000);
    await collect(welfareAccountId, 500);
    await handover(GADUFIA, 2_000);
    await db.transaction((tx) => submitBranchCount(tx, seed.cashier, { branchId: seed.branchId, businessId: GADUFIA, day: today(), countedPesewas: 2_000 }));
    await db.transaction((tx) => closeBranchDay(tx, seed.manager, { branchId: seed.branchId, businessId: GADUFIA, day: today() }));

    await expect(handover(GADUFIA, 0, 100)).rejects.toMatchObject({ reason: 'BRANCH_DAY_CLOSED' });
    await expect(handover(OPWS, 500)).resolves.toMatchObject({ differencePesewas: 0 });

    const day = await branchCashDay(db, seed.branchId, today());
    expect(day.businesses.map((b) => [b.businessId, b.status, b.expectedCashPesewas, b.collectedTodayPesewas])).toEqual([
      [GADUFIA, 'CLOSED', 2_000, 2_000],
      [OPWS, 'OPEN', 500, 500],
      [STF, 'OPEN', 0, 0],
    ]);
  });
});
