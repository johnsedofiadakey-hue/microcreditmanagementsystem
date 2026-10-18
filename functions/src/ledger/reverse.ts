import type { Channel } from '@susu/shared';
import type { Queryable } from '../db/types.js';
import { DomainError } from '../lib/errors.js';
import { postJournal, type PostingResult, type Side } from './post.js';

export interface ReversalRequest {
  batchId: string;
  idempotencyKey: string;
  reason: string;
  requestedBy: string;
  approvedBy: string;
  channel: Channel;
}

/**
 * Post an equal and opposite batch. The original stays untouched. A batch can be reversed once
 * (database-enforced); a reversal itself cannot be reversed — post a fresh corrected batch instead.
 */
export async function reverseJournalBatch(tx: Queryable, request: ReversalRequest): Promise<PostingResult> {
  if (request.requestedBy === request.approvedBy) {
    throw new DomainError('SELF_APPROVAL_FORBIDDEN', 'A reversal must be approved by a different person');
  }
  if (request.reason.trim().length < 3) {
    throw new DomainError('INVALID_COMMAND', 'A reversal needs a reason');
  }

  const original = await tx.query<{ id: string; kind: string; branch_id: string | null; reverses_batch_id: string | null }>(
    'select id, kind, branch_id, reverses_batch_id from journal_batches where id = $1',
    [request.batchId],
  );
  const batch = original.rows[0];
  if (!batch) throw new DomainError('NOT_FOUND', `Journal batch ${request.batchId} not found`);
  if (batch.reverses_batch_id) {
    throw new DomainError('INVALID_COMMAND', 'A reversal cannot itself be reversed; post a correcting batch');
  }

  const already = await tx.query<{ id: string; idempotency_key: string }>(
    'select id, idempotency_key from journal_batches where reverses_batch_id = $1',
    [request.batchId],
  );
  if (already.rows[0] && already.rows[0].idempotency_key !== request.idempotencyKey) {
    throw new DomainError('ALREADY_REVERSED', 'This batch has already been reversed', {
      reversalBatchId: already.rows[0].id,
    });
  }

  const lines = await tx.query<{ account_id: string; side: Side; amount_pesewas: number }>(
    'select account_id, side, amount_pesewas from journal_lines where batch_id = $1 order by id',
    [request.batchId],
  );

  return postJournal(tx, {
    idempotencyKey: request.idempotencyKey,
    kind: `REVERSAL:${batch.kind}`,
    description: `Reversal of ${batch.id}: ${request.reason.trim()}`,
    branchId: batch.branch_id,
    actorUid: request.requestedBy,
    approvedBy: request.approvedBy,
    channel: request.channel,
    reversesBatchId: batch.id,
    lines: lines.rows.map((line) => ({
      accountId: line.account_id,
      side: line.side === 'DEBIT' ? 'CREDIT' : 'DEBIT',
      amountPesewas: line.amount_pesewas,
    })),
  });
}
