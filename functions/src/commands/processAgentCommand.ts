import { agentCommandSchema, type AgentCommand, type CommandResult } from '@susu/shared';
import type { Database, Queryable } from '../db/types.js';
import { DomainError, isDomainError } from '../lib/errors.js';
import { getDevice, type BoundDevice } from '../org/devices.js';
import { postCollection } from './collection.js';

/**
 * Turn one agent command (from Firestore `commands/{commandId}`) into ledger state.
 *
 * - Business rejections return `{ status: 'REJECTED' }` and are recorded, so a retry gives the same answer.
 * - Infrastructure failures throw, so the Firestore trigger retries.
 * - Processing the same command twice returns the first result; money moves once.
 */
export async function processAgentCommand(
  db: Database,
  commandId: string,
  raw: unknown,
  now: () => Date = () => new Date(),
): Promise<CommandResult> {
  const serverTime = () => now().toISOString();

  const previous = await loadPreviousResult(db, commandId);
  if (previous) return previous;

  const parsed = agentCommandSchema.safeParse(raw);
  if (!parsed.success) {
    // Unparseable commands are not stored in agent_commands (fields may be missing); report and stop.
    return {
      status: 'REJECTED',
      reason: 'INVALID_COMMAND',
      message: parsed.error.issues.map((i) => `${i.path.join('.') || 'command'}: ${i.message}`).join('; '),
      serverTime: serverTime(),
    };
  }
  const command = parsed.data;

  try {
    return await db.transaction(async (tx) => {
      const device = await authoriseDevice(tx, command);
      const posted = await dispatch(tx, commandId, command, device);
      await recordCommand(tx, commandId, command, 'POSTED', null, posted.batchId);
      return { status: 'POSTED', postingId: posted.batchId, serverTime: posted.postedAt } as const;
    });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    // Record the rejection in its own transaction (the failed one rolled back).
    return db.transaction(async (tx) => {
      const again = await loadPreviousResult(tx, commandId);
      if (again) return again;
      const seqTaken = await tx.query('select 1 from agent_commands where device_id = $1 and seq = $2', [
        command.deviceId,
        command.seq,
      ]);
      if (seqTaken.rowCount === 0) {
        await recordCommand(tx, commandId, command, 'REJECTED', error.reason, null);
      }
      return { status: 'REJECTED', reason: error.reason, message: error.message, serverTime: serverTime() } as const;
    });
  }
}

async function authoriseDevice(tx: Queryable, command: AgentCommand): Promise<BoundDevice> {
  const device = await getDevice(tx, command.deviceId);
  if (!device) throw new DomainError('DEVICE_NOT_BOUND', 'This phone is not registered to an agent');
  if (device.status !== 'ACTIVE') throw new DomainError('DEVICE_REVOKED', 'This phone has been revoked');
  if (device.agentUid !== command.agentUid) {
    throw new DomainError('DEVICE_AGENT_MISMATCH', 'This phone is registered to a different agent');
  }

  const seq = await tx.query<{ id: string }>('select id from agent_commands where device_id = $1 and seq = $2', [
    command.deviceId,
    command.seq,
  ]);
  if (seq.rows[0]) {
    throw new DomainError('SEQUENCE_REUSED', `Sequence ${command.seq} was already used by command ${seq.rows[0].id}`);
  }
  return device;
}

async function dispatch(tx: Queryable, commandId: string, command: AgentCommand, device: BoundDevice) {
  switch (command.type) {
    case 'COLLECTION':
      return postCollection(tx, commandId, command, device);
  }
}

async function recordCommand(
  tx: Queryable,
  commandId: string,
  command: AgentCommand,
  status: 'POSTED' | 'REJECTED',
  rejectReason: string | null,
  batchId: string | null,
): Promise<void> {
  await tx.query(
    `insert into agent_commands (id, type, agent_uid, device_id, seq, captured_at, status, reject_reason, batch_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (id) do nothing`,
    [commandId, command.type, command.agentUid, command.deviceId, command.seq, command.capturedAt, status, rejectReason, batchId],
  );
}

async function loadPreviousResult(q: Queryable, commandId: string): Promise<CommandResult | null> {
  const result = await q.query<{ status: 'POSTED' | 'REJECTED'; reject_reason: string | null; batch_id: string | null; received_at: Date }>(
    'select status, reject_reason, batch_id, received_at from agent_commands where id = $1',
    [commandId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const serverTime = new Date(row.received_at).toISOString();
  if (row.status === 'POSTED' && row.batch_id) {
    return { status: 'POSTED', postingId: row.batch_id, serverTime };
  }
  return {
    status: 'REJECTED',
    reason: row.reject_reason ?? 'INVALID_COMMAND',
    message: 'This command was already rejected',
    serverTime,
  };
}
