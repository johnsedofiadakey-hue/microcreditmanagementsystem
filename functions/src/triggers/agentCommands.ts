import { FieldValue, getFirestore, type DocumentReference } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { processAgentCommand } from '../commands/processAgentCommand.js';
import { publishSyncHealth } from '../projections/firestore.js';
import { DATABASE_URL, REGION, getDatabase } from '../runtime.js';

/** Stop the trigger's own retries after this long; the sweeper below takes over. */
const MAX_RETRY_AGE_MS = 6 * 60 * 60 * 1000;
const SWEEP_BATCH = 50;

const FAILED_MESSAGE = 'Not processed yet. It will be retried automatically — do not enter it again.';

/**
 * The agent's offline queue lands here. Firestore delivers at least once and we retry on failure;
 * processAgentCommand is idempotent per command ID, so money moves exactly once.
 */
export const onAgentCommandCreated = onDocumentCreated(
  { document: 'commands/{commandId}', region: REGION, retry: true, secrets: [DATABASE_URL] },
  async (event) => {
    const snapshot = event.data;
    if (!snapshot) return;
    const commandId = event.params.commandId;

    try {
      const result = await processAgentCommand(getDatabase(), commandId, snapshot.data());
      await snapshot.ref.update({ ...result, processedAt: FieldValue.serverTimestamp() });
      logger.info('Agent command processed', { commandId, status: result.status });
      const deviceId = snapshot.data()?.deviceId;
      if (typeof deviceId === 'string') await publishSyncHealth(getDatabase(), deviceId);
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

/** Every 15 minutes, try FAILED commands again. Safe because processing is idempotent per command ID. */
export const retryFailedCommands = onSchedule(
  { schedule: 'every 15 minutes', region: REGION, secrets: [DATABASE_URL], timeoutSeconds: 300 },
  async () => {
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
