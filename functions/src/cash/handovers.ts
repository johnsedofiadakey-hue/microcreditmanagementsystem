import { formatCedis, type HandoverResult, type RecordHandoverRequest, type Role } from '@susu/shared';
import type { Queryable } from '../db/types.js';
import { postJournal, type PostingLine } from '../ledger/post.js';
import type { Actor } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';
import { DomainError } from '../lib/errors.js';
import { requireBranch, requireRole } from '../lib/permissions.js';
import { assertDayOpen, describeDifference, lockBranch, lockedBalance, newId, openCase, requireLedgerAccount, today } from './common.js';

/** Who receives cash from agents. */
export const HANDOVER_RECEIVERS: readonly Role[] = ['CASHIER', 'BRANCH_MANAGER'];

/**
 * The cashier counts an agent pair's cash. One balanced batch moves it out of the pair's custody into
 * branch cash; any difference goes to BRANCH_CASH_VARIANCE and opens a case:
 *
 *   Debit  BRANCH_CASH            counted
 *   Credit AGENT_CASH_CUSTODY     expected (everything posted and not yet handed over)
 *   Debit  BRANCH_CASH_VARIANCE   shortage   | or Credit for an overage
 *
 * `expectedPesewas` is what the cashier saw; if more collections posted while they counted, the
 * handover is refused (EXPECTED_CASH_CHANGED) so they count against the right figure.
 */
export async function recordHandover(
  tx: Queryable,
  actor: Actor,
  input: RecordHandoverRequest,
  now: Date = new Date(),
): Promise<HandoverResult> {
  requireRole(actor, HANDOVER_RECEIVERS);
  const pair = (
    await tx.query<{ branch_id: string; name: string }>('select branch_id, name from agent_pairs where id = $1', [input.agentPairId])
  ).rows[0];
  if (!pair) throw new DomainError('NOT_FOUND', 'Agent pair not found');
  requireBranch(actor, pair.branch_id);

  await lockBranch(tx, pair.branch_id);
  const day = today(now);
  await assertDayOpen(tx, pair.branch_id, day);

  const custodyId = await requireLedgerAccount(tx, 'AGENT_CASH_CUSTODY', input.agentPairId);
  const branchCashId = await requireLedgerAccount(tx, 'BRANCH_CASH', pair.branch_id);
  const varianceId = await requireLedgerAccount(tx, 'BRANCH_CASH_VARIANCE', pair.branch_id);

  const expected = await lockedBalance(tx, custodyId);
  if (expected !== input.expectedPesewas) {
    throw new DomainError('EXPECTED_CASH_CHANGED', `Expected cash is now ${formatCedis(expected)}`, { expectedPesewas: expected });
  }
  if (expected === 0 && input.countedPesewas === 0) {
    throw new DomainError('INVALID_COMMAND', 'This pair has no cash to hand over');
  }

  const counted = input.countedPesewas;
  const difference = counted - expected;
  const lines: PostingLine[] = [];
  if (counted > 0) lines.push({ accountId: branchCashId, side: 'DEBIT', amountPesewas: counted });
  if (expected > 0) lines.push({ accountId: custodyId, side: 'CREDIT', amountPesewas: expected });
  if (difference < 0) lines.push({ accountId: varianceId, side: 'DEBIT', amountPesewas: -difference });
  if (difference > 0) lines.push({ accountId: varianceId, side: 'CREDIT', amountPesewas: difference });

  const handoverId = await newId(tx);
  const posting = await postJournal(tx, {
    idempotencyKey: `handover:${handoverId}`,
    kind: 'CASH_HANDOVER',
    description: `Cash handover from ${pair.name}`,
    branchId: pair.branch_id,
    actorUid: actor.uid,
    channel: actor.channel,
    lines,
  });

  const caseId =
    difference === 0
      ? null
      : await openCase(tx, {
          branchId: pair.branch_id,
          kind: 'HANDOVER_DIFFERENCE',
          amountPesewas: difference,
          summary: `Handover from ${pair.name}: ${describeDifference(difference)} (expected ${formatCedis(expected)}, counted ${formatCedis(counted)})`,
          entityKind: 'handover',
          entityId: handoverId,
          openedBy: actor.uid,
        });

  await tx.query(
    `insert into handovers (id, branch_id, agent_pair_id, day, expected_pesewas, counted_pesewas, received_by, note, case_id, batch_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [handoverId, pair.branch_id, input.agentPairId, day, expected, counted, actor.uid, input.note ?? null, caseId, posting.batchId],
  );
  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'handover.recorded',
    entityKind: 'handover',
    entityId: handoverId,
    branchId: pair.branch_id,
    channel: actor.channel,
    data: { agentPairId: input.agentPairId, expectedPesewas: expected, countedPesewas: counted, differencePesewas: difference, caseId },
  });
  return { handoverId, differencePesewas: difference, caseId };
}
