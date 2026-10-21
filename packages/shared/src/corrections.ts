import { z } from 'zod';
import { positivePesewasSchema } from './money';

/**
 * Corrections to posted collections (client guide §10, API.md §2 "Corrections"). A collection is never
 * edited: one person requests a correction, a different authorised person approves or rejects it, and
 * only an approval posts money — linked to that approval in the database.
 *
 *   REVERSE_COLLECTION  the member did not pay: the whole collection is reversed (member and pair custody)
 *   REDUCE_COLLECTION   too much was recorded: the excess comes off the member and the pair's custody
 *   MOVE_COLLECTION     recorded against the wrong member: moved to the right account; cash untouched
 */
export const CORRECTION_KINDS = ['REVERSE_COLLECTION', 'REDUCE_COLLECTION', 'MOVE_COLLECTION'] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

export const CORRECTION_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export type CorrectionStatus = (typeof CORRECTION_STATUSES)[number];

/**
 * Corrections above this need head-office approval (SUPER_ADMIN, FINANCE or COMPLIANCE); at or below
 * it a BRANCH_MANAGER of the branch may approve. GH₵ 1,000.00 until the client's approval matrix says otherwise.
 */
export const CORRECTION_HEAD_OFFICE_THRESHOLD_PESEWAS = 100_000;

const reason = z.string().trim().min(10, 'Explain what went wrong (at least 10 characters)').max(500);

export const requestCollectionCorrectionRequestSchema = z
  .object({
    /** The collection's journal batch — `batchId` on a statement line of kind SUSU_COLLECTION. */
    collectionBatchId: z.uuid(),
    kind: z.enum(CORRECTION_KINDS),
    /** REDUCE_COLLECTION only: what should have been recorded (less than the collection, at least 1 pesewa). */
    correctPesewas: positivePesewasSchema.optional(),
    /** MOVE_COLLECTION only: the right member's Susu account (same branch and business). */
    toSusuAccountId: z.uuid().optional(),
    reason,
  })
  .strict()
  .refine((v) => (v.kind === 'REDUCE_COLLECTION') === (v.correctPesewas !== undefined), {
    message: 'correctPesewas is required for REDUCE_COLLECTION and only for it',
    path: ['correctPesewas'],
  })
  .refine((v) => (v.kind === 'MOVE_COLLECTION') === (v.toSusuAccountId !== undefined), {
    message: 'toSusuAccountId is required for MOVE_COLLECTION and only for it',
    path: ['toSusuAccountId'],
  });
export type RequestCollectionCorrectionRequest = z.infer<typeof requestCollectionCorrectionRequestSchema>;

export const decideCorrectionRequestSchema = z.object({ correctionId: z.uuid() }).strict();
export type DecideCorrectionRequest = z.infer<typeof decideCorrectionRequestSchema>;

export const rejectCorrectionRequestSchema = z
  .object({ correctionId: z.uuid(), reason: z.string().trim().min(3).max(500) })
  .strict();
export type RejectCorrectionRequest = z.infer<typeof rejectCorrectionRequestSchema>;

export const listCorrectionsRequestSchema = z
  .object({
    branchId: z.uuid().optional(),
    status: z.enum(CORRECTION_STATUSES).optional(),
    cursor: z.string().max(400).nullish(),
    limit: z.int().min(1).max(200).optional(),
  })
  .strict();

export interface CorrectionSummary {
  id: string;
  kind: CorrectionKind;
  status: CorrectionStatus;
  branchId: string;
  businessId: string;
  collectionId: string;
  collectionBatchId: string;
  collectedAt: string;
  memberId: string;
  memberName: string;
  susuAccountId: string;
  /** What the collection recorded. */
  collectedPesewas: number;
  /** What the correction takes off the collected member's account. */
  amountPesewas: number;
  toSusuAccountId: string | null;
  toMemberName: string | null;
  reason: string;
  needsHeadOffice: boolean;
  /** The maker. The UI hides Approve/Reject when this is the signed-in user — the server refuses anyway. */
  requestedBy: string;
  requestedAt: string;
  decision: { decision: 'APPROVED' | 'REJECTED'; decidedBy: string; decidedAt: string; reason: string | null; batchId: string | null } | null;
}
