import {
  createBankAccountRequestSchema,
  ignoreBankStatementLineRequestSchema,
  importBankStatementRequestSchema,
  listBankAccountsRequestSchema,
  listBankDepositsRequestSchema,
  listBankStatementLinesRequestSchema,
  matchBankDepositRequestSchema,
  recordBankDepositRequestSchema,
} from '@susu/shared';
import { createBankAccount, listBankAccounts } from '../bank/accounts.js';
import { recordBankDeposit } from '../bank/deposits.js';
import { listBankDeposits, listBankStatementLines } from '../bank/reads.js';
import { ignoreBankStatementLine, importBankStatement, matchBankDeposit } from '../bank/statements.js';
import { publishBranchAndCompanyDay } from '../projections/firestore.js';
import { branchOfRecord } from '../reads/dashboards.js';
import { staffCallable } from './staffCallable.js';

// ── Step 7: branch close → bank deposit → bank statement match (API.md §2) ──

export const createBankAccountFn = staffCallable(createBankAccountRequestSchema, ({ db, actor, input }) =>
  db.transaction((tx) => createBankAccount(tx, actor, input)),
);
export const listBankAccountsFn = staffCallable(listBankAccountsRequestSchema, ({ db, actor, input }) => listBankAccounts(db, actor, input));

export const recordBankDepositFn = staffCallable(recordBankDepositRequestSchema, async ({ db, actor, input }) => {
  const result = await db.transaction((tx) => recordBankDeposit(tx, actor, input));
  await publishBranchAndCompanyDay(db, input.branchId);
  return result;
});
export const listBankDepositsFn = staffCallable(listBankDepositsRequestSchema, ({ db, actor, input }) => listBankDeposits(db, actor, input));

export const importBankStatementFn = staffCallable(importBankStatementRequestSchema, ({ db, actor, input }) =>
  db.transaction((tx) => importBankStatement(tx, actor, input)),
);
export const listBankStatementLinesFn = staffCallable(listBankStatementLinesRequestSchema, ({ db, actor, input }) =>
  listBankStatementLines(db, actor, input),
);

export const matchBankDepositFn = staffCallable(matchBankDepositRequestSchema, async ({ db, actor, input }) => {
  const result = await db.transaction((tx) => matchBankDeposit(tx, actor, input));
  const branchId = await branchOfRecord(db, 'deposit', input.depositId).catch(() => null);
  if (branchId) await publishBranchAndCompanyDay(db, branchId);
  return result;
});
export const ignoreBankStatementLineFn = staffCallable(ignoreBankStatementLineRequestSchema, async ({ db, actor, input }) => {
  await db.transaction((tx) => ignoreBankStatementLine(tx, actor, input));
  return null;
});
