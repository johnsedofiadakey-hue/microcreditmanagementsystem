import type { CommandResult } from '@susu/shared';
import { FieldValue, getFirestore, type DocumentReference } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { processAgentCommand } from '../commands/processAgentCommand.js';
import { deviceSeqStates, findUnprocessedCommands, unboundEnrolledDeviceIds } from '../commands/unprocessed.js';
import { publishBranchDay, publishHandoverDeclaration, publishSyncHealth } from '../projections/firestore.js';
import { collectionDay } from '../reads/dashboards.js';
import { DATABASE_URL, REGION, SMS_API_KEY, getDatabase } from '../runtime.js';
import { sendSms } from './sms.js';

/** Stop the trigger's own retries after this long; the sweeper below takes over. */
const MAX_RETRY_AGE_MS = 6 * 60 * 60 * 1000;
const SWEEP_BATCH = 50;

const FAILED_MESSAGE = 'Not processed yet. It will be retried automatically — do not enter it again.';

/**
 * The agent's offline queue lands here. Firestore delivers at least once and we retry on failure;
 * processAgentCommand is idempotent per command ID, so money moves exactly once.
 */
export const onAgentCommandCreated = onDocumentCreated(
  { document: 'commands/{commandId}', region: REGION, retry: true, secrets: [DATABASE_URL, SMS_API_KEY] },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const commandId = event.params.commandId;

    try {
      const status = await processAndRecord(snapshot.ref, commandId, snapshot.data());
      logger.info('Agent command processed', { commandId, status });
    } catch (error) {
      const age = Date.now() - Date.parse(event.time);
      if (age > MAX_RETRY_AGE_MS) {
        await markFailed(snapshot.ref, commandId, snapshot.data(), error);
        return;
      }
      logger.warn('Agent command failed; will retry', { commandId, error });
      throw error;
    }
  },
);

/**
 * Post (or reject) a command, write the result onto its document for the agent, refresh the pair's
 * sync health and send the receipt. Shared by the trigger and the sweep for lost triggers.
 */
async function processAndRecord(
  ref: DocumentReference,
  commandId: string,
  data: Record<string, unknown> | undefined,
): Promise<CommandResult['status']> {
  const result = await processAgentCommand(getDatabase(), commandId, data);
  await ref.update({ ...result, processedAt: FieldValue.serverTimestamp() });
  const deviceId = data?.deviceId;
  if (typeof deviceId === 'string') await publishSyncHealth(getDatabase(), deviceId);
  if (result.status === 'POSTED') {
    await sendReceiptNow(commandId);
    // Live branch figures, for the day the collection counts towards (the company roll-up follows on its schedule).
    const counted = await collectionDay(getDatabase(), commandId).catch(() => null);
    if (counted) await publishBranchDay(getDatabase(), counted.branchId, counted.day);
  }
  if (result.status === 'RECORDED') await publishHandoverDeclaration(getDatabase(), result.recordId);
  return result.status;
}

/**
 * Send the member's receipt straight away instead of waiting for the sweep. Any failure is only
 * logged: the outbox row was written with the posting, and the sweep will send it.
 */
async function sendReceiptNow(commandId: string): Promise<void> {
  try {
    await sendSms(getDatabase(), { dedupeKeys: [`sms:collection:${commandId}`], limit: 1 });
  } catch (error) {
    logger.warn('Immediate SMS receipt failed; the outbox sweep will retry', { commandId, error });
  }
}

/**
 * A command the trigger gave up on: mark it FAILED for the agent, and open an exception that head
 * office sees, so the cash in the agent's bag is visible before the sweeper posts it.
 */
async function markFailed(
  ref: DocumentReference,
  commandId: string,
  data: Record<string, unknown> | undefined,
  error: unknown,
): Promise<void> {
  logger.error('Agent command failed; handing over to the sweeper', { commandId, error });
  const db = getFirestore();
  const batch = db.batch();
  batch.update(ref, {
    status: 'FAILED',
    message: FAILED_MESSAGE,
    serverTime: new Date().toISOString(),
    processedAt: FieldValue.serverTimestamp(),
  });
  batch.set(
    db.collection('exceptions').doc(`command-${commandId}`),
    {
      kind: 'COMMAND_FAILED',
      commandId,
      agentUid: data?.agentUid ?? null,
      deviceId: data?.deviceId ?? null,
      commandType: data?.type ?? null,
      error: error instanceof Error ? error.message : String(error),
      status: 'OPEN',
      openedAt: FieldValue.serverTimestamp(),
    },
    { merge: true },
  );
  batch.set(
    db.collection('dashboards').doc('company').collection('live').doc('exceptions'),
    { openCommandFailures: FieldValue.increment(1), updatedAt: FieldValue.serverTimestamp() },
    { merge: true },
  );
  await batch.commit();
}

/**
 * Every 15 minutes: process commands whose trigger never ran (no status after 10 minutes), then try
 * FAILED commands again. Safe because processing is idempotent per command ID.
 */
export const retryFailedCommands = onSchedule(
  { schedule: 'every 15 minutes', region: REGION, secrets: [DATABASE_URL, SMS_API_KEY], timeoutSeconds: 300 },
  async () => {
    await sweepUnprocessedCommands();
    const firestore = getFirestore();
    const failed = await firestore.collection('commands').where('status', '==', 'FAILED').limit(SWEEP_BATCH).get();
    let resolved = 0;
    for (const doc of failed.docs) {
      try {
        const result = await processAgentCommand(getDatabase(), doc.id, doc.data());
        const batch = firestore.batch();
        // POSTED clears the FAILED message; REJECTED brings its own.
        batch.update(doc.ref, {
          message: FieldValue.delete(),
          ...result,
          processedAt: FieldValue.serverTimestamp(),
        });
        batch.set(
          firestore.collection('exceptions').doc(`command-${doc.id}`),
          { status: 'RESOLVED', resolution: result.status, resolvedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
        batch.set(
          firestore.collection('dashboards').doc('company').collection('live').doc('exceptions'),
          { openCommandFailures: FieldValue.increment(-1), updatedAt: FieldValue.serverTimestamp() },
          { merge: true },
        );
        await batch.commit();
        resolved += 1;
      } catch (error) {
        logger.warn('Failed command still cannot be processed', { commandId: doc.id, error });
      }
    }
    logger.info('Failed-command sweep finished', { found: failed.size, resolved });
  },
);

/**
 * Lost trigger events: the money hasn't moved and the agent's phone still says "waiting for the server".
 * Found from each device's sequence numbers in Postgres, not the phone's clock (audit M4). Publishes the
 * count and the oldest one's age for head office, and logs an error when one has waited over an hour.
 */
export async function sweepUnprocessedCommands(): Promise<{ found: number; processed: number }> {
  const db = getDatabase();
  const firestore = getFirestore();
  const devices = await deviceSeqStates(db);
  const unbound = await unboundEnrolledDeviceIds(firestore, devices);
  const unprocessed = await findUnprocessedCommands(firestore, devices, { unboundDeviceIds: unbound });

  let processed = 0;
  for (const command of unprocessed) {
    try {
      await processAndRecord(firestore.collection('commands').doc(command.id), command.id, command.data);
      processed += 1;
    } catch (error) {
      // Left without status, so the next sweep tries again.
      logger.error('Unprocessed command still cannot be processed', { commandId: command.id, error });
    }
  }
  const oldest = unprocessed[0];
  if (unprocessed.length > 0) {
    const ageMinutes = oldest ? Math.round((Date.now() - oldest.createdAtMs) / 60_000) : 0;
    const log = ageMinutes > 60 ? logger.error : logger.warn;
    log('Commands found unprocessed; their trigger never ran', { count: unprocessed.length, processed, oldestAgeMinutes: ageMinutes, ids: unprocessed.map((c) => c.id) });
  }
  await firestore
    .collection('dashboards')
    .doc('company')
    .collection('live')
    .doc('commands')
    .set({
      unprocessedFound: unprocessed.length,
      stillUnprocessed: unprocessed.length - processed,
      oldestUnprocessedCreatedAt: oldest ? new Date(oldest.createdAtMs).toISOString() : null,
      checkedAt: FieldValue.serverTimestamp(),
    });
  return { found: unprocessed.length, processed };
}
