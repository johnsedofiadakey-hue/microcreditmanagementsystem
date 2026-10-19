import type { BindDeviceRequest, RevokeDeviceRequest } from '@susu/shared';
import type { Queryable } from '../db/types.js';
import type { Actor } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';
import { deviceKeyFingerprint, parseDevicePublicKey } from '../lib/deviceKeys.js';
import { DomainError } from '../lib/errors.js';
import { requireBranch, requireRole } from '../lib/permissions.js';

const DEVICE_ADMINS = ['SUPER_ADMIN', 'BRANCH_MANAGER', 'SUPERVISOR'] as const;

export interface BoundDevice {
  id: string;
  agentUid: string;
  agentPairId: string;
  branchId: string;
  status: 'ACTIVE' | 'REVOKED';
  publicKey: string | null;
  agentStatus: string;
  pairStatus: string;
  /** The pair the agent belongs to now (agent_pair_members), which may differ from the binding. */
  currentPairId: string | null;
}

/** What the phone wrote to Firestore `deviceEnrollments/{deviceId}` (read by the callable). */
export interface EnrollmentRecord {
  agentUid: string;
  publicKey: string;
}

export async function describeEnrollment(
  tx: Queryable,
  actor: Actor,
  deviceId: string,
  enrollment: EnrollmentRecord | null,
): Promise<{ deviceId: string; agentUid: string; keyFingerprint: string }> {
  requireRole(actor, DEVICE_ADMINS);
  if (!enrollment) {
    throw new DomainError('DEVICE_NOT_ENROLLED', 'This phone has not enrolled yet. Open the agent app on it and sign in.');
  }
  const agent = await tx.query<{ branch_ids: string[] }>('select branch_ids from staff_users where uid = $1', [
    enrollment.agentUid,
  ]);
  if (!agent.rows[0]) throw new DomainError('NOT_FOUND', 'The agent who enrolled this phone does not exist');
  const branchId = agent.rows[0].branch_ids[0];
  if (!branchId) throw new DomainError('NOT_PERMITTED', 'The enrolling agent has no branch');
  requireBranch(actor, branchId);
  parseDevicePublicKey(enrollment.publicKey);
  return { deviceId, agentUid: enrollment.agentUid, keyFingerprint: deviceKeyFingerprint(enrollment.publicKey) };
}

export async function bindDevice(
  tx: Queryable,
  actor: Actor,
  input: BindDeviceRequest,
  enrollment: EnrollmentRecord | null,
): Promise<{ keyFingerprint: string }> {
  requireRole(actor, DEVICE_ADMINS);

  const pair = await tx.query<{ branch_id: string; status: string }>(
    'select branch_id, status from agent_pairs where id = $1',
    [input.agentPairId],
  );
  const row = pair.rows[0];
  if (!row || row.status !== 'ACTIVE') throw new DomainError('NOT_FOUND', 'Active agent pair not found');
  requireBranch(actor, row.branch_id);

  const membership = await tx.query<{ agent_pair_id: string; status: string }>(
    `select m.agent_pair_id, s.status
       from agent_pair_members m join staff_users s on s.uid = m.agent_uid
      where m.agent_uid = $1`,
    [input.agentUid],
  );
  if (membership.rows[0]?.agent_pair_id !== input.agentPairId) {
    throw new DomainError('AGENT_NOT_IN_PAIR', 'This agent is not part of the pair');
  }
  if (membership.rows[0].status !== 'ACTIVE') throw new DomainError('AGENT_NOT_ACTIVE', 'This agent is not active');

  if (!enrollment) {
    throw new DomainError('DEVICE_NOT_ENROLLED', 'This phone has not enrolled yet. Open the agent app on it and sign in.');
  }
  if (enrollment.agentUid !== input.agentUid) {
    throw new DomainError('DEVICE_AGENT_MISMATCH', 'This phone was enrolled by a different agent');
  }
  parseDevicePublicKey(enrollment.publicKey);
  const keyFingerprint = deviceKeyFingerprint(enrollment.publicKey);

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
    `insert into devices (id, agent_uid, agent_pair_id, label, bound_by, public_key, key_fingerprint, enrolled_at)
     values ($1, $2, $3, $4, $5, $6, $7, now())`,
    [input.deviceId, input.agentUid, input.agentPairId, input.label ?? null, actor.uid, enrollment.publicKey, keyFingerprint],
  );

  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'device.bound',
    entityKind: 'device',
    entityId: input.deviceId,
    branchId: row.branch_id,
    channel: actor.channel,
    data: {
      agentUid: input.agentUid,
      agentPairId: input.agentPairId,
      keyFingerprint,
      replaced: previous.rows.map((r) => r.id),
    },
  });
  return { keyFingerprint };
}

export async function revokeDevice(tx: Queryable, actor: Actor, input: RevokeDeviceRequest): Promise<void> {
  requireRole(actor, DEVICE_ADMINS);
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
  const result = await tx.query<{
    id: string;
    agent_uid: string;
    agent_pair_id: string;
    branch_id: string;
    status: 'ACTIVE' | 'REVOKED';
    public_key: string | null;
    agent_status: string;
    pair_status: string;
    current_pair_id: string | null;
  }>(
    `select d.id, d.agent_uid, d.agent_pair_id, p.branch_id, d.status, d.public_key,
            s.status as agent_status, p.status as pair_status, m.agent_pair_id as current_pair_id
       from devices d
       join agent_pairs p on p.id = d.agent_pair_id
       join staff_users s on s.uid = d.agent_uid
       left join agent_pair_members m on m.agent_uid = d.agent_uid
      where d.id = $1`,
    [deviceId],
  );
  const row = result.rows[0];
  return row
    ? {
        id: row.id,
        agentUid: row.agent_uid,
        agentPairId: row.agent_pair_id,
        branchId: row.branch_id,
        status: row.status,
        publicKey: row.public_key,
        agentStatus: row.agent_status,
        pairStatus: row.pair_status,
        currentPairId: row.current_pair_id,
      }
    : null;
}
