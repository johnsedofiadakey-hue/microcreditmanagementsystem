import { FieldValue, getFirestore } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import type { Queryable } from '../db/types.js';
import { deviceStatusDocs, pairSyncHealthForDevice } from '../reads/syncHealth.js';

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
