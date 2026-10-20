import type { Firestore, Query, QueryDocumentSnapshot } from 'firebase-admin/firestore';
import type { Queryable } from '../db/types.js';

/** A command younger than this may still be in its trigger's first run; leave it alone. */
export const UNPROCESSED_MIN_AGE_MS = 10 * 60 * 1000;
/** Firestore `in` filters take at most 30 values. */
const IN_CHUNK = 30;
const PAGE = 100;

/**
 * What Postgres knows about a phone's command numbers: the highest `seq` it has processed and the
 * numbers below that it never received. Every command a phone writes carries its deviceId and a unique,
 * increasing seq (rules enforce both), so an unprocessed command is always either above `maxSeq` or one
 * of the gaps. Recovery uses only these server facts — never the phone's clock (audit M4, REQUESTS #30).
 */
export interface DeviceSeqState {
  deviceId: string;
  maxSeq: number;
  missingSeqs: number[];
}

export async function deviceSeqStates(q: Queryable): Promise<DeviceSeqState[]> {
  const rows = await q.query<{ device_id: string; max_seq: number; missing: number[] | null }>(
    `with known as (
       select d.id as device_id, coalesce(max(c.seq), 0)::bigint as max_seq, count(c.id)::bigint as received
         from devices d left join agent_commands c on c.device_id = d.id
        group by d.id
     )
     select k.device_id, k.max_seq,
            case when k.max_seq > k.received then array(
              select s from generate_series(1, k.max_seq) s
               where not exists (select 1 from agent_commands c where c.device_id = k.device_id and c.seq = s)
               order by s limit 300)
            end as missing
       from known k
      order by k.device_id`,
  );
  return rows.rows.map((r) => ({ deviceId: r.device_id, maxSeq: Number(r.max_seq), missingSeqs: (r.missing ?? []).map(Number) }));
}

export interface UnprocessedCommand {
  id: string;
  data: Record<string, unknown>;
  /** Firestore's server create time (ms). */
  createdAtMs: number;
}

/**
 * Commands no trigger ever finished: no `status` although Firestore created them more than `minAgeMs`
 * ago. Looks per bound device above its highest processed seq and at its gaps, and at every command of
 * enrolled phones that were never bound (`unboundDeviceIds`). Normally empty; a hit means a trigger event
 * was lost and the money hasn't moved yet. Requires the (deviceId, seq) composite index.
 */
export async function findUnprocessedCommands(
  firestore: Firestore,
  devices: DeviceSeqState[],
  options: { now?: Date; minAgeMs?: number; unboundDeviceIds?: string[]; max?: number } = {},
): Promise<UnprocessedCommand[]> {
  const createdBefore = (options.now ?? new Date()).getTime() - (options.minAgeMs ?? UNPROCESSED_MIN_AGE_MS);
  const max = options.max ?? 200;
  const found = new Map<string, UnprocessedCommand>();
  const commands = firestore.collection('commands');

  const collect = async (query: Query) => {
    let last: QueryDocumentSnapshot | undefined;
    for (;;) {
      const page = await (last ? query.startAfter(last) : query).limit(PAGE).get();
      for (const doc of page.docs) {
        const data = doc.data();
        if (data.status === undefined && doc.createTime.toMillis() <= createdBefore) {
          found.set(doc.id, { id: doc.id, data, createdAtMs: doc.createTime.toMillis() });
        }
      }
      if (page.size < PAGE || found.size >= max) return;
      last = page.docs[page.docs.length - 1];
    }
  };

  for (const device of devices) {
    if (found.size >= max) break;
    await collect(commands.where('deviceId', '==', device.deviceId).where('seq', '>', device.maxSeq).orderBy('seq'));
    for (let i = 0; i < device.missingSeqs.length; i += IN_CHUNK) {
      await collect(commands.where('deviceId', '==', device.deviceId).where('seq', 'in', device.missingSeqs.slice(i, i + IN_CHUNK)).orderBy('seq'));
    }
  }
  for (const deviceId of options.unboundDeviceIds ?? []) {
    if (found.size >= max) break;
    await collect(commands.where('deviceId', '==', deviceId).orderBy('seq'));
  }
  return [...found.values()].sort((a, b) => a.createdAtMs - b.createdAtMs).slice(0, max);
}

/** Enrolled phones (Firestore `deviceEnrollments`) that Postgres has never bound. */
export async function unboundEnrolledDeviceIds(firestore: Firestore, bound: DeviceSeqState[]): Promise<string[]> {
  const known = new Set(bound.map((d) => d.deviceId));
  const refs = await firestore.collection('deviceEnrollments').listDocuments();
  return refs.map((r) => r.id).filter((id) => !known.has(id));
}
