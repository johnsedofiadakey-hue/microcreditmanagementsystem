import {
  maskGhanaCard,
  maskPhone,
  type AssignCollectorRequest,
  type MemberSnapshotDoc,
  type Role,
  type RouteDoc,
  type RouteMemberDoc,
  type SusuFrequency,
  type UnassignCollectorRequest,
} from '@susu/shared';
import type { Queryable } from '../db/types.js';
import type { Actor } from '../lib/actor.js';
import { writeAudit } from '../lib/audit.js';
import { DomainError } from '../lib/errors.js';
import { requireBranch, requireRole } from '../lib/permissions.js';

/** Who may decide which agent pair collects an account. */
export const ROUTE_MANAGERS: readonly Role[] = ['SUPER_ADMIN', 'BRANCH_MANAGER', 'SUPERVISOR'];

export interface AssignmentChange {
  /** Every pair whose route changed: the new one and, when it moved, the old one. */
  affectedPairIds: string[];
}

interface AccountForRoute {
  branch_id: string;
  status: string;
  member_status: string;
  previous_pair_id: string | null;
}

async function lockAccount(tx: Queryable, susuAccountId: string): Promise<AccountForRoute> {
  const result = await tx.query<AccountForRoute>(
    `select s.branch_id, s.status, m.status as member_status, r.agent_pair_id as previous_pair_id
       from susu_accounts s
       join members m on m.id = s.member_id
       left join route_assignments r on r.susu_account_id = s.id
      where s.id = $1
      for update of s`,
    [susuAccountId],
  );
  const account = result.rows[0];
  if (!account) throw new DomainError('ACCOUNT_NOT_FOUND', 'Susu account not found');
  return account;
}

/**
 * Put an account on an agent pair's route (or move it to another pair, or change the expected
 * amount). Runs inside the caller's transaction. Only ACTIVE accounts of ACTIVE members, and only to
 * an ACTIVE pair of the same branch.
 */
export async function assignCollector(tx: Queryable, actor: Actor, input: AssignCollectorRequest): Promise<AssignmentChange> {
  requireRole(actor, ROUTE_MANAGERS);
  const account = await lockAccount(tx, input.susuAccountId);
  requireBranch(actor, account.branch_id);
  if (account.member_status !== 'ACTIVE') throw new DomainError('MEMBER_NOT_ACTIVE', `Member is ${account.member_status}`);
  if (account.status !== 'ACTIVE') throw new DomainError('ACCOUNT_NOT_ACTIVE', `Susu account is ${account.status}`);

  const pair = (
    await tx.query<{ branch_id: string; status: string }>('select branch_id, status from agent_pairs where id = $1', [input.agentPairId])
  ).rows[0];
  if (!pair) throw new DomainError('NOT_FOUND', 'Agent pair not found');
  if (pair.branch_id !== account.branch_id) {
    throw new DomainError('ACCOUNT_OUTSIDE_BRANCH', 'This agent pair works in a different branch from the account');
  }
  if (pair.status !== 'ACTIVE') throw new DomainError('AGENT_PAIR_NOT_ACTIVE', 'This agent pair is not active');

  await tx.query(
    `insert into route_assignments (susu_account_id, agent_pair_id, expected_pesewas, assigned_by)
     values ($1, $2, $3, $4)
     on conflict (susu_account_id) do update
        set agent_pair_id = excluded.agent_pair_id,
            expected_pesewas = excluded.expected_pesewas,
            assigned_at = now(),
            assigned_by = excluded.assigned_by`,
    [input.susuAccountId, input.agentPairId, input.expectedPesewas, actor.uid],
  );
  // Route history (audit H1): a new period whenever the collecting pair changes.
  if (account.previous_pair_id !== input.agentPairId) {
    await endRoutePeriod(tx, input.susuAccountId, actor.uid);
    await tx.query(
      `insert into route_assignment_periods (susu_account_id, agent_pair_id, started_by) values ($1, $2, $3)`,
      [input.susuAccountId, input.agentPairId, actor.uid],
    );
  }
  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'route.assigned',
    entityKind: 'susu_account',
    entityId: input.susuAccountId,
    branchId: account.branch_id,
    channel: actor.channel,
    data: { agentPairId: input.agentPairId, expectedPesewas: input.expectedPesewas, previousAgentPairId: account.previous_pair_id },
  });
  return { affectedPairIds: unique([input.agentPairId, account.previous_pair_id]) };
}

/** Take an account off its route. Refused with NOT_FOUND when it is on none. */
export async function unassignCollector(tx: Queryable, actor: Actor, input: UnassignCollectorRequest): Promise<AssignmentChange> {
  requireRole(actor, ROUTE_MANAGERS);
  const account = await lockAccount(tx, input.susuAccountId);
  requireBranch(actor, account.branch_id);
  if (!account.previous_pair_id) throw new DomainError('NOT_FOUND', 'This account is not on any route');

  await tx.query('delete from route_assignments where susu_account_id = $1', [input.susuAccountId]);
  await endRoutePeriod(tx, input.susuAccountId, actor.uid);
  await writeAudit(tx, {
    actorUid: actor.uid,
    action: 'route.unassigned',
    entityKind: 'susu_account',
    entityId: input.susuAccountId,
    branchId: account.branch_id,
    channel: actor.channel,
    data: { previousAgentPairId: account.previous_pair_id },
  });
  return { affectedPairIds: [account.previous_pair_id] };
}

async function endRoutePeriod(tx: Queryable, susuAccountId: string, actorUid: string): Promise<void> {
  await tx.query(
    `update route_assignment_periods set ended_at = now(), ended_by = $2 where susu_account_id = $1 and ended_at is null`,
    [susuAccountId, actorUid],
  );
}

/**
 * How long after an account leaves a pair's route that pair's offline collections captured before the
 * change still count as on-route (audit H1). Phones sync at least daily; 72 h covers a weekend.
 */
export const PREVIOUS_ROUTE_GRACE_HOURS = 72;

export type RouteStatus = 'ON_ROUTE' | 'PREVIOUS_ROUTE' | 'OFF_ROUTE';

/**
 * Was this account on the collecting pair's route? ON_ROUTE: assigned to the pair now. PREVIOUS_ROUTE:
 * the pair held it until a reassignment less than PREVIOUS_ROUTE_GRACE_HOURS ago (server time) and the
 * phone captured the collection before that change. Anything else is OFF_ROUTE.
 */
export async function routeStatusFor(
  tx: Queryable,
  input: { susuAccountId: string; agentPairId: string; capturedAt: string },
): Promise<RouteStatus> {
  const current = await tx.query<{ agent_pair_id: string }>('select agent_pair_id from route_assignments where susu_account_id = $1', [
    input.susuAccountId,
  ]);
  if (current.rows[0]?.agent_pair_id === input.agentPairId) return 'ON_ROUTE';
  const previous = await tx.query(
    `select 1 from route_assignment_periods
      where susu_account_id = $1 and agent_pair_id = $2 and ended_at is not null
        and ended_at >= now() - make_interval(hours => $3)
        and $4::timestamptz <= ended_at
      limit 1`,
    [input.susuAccountId, input.agentPairId, PREVIOUS_ROUTE_GRACE_HOURS, input.capturedAt],
  );
  return previous.rowCount > 0 ? 'PREVIOUS_ROUTE' : 'OFF_ROUTE';
}

export interface PairRoute {
  route: RouteDoc;
  /** Keyed by memberId. */
  snapshots: Map<string, MemberSnapshotDoc>;
}

/**
 * Everything the agent app needs for one pair on one day. An inactive (or unknown) pair gets an empty
 * route, so its agents stop seeing members. Returns null when the pair doesn't exist.
 */
export async function buildPairRoute(q: Queryable, agentPairId: string, day: string): Promise<PairRoute | null> {
  const pair = (
    await q.query<{ branch_id: string; status: string }>('select branch_id, status from agent_pairs where id = $1', [agentPairId])
  ).rows[0];
  if (!pair) return null;

  const rows =
    pair.status === 'ACTIVE'
      ? (
          await q.query<{
            member_id: string;
            susu_account_id: string;
            full_name: string;
            phone: string;
            ghana_card_number: string;
            expected_pesewas: string | number;
            product_name: string;
            frequency: SusuFrequency;
          }>(
            `select m.id as member_id, s.id as susu_account_id, m.full_name, m.phone, m.ghana_card_number,
                    r.expected_pesewas, p.name as product_name, p.frequency
               from route_assignments r
               join susu_accounts s on s.id = r.susu_account_id
               join members m on m.id = s.member_id
               join susu_products p on p.id = s.product_id
              where r.agent_pair_id = $1
                and s.status = 'ACTIVE'
                and m.status = 'ACTIVE'
                and s.branch_id = $2
              order by m.full_name, s.opened_at, s.id`,
            [agentPairId, pair.branch_id],
          )
        ).rows
      : [];

  const members: RouteMemberDoc[] = rows.map((r) => ({
    memberId: r.member_id,
    susuAccountId: r.susu_account_id,
    fullName: r.full_name,
    phoneMasked: maskPhone(r.phone),
    expectedPesewas: Number(r.expected_pesewas),
    productName: r.product_name,
    frequency: r.frequency,
  }));

  const snapshots = new Map<string, MemberSnapshotDoc>();
  for (const r of rows) {
    const snapshot = snapshots.get(r.member_id) ?? {
      fullName: r.full_name,
      phoneMasked: maskPhone(r.phone),
      ghanaCardMasked: maskGhanaCard(r.ghana_card_number),
      accounts: [],
    };
    snapshot.accounts.push({ id: r.susu_account_id, productName: r.product_name, status: 'ACTIVE' });
    snapshots.set(r.member_id, snapshot);
  }

  return { route: { day, agentPairId, branchId: pair.branch_id, members }, snapshots };
}

/** Pairs whose route must be rebuilt for a new day. */
export async function activePairIds(q: Queryable): Promise<string[]> {
  return (await q.query<{ id: string }>(`select id from agent_pairs where status = 'ACTIVE' order by id`)).rows.map((r) => r.id);
}

function unique(ids: (string | null)[]): string[] {
  return [...new Set(ids.filter((id): id is string => id !== null))];
}
