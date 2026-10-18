import type { CreateAgentPairRequest } from '@susu/shared';
import type { Queryable } from '../db/types.js';
import { ensureLedgerAccount } from '../ledger/accounts.js';
import type { Actor } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';
import { DomainError } from '../lib/errors.js';
import { requireBranch, requireRole } from '../lib/permissions.js';

export async function createAgentPair(
  tx: Queryable,
  actor: Actor,
  input: CreateAgentPairRequest,
): Promise<{ agentPairId: string }> {
  requireRole(actor, ['SUPER_ADMIN', 'BRANCH_MANAGER']);
  requireBranch(actor, input.branchId);

  if (input.agentAUid === input.agentBUid) {
    throw new DomainError('INVALID_COMMAND', 'An agent pair needs two different agents');
  }

  const agents = await tx.query<{ uid: string; role: string; branch_ids: string[]; status: string }>(
    'select uid, role, branch_ids, status from staff_users where uid = any($1::text[])',
    [[input.agentAUid, input.agentBUid]],
  );
  if (agents.rowCount !== 2) throw new DomainError('NOT_FOUND', 'Both agents must exist as staff users');
  for (const agent of agents.rows) {
    if (agent.role !== 'AGENT' || agent.status !== 'ACTIVE' || !agent.branch_ids.includes(input.branchId)) {
      throw new DomainError('INVALID_COMMAND', `User ${agent.uid} is not an active agent of this branch`);
    }
  }

  const busy = await tx.query(
    `select 1 from agent_pairs
      where status = 'ACTIVE' and (agent_a_uid = any($1::text[]) or agent_b_uid = any($1::text[]))`,
    [[input.agentAUid, input.agentBUid]],
  );
  if (busy.rowCount > 0) throw new DomainError('CONFLICT', 'One of these agents is already in an active pair');

  const created = await tx.query<{ id: string }>(
    `insert into agent_pairs (branch_id, name, agent_a_uid, agent_b_uid, created_by)
     values ($1, $2, $3, $4, $5) returning id`,
    [input.branchId, input.name, input.agentAUid, input.agentBUid, actor.uid],
  );
  const agentPairId = created.rows[0]!.id;

  await ensureLedgerAccount(tx, {
    kind: 'AGENT_CASH_CUSTODY',
    ownerId: agentPairId,
    branchId: input.branchId,
    name: `${input.name} cash custody`,
  });

  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'agent_pair.created',
    entityKind: 'agent_pair',
    entityId: agentPairId,
    branchId: input.branchId,
    channel: actor.channel,
    data: { agentAUid: input.agentAUid, agentBUid: input.agentBUid },
  });
  return { agentPairId };
}
