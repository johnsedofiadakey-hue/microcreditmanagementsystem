import {
  CORRECTION_HEAD_OFFICE_THRESHOLD_PESEWAS,
  formatCedis,
  isHeadOffice,
  type CorrectionKind,
  type CorrectionStatus,
  type CorrectionSummary,
  type DecideCorrectionRequest,
  type RejectCorrectionRequest,
  type RequestCollectionCorrectionRequest,
  type Role,
} from '@susu/shared';
import type { Queryable } from '../db/types.js';
import { getBalance } from '../ledger/accounts.js';
import { postJournal } from '../ledger/post.js';
import { reverseJournalBatch } from '../ledger/reverse.js';
import type { Actor } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';
import { DomainError } from '../lib/errors.js';
import { requireBranch, requireRole } from '../lib/permissions.js';
import { branchScope, decodeCursor, iso, pageOf } from '../reads/scope.js';
import { cashAccount, lockBranch } from './common.js';

/** Who may ask for a correction (field and counter staff investigate; agents use the phone, not the portal). */
export const CORRECTION_MAKERS: readonly Role[] = ['SUPER_ADMIN', 'BRANCH_MANAGER', 'CASHIER', 'SUPERVISOR'];
/** Who may decide one. A branch manager only up to the threshold and only in their branch. Never the maker. */
export const CORRECTION_CHECKERS: readonly Role[] = ['SUPER_ADMIN', 'FINANCE', 'COMPLIANCE', 'BRANCH_MANAGER'];

interface CollectionRow {
  id: string;
  batch_id: string;
  branch_id: string;
  business_id: string;
  agent_pair_id: string;
  susu_account_id: string;
  amount_pesewas: number;
  member_ledger_account_id: string;
  member_name: string;
}

async function lockCollectionByBatch(tx: Queryable, batchId: string): Promise<CollectionRow> {
  const row = (
    await tx.query<CollectionRow>(
      `select c.id, c.batch_id, c.branch_id, c.business_id, c.agent_pair_id, c.susu_account_id, c.amount_pesewas,
              s.ledger_account_id as member_ledger_account_id, m.full_name as member_name
         from collections c
         join susu_accounts s on s.id = c.susu_account_id
         join members m on m.id = c.member_id
        where c.batch_id = $1
        for update of c`,
      [batchId],
    )
  ).rows[0];
  if (!row) throw new DomainError('NOT_FOUND', 'That journal entry is not a collection, so it cannot be corrected here');
  return row;
}

/** PENDING = no decision yet. */
async function correctionState(q: Queryable, collectionId: string): Promise<{ approved: boolean; pending: boolean }> {
  const row = (
    await q.query<{ approved: boolean; pending: boolean }>(
      `select
         exists (select 1 from correction_requests r join approvals a on a.subject_kind = 'CORRECTION' and a.subject_id = r.id
                  where r.collection_id = $1 and a.decision = 'APPROVED') as approved,
         exists (select 1 from correction_requests r
                  where r.collection_id = $1
                    and not exists (select 1 from approvals a where a.subject_kind = 'CORRECTION' and a.subject_id = r.id)) as pending`,
      [collectionId],
    )
  ).rows[0]!;
  return row;
}

export async function requestCollectionCorrection(
  tx: Queryable,
  actor: Actor,
  input: RequestCollectionCorrectionRequest,
): Promise<{ correctionId: string; needsHeadOffice: boolean }> {
  requireRole(actor, CORRECTION_MAKERS);
  const collection = await lockCollectionByBatch(tx, input.collectionBatchId);
  requireBranch(actor, collection.branch_id);

  const state = await correctionState(tx, collection.id);
  if (state.approved) throw new DomainError('CONFLICT', 'This collection has already been corrected');
  if (state.pending) throw new DomainError('CONFLICT', 'A correction for this collection is already waiting for a decision');

  let amount = collection.amount_pesewas;
  if (input.kind === 'REDUCE_COLLECTION') {
    const correct = input.correctPesewas!;
    if (correct >= collection.amount_pesewas) {
      throw new DomainError('INVALID_COMMAND', `The correct amount must be less than the ${formatCedis(collection.amount_pesewas)} recorded`);
    }
    amount = collection.amount_pesewas - correct;
  }

  if (input.kind === 'MOVE_COLLECTION') {
    const target = (
      await tx.query<{ branch_id: string; status: string; member_status: string; business_id: string }>(
        `select s.branch_id, s.status, m.status as member_status, p.business_id
           from susu_accounts s join members m on m.id = s.member_id join susu_products p on p.id = s.product_id
          where s.id = $1`,
        [input.toSusuAccountId],
      )
    ).rows[0];
    if (!target) throw new DomainError('ACCOUNT_NOT_FOUND', 'The account to move the collection to was not found');
    if (input.toSusuAccountId === collection.susu_account_id) {
      throw new DomainError('INVALID_COMMAND', 'Choose a different member’s account to move the collection to');
    }
    if (target.branch_id !== collection.branch_id || target.business_id !== collection.business_id) {
      throw new DomainError('INVALID_COMMAND', 'A collection can only move to an account of the same branch and business');
    }
    if (target.member_status !== 'ACTIVE' || target.status !== 'ACTIVE') {
      throw new DomainError('ACCOUNT_NOT_ACTIVE', 'The account to move the collection to is not active');
    }
  }

  const needsHeadOffice = amount > CORRECTION_HEAD_OFFICE_THRESHOLD_PESEWAS;
  const correctionId = (
    await tx.query<{ id: string }>(
      `insert into correction_requests (kind, collection_id, branch_id, business_id, amount_pesewas, to_susu_account_id, reason, needs_head_office, requested_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9) returning id`,
      [input.kind, collection.id, collection.branch_id, collection.business_id, amount, input.toSusuAccountId ?? null, input.reason, needsHeadOffice, actor.uid],
    )
  ).rows[0]!.id;

  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'correction.requested',
    entityKind: 'correction',
    entityId: correctionId,
    branchId: collection.branch_id,
    channel: actor.channel,
    data: { kind: input.kind, collectionId: collection.id, amountPesewas: amount, toSusuAccountId: input.toSusuAccountId ?? null, reason: input.reason },
  });
  return { correctionId, needsHeadOffice };
}

interface PendingCorrection {
  id: string;
  kind: CorrectionKind;
  collection_id: string;
  branch_id: string;
  business_id: string;
  amount_pesewas: number;
  to_susu_account_id: string | null;
  reason: string;
  needs_head_office: boolean;
  requested_by: string;
}

async function lockPending(tx: Queryable, correctionId: string): Promise<PendingCorrection> {
  const row = (
    await tx.query<PendingCorrection>(
      `select id, kind, collection_id, branch_id, business_id, amount_pesewas, to_susu_account_id, reason, needs_head_office, requested_by
         from correction_requests where id = $1 for update`,
      [correctionId],
    )
  ).rows[0];
  if (!row) throw new DomainError('NOT_FOUND', 'Correction not found');
  const decided = await tx.query(`select 1 from approvals where subject_kind = 'CORRECTION' and subject_id = $1`, [correctionId]);
  if (decided.rowCount > 0) throw new DomainError('CONFLICT', 'This correction has already been decided');
  return row;
}

function assertChecker(actor: Actor, request: PendingCorrection, approving: boolean): void {
  requireRole(actor, CORRECTION_CHECKERS);
  requireBranch(actor, request.branch_id);
  if (actor.uid === request.requested_by) {
    throw new DomainError('SELF_APPROVAL_FORBIDDEN', 'You requested this correction, so someone else must decide it');
  }
  if (approving && request.needs_head_office && !isHeadOffice(actor.claims.role)) {
    throw new DomainError(
      'APPROVAL_LIMIT_EXCEEDED',
      `Corrections above ${formatCedis(CORRECTION_HEAD_OFFICE_THRESHOLD_PESEWAS)} need head-office approval`,
    );
  }
}

/** Approve and post, in one transaction: the batch names the requester as actor and the approver as approver. */
export async function approveCorrection(tx: Queryable, actor: Actor, input: DecideCorrectionRequest): Promise<{ batchId: string }> {
  const request = await lockPending(tx, input.correctionId);
  assertChecker(actor, request, true);
  await lockBranch(tx, request.branch_id);

  const collection = (
    await tx.query<CollectionRow>(
      `select c.id, c.batch_id, c.branch_id, c.business_id, c.agent_pair_id, c.susu_account_id, c.amount_pesewas,
              s.ledger_account_id as member_ledger_account_id, m.full_name as member_name
         from collections c join susu_accounts s on s.id = c.susu_account_id join members m on m.id = c.member_id
        where c.id = $1 for update of c`,
      [request.collection_id],
    )
  ).rows[0]!;
  const memberBalance = await getBalance(tx, collection.member_ledger_account_id);
  if (memberBalance < request.amount_pesewas) {
    throw new DomainError(
      'INSUFFICIENT_BALANCE',
      `${collection.member_name}'s account holds ${formatCedis(memberBalance)}, less than the ${formatCedis(request.amount_pesewas)} to correct — money has been withdrawn since`,
    );
  }

  const label = `Correction ${request.id.slice(0, 8)}: ${request.reason}`;
  let batchId: string;
  if (request.kind === 'MOVE_COLLECTION') {
    const target = (
      await tx.query<{ ledger_account_id: string }>('select ledger_account_id from susu_accounts where id = $1', [request.to_susu_account_id])
    ).rows[0]!;
    batchId = (
      await postJournal(tx, {
        idempotencyKey: `correction:${request.id}`,
        kind: 'CORRECTION:MOVE_COLLECTION',
        description: label,
        branchId: request.branch_id,
        actorUid: request.requested_by,
        approvedBy: actor.uid,
        channel: actor.channel,
        lines: [
          { accountId: collection.member_ledger_account_id, side: 'DEBIT', amountPesewas: request.amount_pesewas },
          { accountId: target.ledger_account_id, side: 'CREDIT', amountPesewas: request.amount_pesewas },
        ],
      })
    ).batchId;
  } else {
    // REVERSE and REDUCE take cash back off the pair: it must still hold it.
    const custodyId = await cashAccount(tx, 'AGENT_CASH_CUSTODY', collection.agent_pair_id, collection.business_id);
    const custody = await getBalance(tx, custodyId);
    if (custody < request.amount_pesewas) {
      throw new DomainError(
        'INSUFFICIENT_BALANCE',
        `The agent pair holds ${formatCedis(custody)}, less than the ${formatCedis(request.amount_pesewas)} to correct — the cash has been handed over. Record the shortage through the handover difference instead.`,
      );
    }
    batchId =
      request.kind === 'REVERSE_COLLECTION'
        ? (
            await reverseJournalBatch(tx, {
              batchId: collection.batch_id,
              idempotencyKey: `correction:${request.id}`,
              reason: label,
              requestedBy: request.requested_by,
              approvedBy: actor.uid,
              channel: actor.channel,
            })
          ).batchId
        : (
            await postJournal(tx, {
              idempotencyKey: `correction:${request.id}`,
              kind: 'CORRECTION:REDUCE_COLLECTION',
              description: label,
              branchId: request.branch_id,
              actorUid: request.requested_by,
              approvedBy: actor.uid,
              channel: actor.channel,
              lines: [
                { accountId: collection.member_ledger_account_id, side: 'DEBIT', amountPesewas: request.amount_pesewas },
                { accountId: custodyId, side: 'CREDIT', amountPesewas: request.amount_pesewas },
              ],
            })
          ).batchId;
  }

  await tx.query(
    `insert into approvals (subject_kind, subject_id, decision, decided_by, batch_id) values ('CORRECTION', $1, 'APPROVED', $2, $3)`,
    [request.id, actor.uid, batchId],
  );
  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'correction.approved',
    entityKind: 'correction',
    entityId: request.id,
    branchId: request.branch_id,
    channel: actor.channel,
    data: { kind: request.kind, amountPesewas: request.amount_pesewas, batchId, requestedBy: request.requested_by },
  });
  return { batchId };
}

export async function rejectCorrection(tx: Queryable, actor: Actor, input: RejectCorrectionRequest): Promise<void> {
  const request = await lockPending(tx, input.correctionId);
  assertChecker(actor, request, false);
  await tx.query(
    `insert into approvals (subject_kind, subject_id, decision, decided_by, reason) values ('CORRECTION', $1, 'REJECTED', $2, $3)`,
    [request.id, actor.uid, input.reason],
  );
  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'correction.rejected',
    entityKind: 'correction',
    entityId: request.id,
    branchId: request.branch_id,
    channel: actor.channel,
    data: { reason: input.reason },
  });
}

/** Newest first, scoped to the caller's branches. */
export async function listCorrections(
  q: Queryable,
  actor: Actor,
  input: { branchId?: string; status?: CorrectionStatus; cursor?: string | null; limit?: number },
): Promise<{ corrections: CorrectionSummary[]; nextCursor: string | null }> {
  const scope = branchScope(actor, input.branchId, [...new Set([...CORRECTION_MAKERS, ...CORRECTION_CHECKERS])]);
  const limit = input.limit ?? 50;
  const after = decodeCursor(input.cursor);
  const rows = await q.query<{
    id: string;
    kind: CorrectionKind;
    branch_id: string;
    business_id: string;
    collection_id: string;
    batch_id: string;
    collected_at: Date;
    member_id: string;
    member_name: string;
    susu_account_id: string;
    collected: number;
    amount_pesewas: number;
    to_susu_account_id: string | null;
    to_member_name: string | null;
    reason: string;
    needs_head_office: boolean;
    requested_by: string;
    requested_at: Date;
    decision: 'APPROVED' | 'REJECTED' | null;
    decided_by: string | null;
    decided_at: Date | null;
    decision_reason: string | null;
    decision_batch_id: string | null;
  }>(
    `select r.id, r.kind, r.branch_id, r.business_id, r.collection_id, c.batch_id, c.posted_at as collected_at,
            c.member_id, m.full_name as member_name, c.susu_account_id, c.amount_pesewas as collected, r.amount_pesewas,
            r.to_susu_account_id, tm.full_name as to_member_name, r.reason, r.needs_head_office, r.requested_by, r.requested_at,
            a.decision, a.decided_by, a.decided_at, a.reason as decision_reason, a.batch_id as decision_batch_id
       from correction_requests r
       join collections c on c.id = r.collection_id
       join members m on m.id = c.member_id
       left join susu_accounts ts on ts.id = r.to_susu_account_id
       left join members tm on tm.id = ts.member_id
       left join approvals a on a.subject_kind = 'CORRECTION' and a.subject_id = r.id
      where ($1::uuid[] is null or r.branch_id = any($1::uuid[]))
        and ($2::text is null or coalesce(a.decision, 'PENDING') = $2)
        and ($3::timestamptz is null or (r.requested_at, r.id) < ($3::timestamptz, $4::uuid))
      order by r.requested_at desc, r.id desc
      limit $5`,
    [scope, input.status ?? null, after?.k ?? null, after?.id ?? null, limit + 1],
  );
  const page = pageOf(rows.rows, limit, (r) => ({ k: iso(r.requested_at)!, id: r.id }));
  return {
    nextCursor: page.nextCursor,
    corrections: page.items.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.decision ?? 'PENDING',
      branchId: r.branch_id,
      businessId: r.business_id,
      collectionId: r.collection_id,
      collectionBatchId: r.batch_id,
      collectedAt: iso(r.collected_at)!,
      memberId: r.member_id,
      memberName: r.member_name,
      susuAccountId: r.susu_account_id,
      collectedPesewas: r.collected,
      amountPesewas: r.amount_pesewas,
      toSusuAccountId: r.to_susu_account_id,
      toMemberName: r.to_member_name,
      reason: r.reason,
      needsHeadOffice: r.needs_head_office,
      requestedBy: r.requested_by,
      requestedAt: iso(r.requested_at)!,
      decision: r.decision
        ? { decision: r.decision, decidedBy: r.decided_by!, decidedAt: iso(r.decided_at)!, reason: r.decision_reason, batchId: r.decision_batch_id }
        : null,
    })),
  };
}
