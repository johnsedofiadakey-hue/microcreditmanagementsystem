import type { Migration } from '../migrate.js';

/**
 * Cash handover, withdrawals, cases and branch close (BUILD_PLAN Step 6). The money itself moves only
 * through journal batches; these tables are the operational record around them. Guarded here so a bug
 * or a manual fix cannot skip the second person or rewrite history:
 *
 *   - handovers, branch_counts and branch_closes are append-only;
 *   - a withdrawal moves only PENDING_APPROVAL → APPROVED | REJECTED, then APPROVED → PAID; the
 *     approver is not the requester, and the payer is neither of them; amounts never change;
 *   - a case moves only OPEN → RESOLVED, by someone other than whoever opened it;
 *   - a branch day closes once, by someone other than whoever counted the cash;
 *   - nothing is deleted.
 */
export const migration005Cash: Migration = {
  id: '005_cash',
  sql: /* sql */ `
create function refuse_change() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only (% refused)', tg_table_name, tg_op using errcode = 'P0001';
end;
$$;

-- ── Cases ───────────────────────────────────────────────────────────────────

create table cases (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  kind text not null check (kind in ('HANDOVER_DIFFERENCE', 'CLOSE_DIFFERENCE')),
  status text not null default 'OPEN' check (status in ('OPEN', 'RESOLVED')),
  amount_pesewas bigint not null,
  summary text not null,
  entity_kind text not null,
  entity_id text not null,
  opened_by text not null,
  opened_at timestamptz not null default now(),
  resolved_by text,
  resolved_at timestamptz,
  resolution text,
  check ((status = 'OPEN') = (resolved_by is null)),
  check (resolved_by is null or resolved_by <> opened_by)
);
create index cases_branch_idx on cases (branch_id, status, opened_at);

create function cases_guard() returns trigger language plpgsql as $$
begin
  if old.status <> 'OPEN' or new.status <> 'RESOLVED'
     or (new.id, new.branch_id, new.kind, new.amount_pesewas, new.summary, new.entity_kind, new.entity_id, new.opened_by, new.opened_at)
        is distinct from
        (old.id, old.branch_id, old.kind, old.amount_pesewas, old.summary, old.entity_kind, old.entity_id, old.opened_by, old.opened_at) then
    raise exception 'case %: only OPEN → RESOLVED is allowed', old.id using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger cases_guard before update on cases for each row execute function cases_guard();
create trigger cases_no_delete before delete on cases for each row execute function refuse_change();

-- ── Handovers: agent pair → branch cashier ──────────────────────────────────

create table handovers (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  agent_pair_id uuid not null references agent_pairs(id),
  day date not null,
  expected_pesewas bigint not null check (expected_pesewas >= 0),
  counted_pesewas bigint not null check (counted_pesewas >= 0),
  received_by text not null,
  received_at timestamptz not null default now(),
  note text,
  case_id uuid references cases(id),
  batch_id uuid not null unique references journal_batches(id),
  check ((case_id is null) = (counted_pesewas = expected_pesewas))
);
create index handovers_branch_day_idx on handovers (branch_id, day);
create index handovers_pair_idx on handovers (agent_pair_id, received_at);
create trigger handovers_append_only before update or delete on handovers for each row execute function refuse_change();

-- ── Withdrawals: request → approve (other person) → pay (third person) ─────

create table withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  member_id uuid not null references members(id),
  susu_account_id uuid not null references susu_accounts(id),
  amount_pesewas bigint not null check (amount_pesewas > 0),
  reason text not null,
  needs_head_office boolean not null,
  status text not null default 'PENDING_APPROVAL' check (status in ('PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'PAID')),
  requested_by text not null,
  requested_at timestamptz not null default now(),
  decided_by text,
  decided_at timestamptz,
  reject_reason text,
  paid_by text,
  paid_at timestamptz,
  batch_id uuid unique references journal_batches(id),
  check (decided_by is null or decided_by <> requested_by),
  check (paid_by is null or (paid_by <> requested_by and paid_by <> decided_by)),
  check ((status = 'PENDING_APPROVAL') = (decided_by is null)),
  check ((status = 'REJECTED') = (reject_reason is not null)),
  check ((status = 'PAID') = (paid_by is not null and batch_id is not null))
);
create index withdrawal_requests_branch_idx on withdrawal_requests (branch_id, status, requested_at);
create index withdrawal_requests_account_idx on withdrawal_requests (susu_account_id, status);

create function withdrawal_requests_guard() returns trigger language plpgsql as $$
begin
  if (new.id, new.branch_id, new.member_id, new.susu_account_id, new.amount_pesewas, new.reason, new.needs_head_office,
      new.requested_by, new.requested_at)
     is distinct from
     (old.id, old.branch_id, old.member_id, old.susu_account_id, old.amount_pesewas, old.reason, old.needs_head_office,
      old.requested_by, old.requested_at) then
    raise exception 'withdrawal %: the request itself cannot change', old.id using errcode = 'P0001';
  end if;
  if not ((old.status = 'PENDING_APPROVAL' and new.status in ('APPROVED', 'REJECTED'))
          or (old.status = 'APPROVED' and new.status = 'PAID'
              and (new.decided_by, new.decided_at) is not distinct from (old.decided_by, old.decided_at))) then
    raise exception 'withdrawal %: % → % is not allowed', old.id, old.status, new.status using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger withdrawal_requests_guard before update on withdrawal_requests for each row execute function withdrawal_requests_guard();
create trigger withdrawal_requests_no_delete before delete on withdrawal_requests for each row execute function refuse_change();

-- ── Branch close: cashier counts, a different person closes ────────────────

create table branch_counts (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  day date not null,
  expected_pesewas bigint not null,
  counted_pesewas bigint not null check (counted_pesewas >= 0),
  counted_by text not null,
  counted_at timestamptz not null default now(),
  note text
);
create index branch_counts_day_idx on branch_counts (branch_id, day, counted_at);
create trigger branch_counts_append_only before update or delete on branch_counts for each row execute function refuse_change();

create table branch_closes (
  branch_id uuid not null references branches(id),
  day date not null,
  count_id uuid not null unique references branch_counts(id),
  expected_pesewas bigint not null,
  counted_pesewas bigint not null,
  counted_by text not null,
  closed_by text not null,
  closed_at timestamptz not null default now(),
  note text,
  checklist jsonb not null,
  case_id uuid references cases(id),
  batch_id uuid references journal_batches(id),
  primary key (branch_id, day),
  check (closed_by <> counted_by),
  check ((case_id is null) = (counted_pesewas = expected_pesewas)),
  check ((batch_id is null) = (counted_pesewas = expected_pesewas))
);
create trigger branch_closes_append_only before update or delete on branch_closes for each row execute function refuse_change();
`,
};
