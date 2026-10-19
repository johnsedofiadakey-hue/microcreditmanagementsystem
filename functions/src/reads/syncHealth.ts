import type { Queryable } from '../db/types.js';
import { iso } from './scope.js';

export interface DeviceSyncHealth {
  deviceId: string;
  agentUid: string;
  status: 'ACTIVE' | 'REVOKED';
  /** Highest `seq` the server has received from this phone. */
  lastSeq: number;
  received: number;
  posted: number;
  rejected: number;
  /**
   * Sequence numbers below `lastSeq` that never arrived (audit L1). Not an error by itself — a crash
   * between reserving a number and writing leaves one — but a growing count means lost records.
   */
  missingSeqCount: number;
  lastReceivedAt: string | null;
}

export interface PairSyncHealth {
  branchId: string;
  agentPairId: string;
  devices: DeviceSyncHealth[];
}

/** Sync health for the pair a phone belongs to: written to `branchDashboards/{branchId}/syncHealth/{agentPairId}`. */
export async function pairSyncHealthForDevice(q: Queryable, deviceId: string): Promise<PairSyncHealth | null> {
  const pair = await q.query<{ agent_pair_id: string; branch_id: string }>(
    `select d.agent_pair_id, p.branch_id from devices d join agent_pairs p on p.id = d.agent_pair_id where d.id = $1`,
    [deviceId],
  );
  const row = pair.rows[0];
  if (!row) return null;

  const devices = await q.query<{
    device_id: string;
    agent_uid: string;
    status: 'ACTIVE' | 'REVOKED';
    last_seq: number | null;
    received: number;
    posted: number;
    rejected: number;
    last_received_at: Date | null;
  }>(
    `select d.id as device_id, d.agent_uid, d.status,
            max(c.seq)::bigint as last_seq,
            count(c.id)::bigint as received,
            count(c.id) filter (where c.status = 'POSTED')::bigint as posted,
            count(c.id) filter (where c.status = 'REJECTED')::bigint as rejected,
            max(c.received_at) as last_received_at
       from devices d
       left join agent_commands c on c.device_id = d.id
      where d.agent_pair_id = $1
      group by d.id, d.agent_uid, d.status
      order by d.status, d.id`,
    [row.agent_pair_id],
  );

  return {
    branchId: row.branch_id,
    agentPairId: row.agent_pair_id,
    devices: devices.rows.map((d) => ({
      deviceId: d.device_id,
      agentUid: d.agent_uid,
      status: d.status,
      lastSeq: d.last_seq ?? 0,
      received: d.received,
      posted: d.posted,
      rejected: d.rejected,
      // seq is unique per device, so every number up to lastSeq that isn't present is missing.
      missingSeqCount: Math.max(0, (d.last_seq ?? 0) - d.received),
      lastReceivedAt: iso(d.last_received_at),
    })),
  };
}

/** What the agent app reads at `devices/{deviceId}` to know whether it may collect. */
export interface DeviceStatusDoc {
  status: 'ACTIVE' | 'REVOKED';
  agentUid: string;
  agentPairId: string;
  branchId: string;
  keyFingerprint: string | null;
  revokeReason: string | null;
}

export async function deviceStatusDocs(q: Queryable, deviceIds: string[]): Promise<Map<string, DeviceStatusDoc>> {
  if (deviceIds.length === 0) return new Map();
  const result = await q.query<{
    id: string;
    status: 'ACTIVE' | 'REVOKED';
    agent_uid: string;
    agent_pair_id: string;
    branch_id: string;
    key_fingerprint: string | null;
    revoke_reason: string | null;
  }>(
    `select d.id, d.status, d.agent_uid, d.agent_pair_id, p.branch_id, d.key_fingerprint, d.revoke_reason
       from devices d join agent_pairs p on p.id = d.agent_pair_id
      where d.id = any($1::text[])`,
    [deviceIds],
  );
  return new Map(
    result.rows.map((r) => [
      r.id,
      {
        status: r.status,
        agentUid: r.agent_uid,
        agentPairId: r.agent_pair_id,
        branchId: r.branch_id,
        keyFingerprint: r.key_fingerprint,
        revokeReason: r.revoke_reason,
      },
    ]),
  );
}
