import {
  formatCedis,
  type ConfirmHandoverRequest,
  type HandoverDeclarationCommand,
  type HandoverDeclarationSummary,
  type HandoverResult,
  type Role,
} from '@susu/shared';
import type { Queryable } from '../db/types.js';
import { findLedgerAccountId, getBalance } from '../ledger/accounts.js';
import { postJournal, type PostingLine } from '../ledger/post.js';
import type { Actor } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';
import { DomainError } from '../lib/errors.js';
import { requireBranch, requireRole } from '../lib/permissions.js';
import type { BoundDevice } from '../org/devices.js';
import { branchScope, decodeCursor, pageOf } from '../reads/scope.js';
import { assertDayOpen, cashAccount, describeDifference, lockBranch, lockedBalance, newId, openCase, requireBusiness, today } from './common.js';

/** Who counts and confirms an agent pair's declared cash. Never one of the pair's own agents. */
export const HANDOVER_RECEIVERS: readonly Role[] = ['CASHIER', 'BRANCH_MANAGER'];

const iso = (d: Date | string | null): string | null => (d ? new Date(d).toISOString() : null);

/**
 * Step 1 of 2 (audit H3): the agent pair declares, from a bound phone and signed with its key, how much
 * of each business's cash it is handing over. Recorded as immutable evidence together with each
 * business's custody at that moment; moves no money. A newer declaration from the same pair replaces
 * any of its lines still waiting for a cashier (they become SUPERSEDED, never deleted).
 * Runs inside the command transaction, after the signature and device checks.
 */
export async function recordHandoverDeclaration(
  tx: Queryable,
  commandId: string,
  command: HandoverDeclarationCommand,
  device: BoundDevice,
): Promise<{ declarationId: string }> {
  for (const line of command.payload.lines) await requireBusiness(tx, line.businessId);

  await tx.query(
    `insert into handover_declarations (id, branch_id, agent_pair_id, agent_uid, device_id, captured_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [commandId, device.branchId, device.agentPairId, device.agentUid, device.id, command.capturedAt],
  );
  for (const line of command.payload.lines) {
    await tx.query(
      `update handover_declaration_lines l set status = 'SUPERSEDED', closed_at = now()
         from handover_declarations d
        where d.id = l.declaration_id and d.agent_pair_id = $1 and l.business_id = $2 and l.status = 'DECLARED'`,
      [device.agentPairId, line.businessId],
    );
    const custodyId = await findLedgerAccountId(tx, 'AGENT_CASH_CUSTODY', device.agentPairId, line.businessId);
    const custody = custodyId ? await getBalance(tx, custodyId) : 0;
    await tx.query(
      `insert into handover_declaration_lines (declaration_id, business_id, declared_pesewas, custody_at_declaration)
       values ($1, $2, $3, $4)`,
      [commandId, line.businessId, line.declaredPesewas, custody],
    );
  }
  await writeAudit(tx, {
    actorUid: device.agentUid,
    action: 'handover.declared',
    entityKind: 'handover_declaration',
    entityId: commandId,
    branchId: device.branchId,
    deviceId: device.id,
    channel: 'AGENT_APP',
    data: { agentPairId: device.agentPairId, lines: command.payload.lines },
  });
  return { declarationId: commandId };
}

/**
 * Step 2 of 2: a cashier (not one of the pair's agents) counts one business line of a declaration.
 * One balanced batch in that business moves the custody into the vault, with the cashier as actor and
 * the declaring agent as the batch's second party (approved_by):
 *
 *   Debit  BRANCH_CASH            counted
 *   Credit AGENT_CASH_CUSTODY     expected (the pair's whole custody for this business)
 *   Debit/Credit BRANCH_CASH_VARIANCE   counted − expected
 *
 * A difference from custody (HANDOVER_DIFFERENCE) or from the agents' declaration (HANDOVER_DISPUTE)
 * opens a case. Each line confirms once; a replayed or superseded line is refused with CONFLICT.
 */
export async function confirmHandover(
  tx: Queryable,
  actor: Actor,
  input: ConfirmHandoverRequest,
  now: Date = new Date(),
): Promise<HandoverResult> {
  requireRole(actor, HANDOVER_RECEIVERS);
  const line = (
    await tx.query<{
      branch_id: string;
      agent_pair_id: string;
      pair_name: string;
      agent_a_uid: string;
      agent_b_uid: string;
      declaring_agent: string;
      declared_pesewas: number;
      status: string;
    }>(
      `select d.branch_id, d.agent_pair_id, p.name as pair_name, p.agent_a_uid, p.agent_b_uid, d.agent_uid as declaring_agent,
              l.declared_pesewas, l.status
         from handover_declaration_lines l
         join handover_declarations d on d.id = l.declaration_id
         join agent_pairs p on p.id = d.agent_pair_id
        where l.declaration_id = $1 and l.business_id = $2
        for update of l`,
      [input.declarationId, input.businessId],
    )
  ).rows[0];
  if (!line) throw new DomainError('NOT_FOUND', 'No such declaration line for this business');
  requireBranch(actor, line.branch_id);
  if (actor.uid === line.agent_a_uid || actor.uid === line.agent_b_uid) {
    throw new DomainError('SELF_APPROVAL_FORBIDDEN', 'An agent of the pair cannot receive their own cash');
  }
  if (line.status !== 'DECLARED') {
    throw new DomainError('CONFLICT', line.status === 'CONFIRMED' ? 'This line is already confirmed' : 'The agents replaced this declaration with a newer one');
  }
  const business = await requireBusiness(tx, input.businessId);

  await lockBranch(tx, line.branch_id);
  const day = today(now);
  await assertDayOpen(tx, line.branch_id, business.id, day);

  const custodyId = await cashAccount(tx, 'AGENT_CASH_CUSTODY', line.agent_pair_id, business.id);
  const branchCashId = await cashAccount(tx, 'BRANCH_CASH', line.branch_id, business.id);
  const varianceId = await cashAccount(tx, 'BRANCH_CASH_VARIANCE', line.branch_id, business.id);

  const expected = await lockedBalance(tx, custodyId);
  if (expected !== input.expectedPesewas) {
    throw new DomainError('EXPECTED_CASH_CHANGED', `Expected cash is now ${formatCedis(expected)}`, { expectedPesewas: expected });
  }
  const counted = input.countedPesewas;
  const declared = line.declared_pesewas;
  if (expected === 0 && counted === 0) {
    throw new DomainError('INVALID_COMMAND', `This pair has no ${business.name} cash to hand over`);
  }

  const difference = counted - expected;
  const declarationDifference = counted - declared;
  const lines: PostingLine[] = [];
  if (counted > 0) lines.push({ accountId: branchCashId, side: 'DEBIT', amountPesewas: counted });
  if (expected > 0) lines.push({ accountId: custodyId, side: 'CREDIT', amountPesewas: expected });
  if (difference < 0) lines.push({ accountId: varianceId, side: 'DEBIT', amountPesewas: -difference });
  if (difference > 0) lines.push({ accountId: varianceId, side: 'CREDIT', amountPesewas: difference });

  const handoverId = await newId(tx);
  const posting = await postJournal(tx, {
    idempotencyKey: `handover:${input.declarationId}:${business.id}`,
    kind: 'CASH_HANDOVER',
    description: `Cash handover from ${line.pair_name} · ${business.code}`,
    branchId: line.branch_id,
    actorUid: actor.uid,
    // The declaring agent is the transfer's other party; the database requires the two to differ.
    approvedBy: line.declaring_agent,
    channel: actor.channel,
    lines,
  });

  let caseId: string | null = null;
  if (difference !== 0 || declarationDifference !== 0) {
    const parts = [`expected ${formatCedis(expected)}`, `declared ${formatCedis(declared)}`, `counted ${formatCedis(counted)}`];
    caseId = await openCase(tx, {
      branchId: line.branch_id,
      businessId: business.id,
      kind: difference !== 0 ? 'HANDOVER_DIFFERENCE' : 'HANDOVER_DISPUTE',
      amountPesewas: difference !== 0 ? difference : declarationDifference,
      summary:
        difference !== 0
          ? `${business.code} handover from ${line.pair_name}: ${describeDifference(difference)} (${parts.join(', ')})`
          : `${business.code} handover from ${line.pair_name}: the agents declared ${formatCedis(declared)} but ${formatCedis(counted)} was counted (${parts.join(', ')})`,
      entityKind: 'handover',
      entityId: handoverId,
      openedBy: actor.uid,
    });
  }

  await tx.query(
    `update handover_declaration_lines set status = 'CONFIRMED', handover_id = $3, closed_at = now()
      where declaration_id = $1 and business_id = $2`,
    [input.declarationId, business.id, handoverId],
  );
  await tx.query(
    `insert into handovers (id, branch_id, business_id, agent_pair_id, day, expected_pesewas, counted_pesewas, received_by, note, case_id, batch_id,
                            declaration_id, declared_pesewas)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      handoverId,
      line.branch_id,
      business.id,
      line.agent_pair_id,
      day,
      expected,
      counted,
      actor.uid,
      input.note ?? null,
      caseId,
      posting.batchId,
      input.declarationId,
      declared,
    ],
  );
  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'handover.confirmed',
    entityKind: 'handover',
    entityId: handoverId,
    branchId: line.branch_id,
    channel: actor.channel,
    data: {
      declarationId: input.declarationId,
      agentPairId: line.agent_pair_id,
      businessId: business.id,
      expectedPesewas: expected,
      declaredPesewas: declared,
      countedPesewas: counted,
      differencePesewas: difference,
      caseId,
    },
  });
  return { handoverId, differencePesewas: difference, declarationDifferencePesewas: declarationDifference, caseId };
}

interface DeclarationRow {
  id: string;
  branch_id: string;
  agent_pair_id: string;
  agent_pair_name: string;
  agent_uid: string;
  device_id: string;
  captured_at: Date;
  received_at: Date;
}

/** Declarations newest first (OPEN: with at least one line waiting for a cashier). Cursor-paged. */
export async function listHandoverDeclarations(
  q: Queryable,
  actor: Actor,
  input: { branchId?: string; status?: 'OPEN' | 'ALL'; cursor?: string | null; limit?: number },
): Promise<{ declarations: HandoverDeclarationSummary[]; nextCursor: string | null }> {
  const scope = branchScope(actor, input.branchId);
  const limit = input.limit ?? 50;
  const after = decodeCursor(input.cursor);
  const rows = await q.query<DeclarationRow>(
    `select d.id, d.branch_id, d.agent_pair_id, p.name as agent_pair_name, d.agent_uid, d.device_id, d.captured_at, d.received_at
       from handover_declarations d join agent_pairs p on p.id = d.agent_pair_id
      where ($1::uuid[] is null or d.branch_id = any($1::uuid[]))
        and ($2::text = 'ALL' or exists (select 1 from handover_declaration_lines l where l.declaration_id = d.id and l.status = 'DECLARED'))
        and ($3::timestamptz is null or (d.received_at, d.id) < ($3::timestamptz, $4::uuid))
      order by d.received_at desc, d.id desc
      limit $5`,
    [scope, input.status ?? 'OPEN', after?.k ?? null, after?.id ?? null, limit + 1],
  );
  const page = pageOf(rows.rows, limit, (r) => ({ k: new Date(r.received_at).toISOString(), id: r.id }));
  const declarations: HandoverDeclarationSummary[] = [];
  for (const d of page.items) declarations.push(await describeDeclaration(q, d));
  return { declarations, nextCursor: page.nextCursor };
}

async function describeDeclaration(q: Queryable, d: DeclarationRow): Promise<HandoverDeclarationSummary> {
  const lines = await q.query<{
    business_id: string;
    business_name: string;
    declared_pesewas: number;
    custody_at_declaration: number;
    status: 'DECLARED' | 'CONFIRMED' | 'SUPERSEDED';
    handover_id: string | null;
    counted_pesewas: number | null;
    received_by: string | null;
    received_at: Date | null;
    current_custody: number | null;
  }>(
    `select l.business_id, b.name as business_name, l.declared_pesewas, l.custody_at_declaration, l.status, l.handover_id,
            h.counted_pesewas, h.received_by, h.received_at,
            case when l.status = 'DECLARED' then coalesce(bal.balance_pesewas, 0) end as current_custody
       from handover_declaration_lines l
       join businesses b on b.id = l.business_id
       left join handovers h on h.id = l.handover_id
       left join ledger_accounts la on la.kind = 'AGENT_CASH_CUSTODY' and la.owner_id = $2 and la.business_id = l.business_id
       left join account_balances bal on bal.account_id = la.id
      where l.declaration_id = $1
      order by b.code`,
    [d.id, d.agent_pair_id],
  );
  return {
    id: d.id,
    branchId: d.branch_id,
    agentPairId: d.agent_pair_id,
    agentPairName: d.agent_pair_name,
    agentUid: d.agent_uid,
    deviceId: d.device_id,
    capturedAt: iso(d.captured_at)!,
    receivedAt: iso(d.received_at)!,
    lines: lines.rows.map((l) => ({
      businessId: l.business_id,
      businessName: l.business_name,
      declaredPesewas: l.declared_pesewas,
      custodyAtDeclarationPesewas: l.custody_at_declaration,
      currentCustodyPesewas: l.current_custody,
      status: l.status,
      handoverId: l.handover_id,
      countedPesewas: l.counted_pesewas,
      confirmedBy: l.received_by,
      confirmedAt: iso(l.received_at),
    })),
  };
}

/** One declaration, for the agent app's projection and the portal. Null if unknown. */
export async function getHandoverDeclaration(q: Queryable, declarationId: string): Promise<HandoverDeclarationSummary | null> {
  const row = (
    await q.query<DeclarationRow>(
      `select d.id, d.branch_id, d.agent_pair_id, p.name as agent_pair_name, d.agent_uid, d.device_id, d.captured_at, d.received_at
         from handover_declarations d join agent_pairs p on p.id = d.agent_pair_id where d.id = $1`,
      [declarationId],
    )
  ).rows[0];
  return row ? describeDeclaration(q, row) : null;
}
