import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { findBalanceMismatches } from '../ledger/reconcile.js';
import { DATABASE_URL, REGION, getDatabase } from '../runtime.js';

/** Nightly: every balance must equal the signed sum of its journal lines. Mismatches open an exception. */
export const reconcileBalances = onSchedule(
  { schedule: 'every day 02:00', timeZone: 'Africa/Accra', region: REGION, secrets: [DATABASE_URL] },
  async () => {
    const mismatches = await findBalanceMismatches(getDatabase());
    if (mismatches.length === 0) {
      logger.info('Balance reconciliation clean');
      return;
    }
    logger.error('Balance reconciliation found mismatches', { count: mismatches.length, mismatches: mismatches.slice(0, 50) });
    const day = new Date().toISOString().slice(0, 10);
    await getFirestore()
      .collection('exceptions')
      .doc(`balance-reconciliation-${day}`)
      .set({
        kind: 'BALANCE_MISMATCH',
        count: mismatches.length,
        sample: mismatches.slice(0, 50),
        status: 'OPEN',
        openedAt: FieldValue.serverTimestamp(),
      });
  },
);
