'use client';

import type {
  BranchCashDay,
  CaseSummary,
  ConfirmHandoverRequest,
  DecideWithdrawalRequest,
  HandoverDeclarationSummary,
  HandoverResult,
  HandoverSummary,
  RejectWithdrawalRequest,
  ResolveCaseRequest,
  SubmitBranchCountRequest,
  WithdrawalStatus,
  WithdrawalSummary,
} from '@susu/shared';
import { call, write } from './api';

/** Server-owned cash checklist (API.md §2). Each business is a separate vault and close. */
export function getBranchCashDay(input: { branchId: string; day: string }): Promise<BranchCashDay> {
  return call('getBranchCashDay', input);
}

/** Cash list cursors come from API.md §2; omit the cursor on the first page. */
export function listWithdrawals(input: { branchId?: string; businessId?: string; status?: WithdrawalStatus; cursor?: string }) {
  return call<typeof input, { withdrawals: WithdrawalSummary[]; nextCursor: string | null }>('listWithdrawals', input);
}

export function listHandovers(input: { branchId?: string; businessId?: string; day?: string; cursor?: string }) {
  return call<typeof input, { handovers: HandoverSummary[]; nextCursor: string | null }>('listHandovers', input);
}

export function listHandoverDeclarations(input: { branchId?: string; status?: 'OPEN' | 'ALL'; cursor?: string | null; limit?: number }) {
  return call<typeof input, { declarations: HandoverDeclarationSummary[]; nextCursor: string | null }>('listHandoverDeclarations', input);
}

export function confirmHandover(input: ConfirmHandoverRequest) {
  return write<ConfirmHandoverRequest, HandoverResult>('confirmHandover', input);
}

export function listCases(input: { branchId?: string; businessId?: string; status?: 'OPEN' | 'RESOLVED'; cursor?: string }) {
  return call<typeof input, { cases: CaseSummary[]; nextCursor: string | null }>('listCases', input);
}

export function approveWithdrawal(input: DecideWithdrawalRequest) {
  return write<DecideWithdrawalRequest, null>('approveWithdrawal', input);
}

export function rejectWithdrawal(input: RejectWithdrawalRequest) {
  return write<RejectWithdrawalRequest, null>('rejectWithdrawal', input);
}

export function payWithdrawal(input: DecideWithdrawalRequest) {
  return write<DecideWithdrawalRequest, { batchId: string }>('payWithdrawal', input);
}

export function resolveCase(input: ResolveCaseRequest) {
  return write<ResolveCaseRequest, null>('resolveCase', input);
}

export function submitBranchCount(input: SubmitBranchCountRequest) {
  return write<SubmitBranchCountRequest, { countId: string; expectedPesewas: number; differencePesewas: number }>('submitBranchCount', input);
}
