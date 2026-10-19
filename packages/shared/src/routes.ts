import { z } from 'zod';
import { COLLECTION_MAX_PESEWAS } from './commands';
import type { SusuFrequency } from './enums';
import { positivePesewasSchema } from './money';

/**
 * Collection routes (API.md §2 and §4). Each Susu account can be assigned to one agent pair, with the
 * amount the agents expect to collect per visit. Functions copy the assignments into Firestore so the
 * agent app has today's route and a member list offline.
 */

/** Expected amount per visit; never more than one collection may carry. */
export const expectedPesewasSchema = positivePesewasSchema.max(COLLECTION_MAX_PESEWAS);

export const collectorSchema = z
  .object({
    agentPairId: z.uuid(),
    expectedPesewas: expectedPesewasSchema,
  })
  .strict();
export type Collector = z.infer<typeof collectorSchema>;

export const assignCollectorRequestSchema = z
  .object({
    susuAccountId: z.uuid(),
    agentPairId: z.uuid(),
    expectedPesewas: expectedPesewasSchema,
  })
  .strict();
export type AssignCollectorRequest = z.infer<typeof assignCollectorRequestSchema>;

export const unassignCollectorRequestSchema = z.object({ susuAccountId: z.uuid() }).strict();
export type UnassignCollectorRequest = z.infer<typeof unassignCollectorRequestSchema>;

/** Who collects an account, as shown on the member profile. */
export interface AccountCollector {
  agentPairId: string;
  agentPairName: string;
  expectedPesewas: number;
}

/** One row of `agentPairs/{agentPairId}/routes/{yyyy-mm-dd}`.members. */
export interface RouteMemberDoc {
  memberId: string;
  susuAccountId: string;
  fullName: string;
  phoneMasked: string;
  expectedPesewas: number;
  productName: string;
  frequency: SusuFrequency;
}

/** `agentPairs/{agentPairId}/routes/{yyyy-mm-dd}` (updatedAt is a server timestamp). */
export interface RouteDoc {
  day: string;
  agentPairId: string;
  branchId: string;
  /** Sorted by full name. Only ACTIVE members with ACTIVE accounts, for an ACTIVE pair. */
  members: RouteMemberDoc[];
}

/** `agentPairs/{agentPairId}/memberSnapshots/{memberId}` — only members with an account on this pair's route. */
export interface MemberSnapshotDoc {
  fullName: string;
  phoneMasked: string;
  ghanaCardMasked: string;
  accounts: { id: string; productName: string; status: 'ACTIVE' | 'FROZEN' | 'CLOSED' }[];
}

/** Ghana is on GMT all year with no daylight saving, so the UTC date is the local date. */
export function routeDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
