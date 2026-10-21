import { FieldValue, getFirestore, type WriteBatch } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions';
import type { Queryable } from '../db/types.js';
import { routeDayKey } from '@susu/shared';
import { deviceStatusDocs, pairSyncHealthForDevice } from '../reads/syncHealth.js';
import { activeBranchIds, computeBranchDay, computeCompanyDay, recentlyCorrectedDays } from '../reads/dashboards.js';
import { getHandoverDeclaration } from '../cash/handovers.js';
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

/**
 * `agentPairs/{agentPairId}/handovers/{declarationId}` — the agents see their declaration and, per
 * business, the cashier's count and any difference (audit H3). Rewritten after the declaration and
 * after every confirmation; best-effort like every projection.
 */
export async function publishHandoverDeclaration(q: Queryable, declarationId: string): Promise<void> {
  try {
    const declaration = await getHandoverDeclaration(q, declarationId);
    if (!declaration) return;
    await getFirestore()
      .collection('agentPairs')
      .doc(declaration.agentPairId)
      .collection('handovers')
      .doc(declarationId)
      .set({
        receivedAt: declaration.receivedAt,
        capturedAt: declaration.capturedAt,
        agentUid: declaration.agentUid,
        lines: declaration.lines.map((l) => ({
          businessId: l.businessId,
          businessName: l.businessName,
          declaredPesewas: l.declaredPesewas,
          status: l.status,
          countedPesewas: l.countedPesewas,
          differencePesewas: l.countedPesewas === null ? null : l.countedPesewas - l.declaredPesewas,
          confirmedAt: l.confirmedAt,
        })),
        updatedAt: FieldValue.serverTimestamp(),
      });
  } catch (error) {
    logger.error('Could not publish handover declaration', { declarationId, error });
  }
}

// ── Day dashboards (Step 7, API.md §4) ──

/** The previous Accra day, yyyy-mm-dd. */
export function previousDayKey(day: string): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** `branchDashboards/{branchId}/days/{day}` from the books. Best-effort, like every projection. */
export async function publishBranchDay(q: Queryable, branchId: string, day: string = routeDayKey()): Promise<void> {
  try {
    const dashboard = await computeBranchDay(q, branchId, day);
    await getFirestore().collection('branchDashboards').doc(branchId).collection('days').doc(day).set({ ...dashboard, updatedAt: FieldValue.serverTimestamp() });
  } catch (error) {
    logger.error('Could not publish branch day dashboard', { branchId, day, error });
  }
}

/** `dashboards/company/days/{day}`: every branch, plus open Firestore exceptions. */
export async function publishCompanyDay(q: Queryable, day: string = routeDayKey()): Promise<void> {
  try {
    const firestore = getFirestore();
    const open = await firestore.collection('exceptions').where('status', '==', 'OPEN').count().get();
    const dashboard = await computeCompanyDay(q, day, open.data().count);
    await firestore.collection('dashboards').doc('company').collection('days').doc(day).set({ ...dashboard, updatedAt: FieldValue.serverTimestamp() });
  } catch (error) {
    logger.error('Could not publish company day dashboard', { day, error });
  }
}

/** After a cash action at a branch: that branch's day, then the company roll-up. */
export async function publishBranchAndCompanyDay(q: Queryable, branchId: string, day: string = routeDayKey()): Promise<void> {
  await publishBranchDay(q, branchId, day);
  await publishCompanyDay(q, day);
}

/** How far back the scheduled repair looks for approved corrections to older days. */
export const CORRECTION_REPAIR_WINDOW_MS = 48 * 60 * 60 * 1000;

/**
 * Every active branch and the company, for today and yesterday (late figures settle after midnight),
 * plus any older day whose collections had a correction approved in the last 48 hours — the safety net
 * if the publish right after an approval failed.
 */
export async function publishAllDayDashboards(q: Queryable, now: Date = new Date()): Promise<{ branches: number; correctedDays: number }> {
  const today = routeDayKey(now);
  const branches = await activeBranchIds(q);
  const recentDays = [previousDayKey(today), today];
  for (const day of recentDays) {
    for (const branchId of branches) await publishBranchDay(q, branchId, day);
    await publishCompanyDay(q, day);
  }
  const corrected = (await recentlyCorrectedDays(q, new Date(now.getTime() - CORRECTION_REPAIR_WINDOW_MS))).filter(
    (d) => !recentDays.includes(d.day),
  );
  for (const { branchId, day } of corrected) await publishBranchDay(q, branchId, day);
  for (const day of new Set(corrected.map((d) => d.day))) await publishCompanyDay(q, day);
  return { branches: branches.length, correctedDays: corrected.length };
}
