import type { Migration } from '../migrate.js';

/** Fixed IDs so seeds, tests and the portal can refer to the client's three businesses. */
export const BUSINESS_IDS = {
  GADUFIA: '0b5e55e5-0000-4000-8000-000000000001',
  STF: '0b5e55e5-0000-4000-8000-000000000002',
  OPWS: '0b5e55e5-0000-4000-8000-000000000003',
} as const;

/**
 * Three businesses on one platform (docs/architecture/ADR-001-three-businesses.md).
 *
 *   - Every ledger account belongs to exactly one business, and a journal batch can never touch two
 *     businesses (checked on every line).
 *   - Cash accounts are per (owner, business): one custody per pair per business, one vault and one
 *     variance per branch per business.
 *   - Products belong to a business; handovers, withdrawals, counts, closes and cases carry it.
 *   - Everything that exists today is Susu, so it is assigned to Gadufia Fiase Susu Services.
 */
export const migration006Businesses: Migration = {
  id: '006_businesses',
  sql: /* sql */ `
create table businesses (
  id uuid primary key,
  code text not null unique check (code ~ '^[A-Z0-9-]{2,16}$'),
  name text not null,
  sms_brand text not null,
  sms_sender_id text not null check (sms_sender_id ~ '^[A-Za-z0-9 ]{1,11}$'),
  address text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now()
);
create trigger businesses_no_delete before delete on businesses for each row execute function refuse_change();

insert into businesses (id, code, name, sms_brand, sms_sender_id, address) values
  ('${BUSINESS_IDS.GADUFIA}', 'GADUFIA', 'Gadufia Fiase Susu Services', 'Gadufia Susu', 'GadufiaSusu', 'P.O. Box FL 21, Aflao, Volta Region'),
  ('${BUSINESS_IDS.STF}', 'STF', 'STF Micro-Credit Services', 'STF Micro-Credit', 'STFCredit', 'P.O. Box FL 21, Aflao, Volta Region'),
  ('${BUSINESS_IDS.OPWS}', 'OPWS', 'Opportunity People''s Welfare Scheme International Association', 'Opportunity Welfare', 'OPWelfare', 'P.O. Box FL 21, Aflao, Volta Region, Ghana');

-- ── Products and ledger accounts ────────────────────────────────────────────

alter table susu_products add column business_id uuid references businesses(id);
update susu_products set business_id = '${BUSINESS_IDS.GADUFIA}';
alter table susu_products alter column business_id set not null;
alter table susu_products drop constraint susu_products_code_version_key;
alter table susu_products add constraint susu_products_business_code_version_key unique (business_id, code, version);

alter table ledger_accounts add column business_id uuid references businesses(id);
update ledger_accounts set business_id = '${BUSINESS_IDS.GADUFIA}';
alter table ledger_accounts alter column business_id set not null;
drop index ledger_accounts_owner_uniq;
create unique index ledger_accounts_owner_uniq
  on ledger_accounts (kind, coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid), business_id);

-- The definition guard (migration 002) now covers the business too.
create or replace function guard_ledger_account() returns trigger language plpgsql as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'ledger accounts cannot be deleted' using errcode = 'P0001';
  end if;
  if new.id <> old.id or new.kind <> old.kind
     or new.owner_id is distinct from old.owner_id or new.branch_id is distinct from old.branch_id
     or new.business_id is distinct from old.business_id
     or new.account_type <> old.account_type or new.normal_side <> old.normal_side
     or new.allow_negative <> old.allow_negative then
    raise exception 'ledger account definitions are immutable; only status and name can change'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- A member's Susu account must belong to its product's business.
create function check_member_account_business() returns trigger language plpgsql as $$
begin
  if (select business_id from ledger_accounts where id = new.ledger_account_id)
     is distinct from (select business_id from susu_products where id = new.product_id) then
    raise exception 'susu account %: ledger account and product belong to different businesses', new.id using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger susu_accounts_business before insert or update on susu_accounts
  for each row execute function check_member_account_business();

-- One business per journal batch: every line must belong to the business of the batch's other lines.
create function journal_line_same_business() returns trigger language plpgsql as $$
declare
  line_business uuid;
begin
  select business_id into line_business from ledger_accounts where id = new.account_id;
  if exists (
    select 1 from journal_lines l join ledger_accounts a on a.id = l.account_id
     where l.batch_id = new.batch_id and a.business_id <> line_business
  ) then
    raise exception 'journal batch % would mix the money of two businesses', new.batch_id using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger journal_lines_same_business before insert on journal_lines
  for each row execute function journal_line_same_business();

-- ── Cash records carry their business ───────────────────────────────────────

-- cases_guard (005) only allows OPEN → RESOLVED, so it is off for the backfill.
alter table cases disable trigger cases_guard;
alter table cases add column business_id uuid references businesses(id);
update cases set business_id = '${BUSINESS_IDS.GADUFIA}';
alter table cases alter column business_id set not null;
alter table cases enable trigger cases_guard;

create or replace function cases_guard() returns trigger language plpgsql as $$
begin
  if old.status <> 'OPEN' or new.status <> 'RESOLVED'
     or (new.id, new.branch_id, new.business_id, new.kind, new.amount_pesewas, new.summary, new.entity_kind, new.entity_id, new.opened_by, new.opened_at)
        is distinct from
        (old.id, old.branch_id, old.business_id, old.kind, old.amount_pesewas, old.summary, old.entity_kind, old.entity_id, old.opened_by, old.opened_at) then
    raise exception 'case %: only OPEN → RESOLVED is allowed', old.id using errcode = 'P0001';
  end if;
  return new;
end;
$$;

-- Append-only tables: drop their guard for the backfill, then put it back.
drop trigger handovers_append_only on handovers;
alter table handovers add column business_id uuid references businesses(id);
update handovers set business_id = '${BUSINESS_IDS.GADUFIA}';
alter table handovers alter column business_id set not null;
create trigger handovers_append_only before update or delete on handovers for each row execute function refuse_change();
create index handovers_business_idx on handovers (branch_id, business_id, day);

drop trigger branch_counts_append_only on branch_counts;
alter table branch_counts add column business_id uuid references businesses(id);
update branch_counts set business_id = '${BUSINESS_IDS.GADUFIA}';
alter table branch_counts alter column business_id set not null;
create trigger branch_counts_append_only before update or delete on branch_counts for each row execute function refuse_change();
drop index branch_counts_day_idx;
create index branch_counts_day_idx on branch_counts (branch_id, business_id, day, counted_at);

drop trigger branch_closes_append_only on branch_closes;
alter table branch_closes add column business_id uuid references businesses(id);
update branch_closes set business_id = '${BUSINESS_IDS.GADUFIA}';
alter table branch_closes alter column business_id set not null;
alter table branch_closes drop constraint branch_closes_pkey;
alter table branch_closes add primary key (branch_id, business_id, day);
create trigger branch_closes_append_only before update or delete on branch_closes for each row execute function refuse_change();

-- Withdrawals: the business is the account's, recorded for scoping and reports (frozen with the request).
alter table withdrawal_requests disable trigger withdrawal_requests_guard;
alter table withdrawal_requests add column business_id uuid references businesses(id);
update withdrawal_requests set business_id = '${BUSINESS_IDS.GADUFIA}';
alter table withdrawal_requests alter column business_id set not null;
alter table withdrawal_requests enable trigger withdrawal_requests_guard;

create or replace function withdrawal_requests_guard() returns trigger language plpgsql as $$
begin
  if (new.id, new.branch_id, new.business_id, new.member_id, new.susu_account_id, new.amount_pesewas, new.reason, new.needs_head_office,
      new.requested_by, new.requested_at)
     is distinct from
     (old.id, old.branch_id, old.business_id, old.member_id, old.susu_account_id, old.amount_pesewas, old.reason, old.needs_head_office,
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
`,
};
