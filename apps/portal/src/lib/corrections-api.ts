'use client';

import type {
  CorrectionStatus,
  CorrectionSummary,
  DecideCorrectionRequest,
  RejectCorrectionRequest,
  RequestCollectionCorrectionRequest,
} from '@susu/shared';
import { call, LIST_LIMIT, write } from './api';

/** Corrections to posted collections (API.md §2 "Corrections to collections"). Maker-checker. */

export function requestCollectionCorrection(input: RequestCollectionCorrectionRequest) {
  return write<RequestCollectionCorrectionRequest, { correctionId: string; needsHeadOffice: boolean }>(
    'requestCollectionCorrection',
    input,
  );
}

export function approveCorrection(input: DecideCorrectionRequest) {
  return write<DecideCorrectionRequest, { batchId: string }>('approveCorrection', input);
}

export function rejectCorrection(input: RejectCorrectionRequest) {
  return write<RejectCorrectionRequest, null>('rejectCorrection', input);
}

export function listCorrections(input: { branchId?: string; status?: CorrectionStatus; cursor?: string | null }) {
  return call<typeof input & { limit: number }, { corrections: CorrectionSummary[]; nextCursor: string | null }>(
    'listCorrections',
    { ...input, limit: LIST_LIMIT },
  );
}

/** Statement line kinds written by corrections, with readable copy. */
export const CORRECTION_STATEMENT_KINDS: Record<string, string> = {
  'CORRECTION:MOVE_COLLECTION': 'Correction · wrong member',
  'CORRECTION:REDUCE_COLLECTION': 'Correction · amount reduced',
  'REVERSAL:SUSU_COLLECTION': 'Correction · collection reversed',
};

export const CORRECTION_KIND_LABEL: Record<CorrectionSummary['kind'], string> = {
  REVERSE_COLLECTION: 'Member did not pay',
  REDUCE_COLLECTION: 'Amount too high',
  MOVE_COLLECTION: 'Wrong member',
};
