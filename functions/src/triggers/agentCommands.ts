import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { processAgentCommand } from '../commands/processAgentCommand.js';
import { DATABASE_URL, REGION, getDatabase } from '../runtime.js';

/** Give up retrying infrastructure failures after this long and mark the command FAILED for follow-up. */
const MAX_RETRY_AGE_MS = 6 * 60 * 60 * 1000;

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
    } catch (error) {
      const age = Date.now() - Date.parse(event.time);
      if (age > MAX_RETRY_AGE_MS) {
        logger.error('Agent command failed permanently', { commandId, error });
        await snapshot.ref.update({
          status: 'FAILED',
          message: 'Could not be processed. Your supervisor has been notified.',
          serverTime: new Date().toISOString(),
          processedAt: FieldValue.serverTimestamp(),
        });
        return;
      }
      logger.warn('Agent command failed; will retry', { commandId, error });
      throw error;
    }
  },
);
