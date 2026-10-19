import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import type { Database } from '../db/types.js';
import { dispatchSmsOutbox, outboxBacklog, type DispatchReport } from '../messaging/dispatch.js';
import { DATABASE_URL, REGION, SMS_API_KEY, SMS_BRAND, getDatabase, getSmsProvider } from '../runtime.js';

/**
 * Send due SMS rows and open a head-office exception for each one we gave up on. Never throws for a
 * provider problem: the outbox row keeps the debt, and the next run (or the sweeper) retries it.
 */
export async function sendSms(db: Database, options: { dedupeKeys?: string[]; limit?: number } = {}): Promise<DispatchReport> {
  const report = await dispatchSmsOutbox(db, getSmsProvider(), { brand: SMS_BRAND.value(), ...options });
  if (report.gaveUp.length > 0) {
    const firestore = getFirestore();
    const batch = firestore.batch();
    for (const failure of report.gaveUp) {
      batch.set(firestore.collection('exceptions').doc(`sms-${failure.outboxId}`), {
        kind: 'SMS_FAILED',
        outboxId: failure.outboxId,
        dedupeKey: failure.dedupeKey,
        error: failure.error,
        status: 'OPEN',
        openedAt: FieldValue.serverTimestamp(),
      });
    }
    batch.set(
      firestore.collection('dashboards').doc('company').collection('live').doc('exceptions'),
      { openSmsFailures: FieldValue.increment(report.gaveUp.length), updatedAt: FieldValue.serverTimestamp() },
      { merge: true },
    );
    await batch.commit();
    logger.error('SMS given up after retries', { failures: report.gaveUp });
  }
  return report;
}

/** Every minute: retries, rows whose immediate send didn't happen, and expired leases. */
export const dispatchSmsOutboxJob = onSchedule(
  { schedule: 'every 1 minutes', region: REGION, secrets: [DATABASE_URL, SMS_API_KEY], timeoutSeconds: 240, retryCount: 0 },
  async () => {
    const db = getDatabase();
    let total: DispatchReport = { claimed: 0, sent: 0, retrying: 0, gaveUp: [] };
    // Up to 4 rounds of 50 per minute; a backlog after an outage drains over a few runs.
    for (let round = 0; round < 4; round += 1) {
      const report = await sendSms(db, { limit: 50 });
      total = {
        claimed: total.claimed + report.claimed,
        sent: total.sent + report.sent,
        retrying: total.retrying + report.retrying,
        gaveUp: [...total.gaveUp, ...report.gaveUp],
      };
      if (report.claimed < 50) break;
    }
    if (total.claimed > 0) logger.info('SMS dispatch', { ...total, gaveUp: total.gaveUp.length });

    const backlog = await outboxBacklog(db);
    await getFirestore()
      .collection('dashboards')
      .doc('company')
      .collection('live')
      .doc('sms')
      .set({ ...backlog, updatedAt: FieldValue.serverTimestamp() });
  },
);
