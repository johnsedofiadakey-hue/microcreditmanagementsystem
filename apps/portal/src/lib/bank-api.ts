'use client';

import type {
  BankAccountSummary,
  BankDepositStatus,
  BankDepositSummary,
  BankLineStatus,
  BankStatementLineSummary,
  CreateBankAccountRequest,
  IgnoreBankStatementLineRequest,
  ImportBankStatementRequest,
  ImportBankStatementResult,
  MatchBankDepositRequest,
  MatchBankDepositResult,
  RecordBankDepositRequest,
} from '@susu/shared';
import { call, LIST_LIMIT, write } from './api';

/** Step 7 bank deposits and statement matching (API.md §2 "Bank deposits"). */

export function listBankAccounts(input: { businessId?: string } = {}) {
  return call<typeof input, { bankAccounts: BankAccountSummary[] }>('listBankAccounts', input);
}

export function createBankAccount(input: CreateBankAccountRequest) {
  return write<CreateBankAccountRequest, { bankAccountId: string }>('createBankAccount', input);
}

export function recordBankDeposit(input: RecordBankDepositRequest) {
  return write<RecordBankDepositRequest, { depositId: string; batchId: string }>('recordBankDeposit', input);
}

export function listBankDeposits(input: { branchId?: string; businessId?: string; status?: BankDepositStatus; cursor?: string | null }) {
  return call<typeof input & { limit: number }, { deposits: BankDepositSummary[]; nextCursor: string | null }>('listBankDeposits', {
    ...input,
    limit: LIST_LIMIT,
  });
}

export function importBankStatement(input: ImportBankStatementRequest) {
  return write<ImportBankStatementRequest, ImportBankStatementResult>('importBankStatement', input);
}

export function listBankStatementLines(input: { bankAccountId: string; status?: BankLineStatus; cursor?: string | null }) {
  return call<typeof input & { limit: number }, { lines: BankStatementLineSummary[]; nextCursor: string | null }>(
    'listBankStatementLines',
    { ...input, limit: LIST_LIMIT },
  );
}

export function matchBankDeposit(input: MatchBankDepositRequest) {
  return write<MatchBankDepositRequest, MatchBankDepositResult>('matchBankDeposit', input);
}

export function ignoreBankStatementLine(input: IgnoreBankStatementLineRequest) {
  return write<IgnoreBankStatementLineRequest, null>('ignoreBankStatementLine', input);
}
