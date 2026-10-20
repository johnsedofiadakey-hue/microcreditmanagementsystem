import { agentCommandSchema, commandSigningString, type AgentCommand, type CommandResult } from '@susu/shared';
import type { Database, Queryable } from '../db/types.js';
import { verifyDeviceSignature } from '../lib/deviceKeys.js';
import { DomainError, isDomainError } from '../lib/errors.js';
import { getDevice, type BoundDevice } from '../org/devices.js';
import { recordHandoverDeclaration } from '../cash/handovers.js';
import { postCollection } from './collection.js';

/**
 * Turn one agent command (from Firestore `commands/{commandId}`) into ledger state.
 *
 * - Business rejections return `{ status: 'REJECTED' }` and are recorded, so a retry gives the same answer.
 * - Infrastructure failures throw, so the Firestore trigger retries.
 * - Processing the same command twice returns the first result; money moves once.
 * - Commands from one phone are processed one at a time (advisory lock per device), so racing
 *   duplicates and sequence clashes resolve cleanly instead of through a constraint error.
 */
export async function processAgentCommand(
  db: Database,
  commandId: string,
  raw: unknown,
  now: () => Date = () => new Date(),
): Promise<CommandResult> {
  const serverTime = () => now().toISOString();

  if (!UUID.test(commandId)) {
    return { status: 'REJECTED', reason: 'INVALID_COMMAND', message: 'Command ID must be a UUID', serverTime: serverTime() };
  }

  const parsed = agentCommandSchema.safeParse(raw);
  if (!parsed.success) {
    const previous = await loadPreviousResult(db, commandId);
    if (previous) return previous;
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
      await lockDevice(tx, command.deviceId);
      const previous = await loadPreviousResult(tx, commandId);
      if (previous) return previous;

      const device = await authorise(tx, commandId, command);
      if (command.type === 'HANDOVER_DECLARATION') {
        // Evidence only: no money moves until a cashier confirms each line (audit H3).
        const { declarationId } = await recordHandoverDeclaration(tx, commandId, command, device);
        await recordCommand(tx, commandId, command, 'RECORDED', null, null, declarationId);
        return { status: 'RECORDED', recordId: declarationId, serverTime: serverTime() } as const;
      }
      const posted = await postCollection(tx, commandId, command, device);
      await recordCommand(tx, commandId, command, 'POSTED', null, posted.batchId);
      return { status: 'POSTED', postingId: posted.batchId, serverTime: posted.postedAt } as const;
    });
  } catch (error) {
    if (!isDomainError(error)) throw error;
    // Record the rejection in its own transaction (the failed one rolled back).
    return db.transaction(async (tx) => {
      await lockDevice(tx, command.deviceId);
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

async function lockDevice(tx: Queryable, deviceId: string): Promise<void> {
  await tx.query(`select pg_advisory_xact_lock(hashtextextended('device:' || $1, 0))`, [deviceId]);
}

/**
 * The phone must be bound and enrolled, the command must be signed by that phone's key, and the
 * agent must still be active and still in the pair the phone is bound to.
 */
async function authorise(tx: Queryable, commandId: string, command: AgentCommand): Promise<BoundDevice> {
  const device = await getDevice(tx, command.deviceId);
  if (!device) throw new DomainError('DEVICE_NOT_BOUND', 'This phone is not registered to an agent');
  if (!device.publicKey) {
    throw new DomainError('DEVICE_NOT_ENROLLED', 'This phone has no signing key on record. Ask your supervisor to bind it again.');
  }
  if (device.agentUid !== command.agentUid) {
    throw new DomainError('DEVICE_AGENT_MISMATCH', 'This phone is registered to a different agent');
  }
  if (!verifyDeviceSignature(device.publicKey, commandSigningString(commandId, command), command.sig)) {
    throw new DomainError('INVALID_SIGNATURE', 'This record was not signed by the registered phone');
  }
  if (device.status !== 'ACTIVE') throw new DomainError('DEVICE_REVOKED', 'This phone has been revoked');
  if (device.agentStatus !== 'ACTIVE') throw new DomainError('AGENT_NOT_ACTIVE', 'This agent account is not active');
  if (device.pairStatus !== 'ACTIVE') throw new DomainError('AGENT_PAIR_NOT_ACTIVE', 'This agent pair is not active');
  if (device.currentPairId !== device.agentPairId) {
    throw new DomainError('AGENT_NOT_IN_PAIR', 'This agent has moved to another pair. Ask your supervisor to bind the phone again.');
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

async function recordCommand(
  tx: Queryable,
  commandId: string,
  command: AgentCommand,
  status: 'POSTED' | 'REJECTED' | 'RECORDED',
  rejectReason: string | null,
  batchId: string | null,
  recordId: string | null = null,
): Promise<void> {
  await tx.query(
    `insert into agent_commands (id, type, agent_uid, device_id, seq, captured_at, status, reject_reason, batch_id, record_id)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict (id) do nothing`,
    [commandId, command.type, command.agentUid, command.deviceId, command.seq, command.capturedAt, status, rejectReason, batchId, recordId],
  );
}

async function loadPreviousResult(q: Queryable, commandId: string): Promise<CommandResult | null> {
  const result = await q.query<{
    status: 'POSTED' | 'REJECTED' | 'RECORDED';
    reject_reason: string | null;
    batch_id: string | null;
    record_id: string | null;
    received_at: Date;
  }>('select status, reject_reason, batch_id, record_id, received_at from agent_commands where id = $1', [commandId]);
  const row = result.rows[0];
  if (!row) return null;
  const serverTime = new Date(row.received_at).toISOString();
  if (row.status === 'POSTED' && row.batch_id) {
    return { status: 'POSTED', postingId: row.batch_id, serverTime };
  }
  if (row.status === 'RECORDED' && row.record_id) {
    return { status: 'RECORDED', recordId: row.record_id, serverTime };
  }
  return {
    status: 'REJECTED',
    reason: row.reject_reason ?? 'INVALID_COMMAND',
    message: 'This command was already rejected',
    serverTime,
  };
}
