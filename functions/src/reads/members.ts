import {
  PAGE_SIZE_DEFAULT,
  canAccessBranch,
  maskGhanaCard,
  maskPhone,
  type AccountStatement,
  type KycStatus,
  type MemberAccount,
  type MemberProfile,
  type MemberRow,
  type MemberStatus,
  type PendingApproval,
  type StatementLine,
} from '@susu/shared';
import type { Queryable } from '../db/types.js';
import type { Actor } from '../lib/actor.js';
import { DomainError } from '../lib/errors.js';
import { requireBranch, requireRole } from '../lib/permissions.js';
import { STAFF_READERS, branchScope, decodeCursor, iso, pageOf } from './scope.js';

/** Who may see a member's full Ghana Card number and KYC photos. */
export function canSeeFullKyc(actor: Actor, memberBranchId: string): boolean {
  const { role } = actor.claims;
  if (role === 'SUPER_ADMIN' || role === 'COMPLIANCE') return true;
  return role === 'BRANCH_MANAGER' && canAccessBranch(actor.claims, memberBranchId);
}

/** "0241234567", "024 123 4567", "+233241234567" → "+233241234567"; anything else → null. */
function phoneQuery(query: string): string | null {
  const digits = query.replace(/[\s-]/g, '');
  if (/^0\d{9}$/.test(digits)) return `+233${digits.slice(1)}`;
  if (/^\+233\d{9}$/.test(digits)) return digits;
  return null;
}

interface MemberSearchRow {
  id: string;
  full_name: string;
  phone: string;
  ghana_card_number: string;
  status: MemberStatus;
  kyc_status: KycStatus;
  branch_id: string;
  created_at: Date;
}

/** Newest first. Matches name (contains, case-insensitive), exact phone, or exact Ghana Card number. */
export async function searchMembers(
  q: Queryable,
  actor: Actor,
  input: { branchId?: string; query: string; status?: MemberStatus; cursor?: string | null; limit?: number },
): Promise<{ members: MemberRow[]; nextCursor: string | null }> {
  const scope = branchScope(actor, input.branchId);
  const limit = input.limit ?? PAGE_SIZE_DEFAULT;
  const after = decodeCursor(input.cursor);
  const text = input.query.trim();
  const card = /^GHA-\d{9}-\d$/i.test(text) ? text.toUpperCase() : null;
  const phone = phoneQuery(text);

  const result = await q.query<MemberSearchRow>(
    `select id, full_name, phone, ghana_card_number, status, kyc_status, branch_id, created_at
       from members
      where ($1::uuid[] is null or branch_id = any($1::uuid[]))
        and ($2::text is null or status = $2)
        and ($3 = '' or ghana_card_number = $4 or phone = $5 or full_name ilike '%' || $6 || '%')
        and ($7::timestamptz is null or (created_at, id) < ($7::timestamptz, $8::uuid))
      order by created_at desc, id desc
      limit $9`,
    [
      scope,
      input.status ?? null,
      text,
      card,
      phone,
      text.replace(/[\\%_]/g, (c) => `\\${c}`),
      after?.k ?? null,
      after?.id ?? null,
      limit + 1,
    ],
  );
  const page = pageOf(result.rows, limit, (r) => ({ k: iso(r.created_at)!, id: r.id }));
  return {
    members: page.items.map((r) => ({
      id: r.id,
      fullName: r.full_name,
      phoneMasked: maskPhone(r.phone),
      ghanaCardMasked: maskGhanaCard(r.ghana_card_number),
      status: r.status,
      kycStatus: r.kyc_status,
      branchId: r.branch_id,
      createdAt: iso(r.created_at)!,
    })),
    nextCursor: page.nextCursor,
  };
}

/**
 * Member profile and accounts. Returns the stored `kyc/{memberId}/` photo paths separately; the
 * callable turns them into short-lived signed URLs only when `canSeeFullKyc`.
 */
export async function getMember(
  q: Queryable,
  actor: Actor,
  input: { memberId: string },
): Promise<{ profile: MemberProfile; photoPathsToSign: string[] }> {
  requireRole(actor, STAFF_READERS);
  const result = await q.query<MemberSearchRow & {
    date_of_birth: string | Date;
    created_by: string;
    approved_by: string | null;
    approved_at: Date | null;
    photo_paths: string[];
  }>(
    `select id, full_name, phone, ghana_card_number, status, kyc_status, branch_id, created_at,
            to_char(date_of_birth, 'YYYY-MM-DD') as date_of_birth, created_by, approved_by, approved_at, photo_paths
       from members where id = $1`,
    [input.memberId],
  );
  const m = result.rows[0];
  if (!m) throw new DomainError('MEMBER_NOT_FOUND', 'Member not found');
  requireBranch(actor, m.branch_id);

  const accounts = await q.query<{
    id: string;
    product_name: string;
    balance_pesewas: number;
    status: MemberAccount['status'];
    agent_pair_id: string | null;
    agent_pair_name: string | null;
    expected_pesewas: string | number | null;
    business_id: string;
    business_name: string;
  }>(
    `select s.id, p.name as product_name, b.balance_pesewas, s.status,
            r.agent_pair_id, ap.name as agent_pair_name, r.expected_pesewas,
            p.business_id, bz.name as business_name
       from susu_accounts s
       join susu_products p on p.id = s.product_id
       join businesses bz on bz.id = p.business_id
       join account_balances b on b.account_id = s.ledger_account_id
       left join route_assignments r on r.susu_account_id = s.id
       left join agent_pairs ap on ap.id = r.agent_pair_id
      where s.member_id = $1
      order by s.opened_at, s.id`,
    [input.memberId],
  );

  const full = canSeeFullKyc(actor, m.branch_id);
  const memberPrefix = `kyc/${m.id}/`;
  return {
    profile: {
      id: m.id,
      branchId: m.branch_id,
      fullName: m.full_name,
      phone: m.phone,
      ghanaCardNumber: full ? m.ghana_card_number : null,
      ghanaCardMasked: maskGhanaCard(m.ghana_card_number),
      dateOfBirth: String(m.date_of_birth),
      status: m.status,
      kycStatus: m.kyc_status,
      createdBy: m.created_by,
      createdAt: iso(m.created_at)!,
      approvedBy: m.approved_by,
      approvedAt: iso(m.approved_at),
      photoCount: m.photo_paths.length,
      photoUrls: [],
      accounts: accounts.rows.map((a) => ({
        id: a.id,
        businessId: a.business_id,
        businessName: a.business_name,
        productName: a.product_name,
        balancePesewas: a.balance_pesewas,
        status: a.status,
        collector: a.agent_pair_id
          ? { agentPairId: a.agent_pair_id, agentPairName: a.agent_pair_name ?? '', expectedPesewas: Number(a.expected_pesewas) }
          : null,
      })),
    },
    // Only ever sign paths inside this member's own folder (audit M6).
    photoPathsToSign: full ? m.photo_paths.filter((p) => p.startsWith(memberPrefix) && !p.includes('..')) : [],
  };
}

/** Newest first, each line with the balance right after it. */
export async function getAccountStatement(
  q: Queryable,
  actor: Actor,
  input: { susuAccountId: string; from?: string; to?: string; cursor?: string | null; limit?: number },
): Promise<AccountStatement> {
  requireRole(actor, STAFF_READERS);
  const header = await q.query<{
    id: string;
    member_id: string;
    branch_id: string;
    status: MemberAccount['status'];
    ledger_account_id: string;
    product_name: string;
    balance_pesewas: number;
    business_id: string;
    business_name: string;
  }>(
    `select s.id, s.member_id, s.branch_id, s.status, s.ledger_account_id, p.name as product_name, b.balance_pesewas,
            p.business_id, bz.name as business_name
       from susu_accounts s
       join susu_products p on p.id = s.product_id
       join businesses bz on bz.id = p.business_id
       join account_balances b on b.account_id = s.ledger_account_id
      where s.id = $1`,
    [input.susuAccountId],
  );
  const account = header.rows[0];
  if (!account) throw new DomainError('ACCOUNT_NOT_FOUND', 'Susu account not found');
  requireBranch(actor, account.branch_id);

  const limit = input.limit ?? PAGE_SIZE_DEFAULT;
  const after = decodeCursor(input.cursor);
  const lines = await q.query<{
    line_id: number;
    posted_at: Date;
    kind: string;
    description: string;
    side: 'DEBIT' | 'CREDIT';
    amount_pesewas: number;
    balance_after: number;
    batch_id: string;
  }>(
    `with history as (
       select l.id as line_id, b.posted_at, b.kind, b.description, l.side, l.amount_pesewas, b.id as batch_id,
              sum(case when l.side = a.normal_side then l.amount_pesewas else -l.amount_pesewas end)
                over (order by l.id)::bigint as balance_after
         from journal_lines l
         join journal_batches b on b.id = l.batch_id
         join ledger_accounts a on a.id = l.account_id
        where l.account_id = $1
     )
     select * from history
      where ($2::timestamptz is null or posted_at >= $2)
        and ($3::timestamptz is null or posted_at <= $3)
        and ($4::bigint is null or line_id < $4)
      order by line_id desc
      limit $5`,
    [account.ledger_account_id, input.from ?? null, input.to ?? null, after ? Number(after.k) : null, limit + 1],
  );
  const page = pageOf(lines.rows, limit, (r) => ({ k: String(r.line_id), id: r.batch_id }));
  return {
    account: {
      id: account.id,
      memberId: account.member_id,
      businessId: account.business_id,
      businessName: account.business_name,
      productName: account.product_name,
      balancePesewas: account.balance_pesewas,
      status: account.status,
    },
    lines: page.items.map<StatementLine>((r) => ({
      postedAt: iso(r.posted_at)!,
      kind: r.kind,
      description: r.description,
      debitPesewas: r.side === 'DEBIT' ? r.amount_pesewas : 0,
      creditPesewas: r.side === 'CREDIT' ? r.amount_pesewas : 0,
      balanceAfterPesewas: r.balance_after,
      batchId: r.batch_id,
    })),
    nextCursor: page.nextCursor,
  };
}

/** Members waiting for a checker, oldest first. Includes the maker so the UI can hide "Review" for them. */
export async function listPendingApprovals(
  q: Queryable,
  actor: Actor,
  input: { branchId?: string },
): Promise<{ items: PendingApproval[] }> {
  const scope = branchScope(actor, input.branchId, ['SUPER_ADMIN', 'COMPLIANCE', 'BRANCH_MANAGER']);
  const result = await q.query<{ id: string; full_name: string; created_by: string; created_at: Date; branch_id: string }>(
    `select id, full_name, created_by, created_at, branch_id from members
      where status = 'PENDING_APPROVAL' and ($1::uuid[] is null or branch_id = any($1::uuid[]))
      order by created_at, id
      limit 500`,
    [scope],
  );
  return {
    items: result.rows.map((r) => ({
      kind: 'MEMBER_REGISTRATION',
      id: r.id,
      summary: `New member: ${r.full_name}`,
      requestedBy: r.created_by,
      requestedAt: iso(r.created_at)!,
      branchId: r.branch_id,
    })),
  };
}
