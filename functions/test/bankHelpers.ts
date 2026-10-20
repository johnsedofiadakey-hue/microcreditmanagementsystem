import { expect } from 'vitest';
import { createBankAccount } from '../src/bank/accounts.js';
import { closeBranchDay, submitBranchCount } from '../src/cash/close.js';
import { today } from '../src/cash/common.js';
import { confirmHandover } from '../src/cash/handovers.js';
import { processAgentCommand } from '../src/commands/processAgentCommand.js';
import type { Database } from '../src/db/types.js';
import { actor, signedCollection, signedDeclaration, type seedBranch } from './helpers.js';

export type Seed = Awaited<ReturnType<typeof seedBranch>>;
export const finance = () => actor('finance-1', 'FINANCE');

/** The next Accra day after `day`, and a Date at 08:00 on it — "the morning after the close". */
export function nextDay(day: string): { day: string; morning: Date } {
  const d = new Date(`${day}T08:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return { day: d.toISOString().slice(0, 10), morning: d };
}

/** Today at one branch: signed collections, then a two-party handover of all of it into the vault. */
export async function handedOver(db: Database, seed: Seed, collected: number[], startSeq = 1): Promise<{ total: number; nextSeq: number }> {
  let seq = startSeq;
  for (const amountPesewas of collected) {
    const c = signedCollection(seed.key, { ...seed, amountPesewas, seq: seq++ });
    expect((await processAgentCommand(db, c.id, c.body)).status).toBe('POSTED');
  }
  const total = collected.reduce((a, b) => a + b, 0);
  const d = signedDeclaration(seed.key, { seq: seq++, lines: [{ businessId: seed.businessId, declaredPesewas: total }] });
  expect((await processAgentCommand(db, d.id, d.body)).status).toBe('RECORDED');
  await db.transaction((tx) =>
    confirmHandover(tx, seed.cashier, { declarationId: d.id, businessId: seed.businessId, expectedPesewas: total, countedPesewas: total }),
  );
  return { total, nextSeq: seq };
}

/** `handedOver`, then the cashier counts the vault and the manager closes today. Returns the closed day. */
export async function closedDay(db: Database, seed: Seed, collected: number[], startSeq = 1): Promise<{ day: string; nextSeq: number }> {
  const { nextSeq } = await handedOver(db, seed, collected, startSeq);
  const day = today();
  const vault = (await db.query<{ balance_pesewas: number }>(
    `select b.balance_pesewas from ledger_accounts a join account_balances b on b.account_id = a.id
      where a.kind = 'BRANCH_CASH' and a.owner_id = $1 and a.business_id = $2`,
    [seed.branchId, seed.businessId],
  )).rows[0]!.balance_pesewas;
  await db.transaction((tx) => submitBranchCount(tx, seed.cashier, { branchId: seed.branchId, businessId: seed.businessId, day, countedPesewas: vault }));
  await db.transaction((tx) => closeBranchDay(tx, seed.manager, { branchId: seed.branchId, businessId: seed.businessId, day }));
  return { day, nextSeq };
}

export async function bankAccount(db: Database, seed: Seed, last4 = '1234', businessId: string = seed.businessId): Promise<string> {
  return (
    await db.transaction((tx) =>
      createBankAccount(tx, finance(), { businessId, bankName: 'GCB Bank', accountName: 'Gadufia Fiase Susu Services', accountNumberLast4: last4 }),
    )
  ).bankAccountId;
}
