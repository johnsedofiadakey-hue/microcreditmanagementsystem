import type { AgentPairSummary, BranchSummary, DeviceSummary, ProductRow, Role, StaffSummary } from '@susu/shared';
import type { Queryable } from '../db/types.js';
import type { Actor } from '../lib/actor.js';
import { requireRole } from '../lib/permissions.js';
import { STAFF_READERS, branchScope, iso } from './scope.js';

export async function listBranches(q: Queryable, actor: Actor): Promise<{ branches: BranchSummary[] }> {
  const scope = branchScope(actor, undefined);
  const result = await q.query<BranchSummary>(
    `select id, code, name, status from branches
      where $1::uuid[] is null or id = any($1::uuid[])
      order by name, id`,
    [scope],
  );
  return { branches: result.rows };
}

const STAFF_LIST_ROLES: readonly Role[] = ['SUPER_ADMIN', 'COMPLIANCE', 'BRANCH_MANAGER', 'SUPERVISOR'];

export async function listStaff(q: Queryable, actor: Actor, input: { branchId?: string }): Promise<{ staff: StaffSummary[] }> {
  const scope = branchScope(actor, input.branchId, STAFF_LIST_ROLES);
  const result = await q.query<{ uid: string; email: string; display_name: string; role: Role; branch_ids: string[]; status: 'ACTIVE' | 'DISABLED' }>(
    `select uid, email, display_name, role, branch_ids, status from staff_users
      where $1::uuid[] is null or branch_ids && $1::uuid[]
      order by display_name, uid`,
    [scope],
  );
  return {
    staff: result.rows.map((r) => ({
      uid: r.uid,
      email: r.email,
      displayName: r.display_name,
      role: r.role,
      branchIds: r.branch_ids,
      status: r.status,
    })),
  };
}

export async function listAgentPairs(q: Queryable, actor: Actor, input: { branchId?: string }): Promise<{ agentPairs: AgentPairSummary[] }> {
  const scope = branchScope(actor, input.branchId);
  const result = await q.query<{ id: string; branch_id: string; name: string; agent_a_uid: string; agent_b_uid: string; status: 'ACTIVE' | 'INACTIVE' }>(
    `select id, branch_id, name, agent_a_uid, agent_b_uid, status from agent_pairs
      where $1::uuid[] is null or branch_id = any($1::uuid[])
      order by status, name, id`,
    [scope],
  );
  return {
    agentPairs: result.rows.map((r) => ({
      id: r.id,
      branchId: r.branch_id,
      name: r.name,
      agentAUid: r.agent_a_uid,
      agentBUid: r.agent_b_uid,
      status: r.status,
    })),
  };
}

export async function listDevices(q: Queryable, actor: Actor, input: { branchId?: string }): Promise<{ devices: DeviceSummary[] }> {
  const scope = branchScope(actor, input.branchId, ['SUPER_ADMIN', 'COMPLIANCE', 'BRANCH_MANAGER', 'SUPERVISOR']);
  const result = await q.query<{
    id: string;
    agent_uid: string;
    agent_pair_id: string;
    branch_id: string;
    label: string | null;
    status: 'ACTIVE' | 'REVOKED';
    bound_at: Date;
    key_fingerprint: string | null;
    revoke_reason: string | null;
  }>(
    `select d.id, d.agent_uid, d.agent_pair_id, p.branch_id, d.label, d.status, d.bound_at, d.key_fingerprint, d.revoke_reason
       from devices d join agent_pairs p on p.id = d.agent_pair_id
      where $1::uuid[] is null or p.branch_id = any($1::uuid[])
      order by d.status, d.bound_at desc, d.id`,
    [scope],
  );
  return {
    devices: result.rows.map((r) => ({
      id: r.id,
      agentUid: r.agent_uid,
      agentPairId: r.agent_pair_id,
      branchId: r.branch_id,
      label: r.label,
      status: r.status,
      boundAt: iso(r.bound_at)!,
      keyFingerprint: r.key_fingerprint,
      revokeReason: r.revoke_reason,
    })),
  };
}

export async function listSusuProducts(q: Queryable, actor: Actor): Promise<{ products: ProductRow[] }> {
  requireRole(actor, STAFF_READERS);
  const result = await q.query<ProductRow>(
    `select id, code, version, name, frequency, status from susu_products order by status, code, version desc`,
  );
  return { products: result.rows };
}
