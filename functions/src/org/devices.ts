import type { BindDeviceRequest, RevokeDeviceRequest } from '@susu/shared';
import type { Queryable } from '../db/types.js';
import type { Actor } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';
import { DomainError } from '../lib/errors.js';
import { requireBranch, requireRole } from '../lib/permissions.js';

export interface BoundDevice {
  id: string;
  agentUid: string;
  agentPairId: string;
  branchId: string;
  status: 'ACTIVE' | 'REVOKED';
}

export async function bindDevice(tx: Queryable, actor: Actor, input: BindDeviceRequest): Promise<void> {
  requireRole(actor, ['SUPER_ADMIN', 'BRANCH_MANAGER', 'SUPERVISOR']);

  const pair = await tx.query<{ branch_id: string; agent_a_uid: string; agent_b_uid: string; status: string }>(
    'select branch_id, agent_a_uid, agent_b_uid, status from agent_pairs where id = $1',
    [input.agentPairId],
  );
  const row = pair.rows[0];
  if (!row || row.status !== 'ACTIVE') throw new DomainError('NOT_FOUND', 'Active agent pair not found');
  requireBranch(actor, row.branch_id);
  if (input.agentUid !== row.agent_a_uid && input.agentUid !== row.agent_b_uid) {
    throw new DomainError('INVALID_COMMAND', 'This agent is not part of the pair');
  }

  const existing = await tx.query('select 1 from devices where id = $1', [input.deviceId]);
  if (existing.rowCount > 0) {
    throw new DomainError('CONFLICT', 'This device is already registered; revoke it and enrol it again');
  }

  // One active device per agent: binding a new one revokes the old.
  const previous = await tx.query<{ id: string }>(
    `update devices set status = 'REVOKED', revoked_at = now(), revoked_by = $2, revoke_reason = 'Replaced by new device'
      where agent_uid = $1 and status = 'ACTIVE' returning id`,
    [input.agentUid, actor.uid],
  );

  await tx.query(
    `insert into devices (id, agent_uid, agent_pair_id, label, bound_by) values ($1, $2, $3, $4, $5)`,
    [input.deviceId, input.agentUid, input.agentPairId, input.label ?? null, actor.uid],
  );

  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'device.bound',
    entityKind: 'device',
    entityId: input.deviceId,
    branchId: row.branch_id,
    channel: actor.channel,
    data: { agentUid: input.agentUid, agentPairId: input.agentPairId, replaced: previous.rows.map((r) => r.id) },
  });
}

export async function revokeDevice(tx: Queryable, actor: Actor, input: RevokeDeviceRequest): Promise<void> {
  requireRole(actor, ['SUPER_ADMIN', 'BRANCH_MANAGER', 'SUPERVISOR']);
  const device = await getDevice(tx, input.deviceId);
  if (!device) throw new DomainError('NOT_FOUND', 'Device not found');
  requireBranch(actor, device.branchId);
  if (device.status === 'REVOKED') return;

  await tx.query(
    `update devices set status = 'REVOKED', revoked_at = now(), revoked_by = $2, revoke_reason = $3 where id = $1`,
    [input.deviceId, actor.uid, input.reason],
  );
  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'device.revoked',
    entityKind: 'device',
    entityId: input.deviceId,
    branchId: device.branchId,
    channel: actor.channel,
    data: { reason: input.reason },
  });
}

export async function getDevice(tx: Queryable, deviceId: string): Promise<BoundDevice | null> {
  const result = await tx.query<{ id: string; agent_uid: string; agent_pair_id: string; branch_id: string; status: 'ACTIVE' | 'REVOKED' }>(
    `select d.id, d.agent_uid, d.agent_pair_id, p.branch_id, d.status
       from devices d join agent_pairs p on p.id = d.agent_pair_id
      where d.id = $1`,
    [deviceId],
  );
  const row = result.rows[0];
  return row
    ? { id: row.id, agentUid: row.agent_uid, agentPairId: row.agent_pair_id, branchId: row.branch_id, status: row.status }
    : null;
}
