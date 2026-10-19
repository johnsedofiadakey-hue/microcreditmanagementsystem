import type { BranchCloseChecklist, CaseKind, CaseSummary, HandoverSummary, WithdrawalStatus, WithdrawalSummary } from '@susu/shared';
import type { Queryable } from '../db/types.js';
import type { Actor } from '../lib/actor.js';
import { requireBranch, requireRole } from '../lib/permissions.js';
import { STAFF_READERS, branchScope } from '../reads/scope.js';
import { branchCloseChecklist } from './close.js';

const LIMIT = 200;
const iso = (d: Date | string | null): string | null => (d ? new Date(d).toISOString() : null);

/** Newest first, scoped to the caller's branches (head office: all, or the one asked for). */
export async function listHandovers(q: Queryable, actor: Actor, input: { branchId?: string; day?: string }): Promise<{ handovers: HandoverSummary[] }> {
  const scope = branchScope(actor, input.branchId);
  const rows = await q.query<{
    id: string;
    branch_id: string;
    agent_pair_id: string;
    agent_pair_name: string;
    day: string;
    expected_pesewas: number;
    counted_pesewas: number;
    received_by: string;
    received_at: Date;
    note: string | null;
    case_id: string | null;
    batch_id: string;
  }>(
    `select h.id, h.branch_id, h.agent_pair_id, p.name as agent_pair_name, to_char(h.day, 'YYYY-MM-DD') as day,
            h.expected_pesewas, h.counted_pesewas, h.received_by, h.received_at, h.note, h.case_id, h.batch_id
       from handovers h join agent_pairs p on p.id = h.agent_pair_id
      where ($1::uuid[] is null or h.branch_id = any($1::uuid[])) and ($2::date is null or h.day = $2::date)
      order by h.received_at desc, h.id desc limit ${LIMIT}`,
    [scope, input.day ?? null],
  );
  return {
    handovers: rows.rows.map((r) => ({
      id: r.id,
      branchId: r.branch_id,
      agentPairId: r.agent_pair_id,
      agentPairName: r.agent_pair_name,
      day: r.day,
      expectedPesewas: r.expected_pesewas,
      countedPesewas: r.counted_pesewas,
      differencePesewas: r.counted_pesewas - r.expected_pesewas,
      receivedBy: r.received_by,
      receivedAt: iso(r.received_at)!,
      note: r.note,
      caseId: r.case_id,
      batchId: r.batch_id,
    })),
  };
}

export async function listWithdrawals(
  q: Queryable,
  actor: Actor,
  input: { branchId?: string; status?: WithdrawalStatus },
): Promise<{ withdrawals: WithdrawalSummary[] }> {
  const scope = branchScope(actor, input.branchId);
  const rows = await q.query<{
    id: string;
    branch_id: string;
    member_id: string;
    member_name: string;
    susu_account_id: string;
    amount_pesewas: number;
    reason: string;
    status: WithdrawalStatus;
    needs_head_office: boolean;
    requested_by: string;
    requested_at: Date;
    decided_by: string | null;
    decided_at: Date | null;
    reject_reason: string | null;
    paid_by: string | null;
    paid_at: Date | null;
    batch_id: string | null;
  }>(
    `select w.*, m.full_name as member_name
       from withdrawal_requests w join members m on m.id = w.member_id
      where ($1::uuid[] is null or w.branch_id = any($1::uuid[])) and ($2::text is null or w.status = $2)
      order by w.requested_at desc, w.id desc limit ${LIMIT}`,
    [scope, input.status ?? null],
  );
  return {
    withdrawals: rows.rows.map((r) => ({
      id: r.id,
      branchId: r.branch_id,
      memberId: r.member_id,
      memberName: r.member_name,
      susuAccountId: r.susu_account_id,
      amountPesewas: r.amount_pesewas,
      reason: r.reason,
      status: r.status,
      needsHeadOffice: r.needs_head_office,
      requestedBy: r.requested_by,
      requestedAt: iso(r.requested_at)!,
      decidedBy: r.decided_by,
      decidedAt: iso(r.decided_at),
      rejectReason: r.reject_reason,
      paidBy: r.paid_by,
      paidAt: iso(r.paid_at),
      batchId: r.batch_id,
    })),
  };
}

export async function listCases(q: Queryable, actor: Actor, input: { branchId?: string; status?: 'OPEN' | 'RESOLVED' }): Promise<{ cases: CaseSummary[] }> {
  const scope = branchScope(actor, input.branchId);
  const rows = await q.query<{
    id: string;
    branch_id: string;
    kind: CaseKind;
    status: 'OPEN' | 'RESOLVED';
    amount_pesewas: number;
    summary: string;
    entity_kind: string;
    entity_id: string;
    opened_by: string;
    opened_at: Date;
    resolved_by: string | null;
    resolved_at: Date | null;
    resolution: string | null;
  }>(
    `select * from cases
      where ($1::uuid[] is null or branch_id = any($1::uuid[])) and ($2::text is null or status = $2)
      order by opened_at desc, id desc limit ${LIMIT}`,
    [scope, input.status ?? null],
  );
  return {
    cases: rows.rows.map((r) => ({
      id: r.id,
      branchId: r.branch_id,
      kind: r.kind,
      status: r.status,
      amountPesewas: r.amount_pesewas,
      summary: r.summary,
      entityKind: r.entity_kind,
      entityId: r.entity_id,
      openedBy: r.opened_by,
      openedAt: iso(r.opened_at)!,
      resolvedBy: r.resolved_by,
      resolvedAt: iso(r.resolved_at),
      resolution: r.resolution,
    })),
  };
}

export async function getBranchClose(q: Queryable, actor: Actor, input: { branchId: string; day: string }): Promise<BranchCloseChecklist> {
  requireRole(actor, STAFF_READERS);
  requireBranch(actor, input.branchId);
  return branchCloseChecklist(q, input.branchId, input.day);
}
