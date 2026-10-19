import { FieldValue, getFirestore, type WriteBatch } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import type { Queryable } from '../db/types.js';
import { routeDayKey } from '@susu/shared';
import { deviceStatusDocs, pairSyncHealthForDevice } from '../reads/syncHealth.js';
import { buildPairRoute } from '../routes/routes.js';

/**
 * Firestore read models are copies of Postgres state for fast or offline reads. They are written
 * after the Postgres transaction commits and are best-effort: a failure is logged, never allowed to
 * undo or block the financial change, and the next write for the same device repairs it.
 */

/** `devices/{deviceId}` — lets the agent app show "this phone is not bound / was revoked". */
export async function publishDeviceStatus(q: Queryable, deviceIds: string[]): Promise<void> {
  try {
    const docs = await deviceStatusDocs(q, deviceIds);
    const batch = getFirestore().batch();
    for (const [deviceId, doc] of docs) {
      batch.set(getFirestore().collection('devices').doc(deviceId), { ...doc, updatedAt: FieldValue.serverTimestamp() });
    }
    await batch.commit();
  } catch (error) {
    logger.error('Could not publish device status', { deviceIds, error });
  }
}

/** `branchDashboards/{branchId}/syncHealth/{agentPairId}` — supervisors see whether phones are syncing. */
export async function publishSyncHealth(q: Queryable, deviceId: string): Promise<void> {
  try {
    const health = await pairSyncHealthForDevice(q, deviceId);
    if (!health) return;
    await getFirestore()
      .collection('branchDashboards')
      .doc(health.branchId)
      .collection('syncHealth')
      .doc(health.agentPairId)
      .set({ ...health, updatedAt: FieldValue.serverTimestamp() });
  } catch (error) {
    logger.error('Could not publish sync health', { deviceId, error });
  }
}

/** Firestore batches hold at most 500 writes. */
const BATCH_LIMIT = 450;

/**
 * `agentPairs/{agentPairId}/routes/{day}` and `agentPairs/{agentPairId}/memberSnapshots/{memberId}` —
 * the agents' route and offline member list. Snapshots of members no longer on the pair's route are
 * deleted, so an agent never keeps another pair's members on their phone.
 * Returns the pairs that failed (logged, not thrown) so a scheduled run can report them.
 */
export async function publishRoutes(q: Queryable, agentPairIds: string[], day: string = routeDayKey()): Promise<string[]> {
  const failed: string[] = [];
  for (const agentPairId of agentPairIds) {
    try {
      const built = await buildPairRoute(q, agentPairId, day);
      if (!built) continue;
      const db = getFirestore();
      const pairRef = db.collection('agentPairs').doc(agentPairId);
      const existing = await pairRef.collection('memberSnapshots').listDocuments();

      const writes: ((batch: WriteBatch) => void)[] = [];
      for (const [memberId, snapshot] of built.snapshots) {
        writes.push((b) => b.set(pairRef.collection('memberSnapshots').doc(memberId), { ...snapshot, updatedAt: FieldValue.serverTimestamp() }));
      }
      for (const ref of existing) {
        if (!built.snapshots.has(ref.id)) writes.push((b) => b.delete(ref));
      }
      // The route last, so a phone never lists a member whose snapshot isn't written yet.
      writes.push((b) => b.set(pairRef.collection('routes').doc(day), { ...built.route, updatedAt: FieldValue.serverTimestamp() }));

      for (let i = 0; i < writes.length; i += BATCH_LIMIT) {
        const batch = db.batch();
        for (const write of writes.slice(i, i + BATCH_LIMIT)) write(batch);
        await batch.commit();
      }
    } catch (error) {
      failed.push(agentPairId);
      logger.error('Could not publish route', { agentPairId, day, error });
    }
  }
  return failed;
}
