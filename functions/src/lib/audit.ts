import type { Channel } from '@susu/shared';
import type { Queryable } from '../db/types.js';

export interface AuditEvent {
  actorUid: string;
  action: string;
  entityKind: string;
  entityId: string;
  branchId?: string | null;
  deviceId?: string | null;
  channel: Channel;
  data?: Record<string, unknown>;
}

/** Append-only. Call inside the same transaction as the change it describes. */
export async function writeAudit(tx: Queryable, event: AuditEvent): Promise<void> {
  await tx.query(
    `insert into audit_events (actor_uid, action, entity_kind, entity_id, branch_id, device_id, channel, data)
     values ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      event.actorUid,
      event.action,
      event.entityKind,
      event.entityId,
      event.branchId ?? null,
      event.deviceId ?? null,
      event.channel,
      JSON.stringify(event.data ?? {}),
    ],
  );
}
