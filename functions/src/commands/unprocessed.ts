import type { Firestore, QueryDocumentSnapshot } from 'firebase-admin/firestore';

/** A command younger than this may still be in its trigger's first run; leave it alone. */
export const UNPROCESSED_MIN_AGE_MS = 10 * 60 * 1000;
/**
 * How far back the sweep looks, by the phone's `capturedAt`. Firestore can't query for a missing
 * field, so the sweep scans this window and keeps documents without `status`. 24 h of sweeps every
 * 15 minutes, plus 2 h of slack for phone clocks and non-UTC offsets.
 */
export const UNPROCESSED_WINDOW_MS = 26 * 60 * 60 * 1000;
const PAGE_SIZE = 300;

export interface UnprocessedCommand {
  id: string;
  data: Record<string, unknown>;
}

/**
 * Commands no trigger ever finished: no `status` (POSTED, REJECTED or FAILED) although Firestore
 * created them more than `minAgeMs` ago. Normally empty; a hit means a trigger event was lost (an
 * outage, a deploy at the wrong moment, a stuck emulator) and the money hasn't moved yet.
 *
 * Limitation: found by the phone's own `capturedAt`, so a phone whose clock is more than a day behind
 * is outside the window. Such a phone also shows "waiting for the server", which the agent reports.
 */
export async function findUnprocessedCommands(
  firestore: Firestore,
  options: { now?: Date; minAgeMs?: number; windowMs?: number; max?: number } = {},
): Promise<UnprocessedCommand[]> {
  const now = options.now ?? new Date();
  const minAgeMs = options.minAgeMs ?? UNPROCESSED_MIN_AGE_MS;
  const max = options.max ?? 100;
  const createdBefore = now.getTime() - minAgeMs;
  const cutoff = new Date(now.getTime() - (options.windowMs ?? UNPROCESSED_WINDOW_MS)).toISOString();

  const found: UnprocessedCommand[] = [];
  let last: QueryDocumentSnapshot | undefined;
  for (;;) {
    let query = firestore.collection('commands').where('capturedAt', '>=', cutoff).orderBy('capturedAt').limit(PAGE_SIZE);
    if (last) query = query.startAfter(last);
    const page = await query.get();
    for (const doc of page.docs) {
      const data = doc.data();
      if (data.status === undefined && doc.createTime.toMillis() <= createdBefore) {
        found.push({ id: doc.id, data });
        if (found.length >= max) return found;
      }
    }
    if (page.size < PAGE_SIZE) return found;
    last = page.docs[page.docs.length - 1];
  }
}
