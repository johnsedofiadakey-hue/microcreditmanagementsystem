import type { Migration } from '../migrate.js';

/**
 * Core schema: organisation, members, chart of accounts, double-entry journal, audit, outbox.
 *
 * Guarantees enforced by the database itself, not just application code:
 *   - journal_batches, journal_lines and audit_events are append-only (update/delete/truncate raise);
 *   - every journal batch balances (debits = credits, at least two lines), checked at commit;
 *   - a batch can be reversed at most once;
 *   - idempotency keys are unique;
 *   - amounts are positive integer pesewas.
 */
export const migration001Core: Migration = {
  id: '001_core',
  sql: /* sql */ `
create function forbid_change() returns trigger language plpgsql as $$
begin
  raise exception '% is append-only; post a reversal instead', tg_table_name using errcode = 'P0001';
end;
$$;

-- ── Organisation ────────────────────────────────────────────────────────────

create table branches (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CLOSED')),
  created_at timestamptz not null default now(),
  created_by text not null
);

create table staff_users (
  uid text primary key,
  email text not null unique,
  display_name text not null,
  role text not null check (role in ('SUPER_ADMIN','FINANCE','COMPLIANCE','BRANCH_MANAGER','CASHIER','SUPERVISOR','AGENT')),
  branch_ids uuid[] not null default '{}',
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'DISABLED')),
  created_at timestamptz not null default now(),
  created_by text not null
);

create table agent_pairs (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  name text not null,
  agent_a_uid text not null references staff_users(uid),
  agent_b_uid text not null references staff_users(uid),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'INACTIVE')),
  created_at timestamptz not null default now(),
  created_by text not null,
  check (agent_a_uid <> agent_b_uid)
);

create table devices (
  id text primary key,
  agent_uid text not null references staff_users(uid),
  agent_pair_id uuid not null references agent_pairs(id),
  label text,
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'REVOKED')),
  bound_at timestamptz not null default now(),
  bound_by text not null,
  revoked_at timestamptz,
  revoked_by text,
  revoke_reason text
);

-- ── Members and products ────────────────────────────────────────────────────

create table members (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  full_name text not null,
  phone text not null,
  ghana_card_number text not null unique,
  date_of_birth date not null,
  photo_paths text[] not null default '{}',
  status text not null default 'PENDING_APPROVAL'
    check (status in ('PENDING_APPROVAL','ACTIVE','RESTRICTED','REJECTED','CLOSED')),
  kyc_status text not null default 'DRAFT'
    check (kyc_status in ('DRAFT','VERIFIED','RETRY_REQUIRED','EXCEPTION','RESTRICTED','REJECTED','EXPIRED')),
  consent_at timestamptz not null,
  created_at timestamptz not null default now(),
  created_by text not null,
  approved_at timestamptz,
  approved_by text,
  check (approved_by is null or approved_by <> created_by)
);
create index members_branch_idx on members (branch_id, status);
create index members_phone_idx on members (phone);

create table susu_products (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  version int not null default 1,
  name text not null,
  frequency text not null check (frequency in ('DAILY','WEEKLY','MONTHLY')),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','RETIRED')),
  created_at timestamptz not null default now(),
  created_by text not null,
  unique (code, version)
);

-- ── Chart of accounts and balances ──────────────────────────────────────────

create table ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in (
    'MEMBER_SUSU', 'AGENT_CASH_CUSTODY', 'BRANCH_CASH', 'BRANCH_CASH_VARIANCE', 'OPENING_BALANCE_EQUITY'
  )),
  owner_id uuid,
  branch_id uuid references branches(id),
  name text not null,
  account_type text not null check (account_type in ('ASSET','LIABILITY','EQUITY','INCOME','EXPENSE')),
  normal_side text not null check (normal_side in ('DEBIT','CREDIT')),
  allow_negative boolean not null default false,
  status text not null default 'ACTIVE' check (status in ('ACTIVE','FROZEN','CLOSED')),
  created_at timestamptz not null default now()
);
create unique index ledger_accounts_owner_uniq on ledger_accounts (kind, coalesce(owner_id, '00000000-0000-0000-0000-000000000000'::uuid));

-- Balance in the account's normal-side terms: a member's Susu balance is positive when we owe them.
create table account_balances (
  account_id uuid primary key references ledger_accounts(id),
  balance_pesewas bigint not null default 0,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

create table susu_accounts (
  id uuid primary key default gen_random_uuid(),
  member_id uuid not null references members(id),
  product_id uuid not null references susu_products(id),
  branch_id uuid not null references branches(id),
  ledger_account_id uuid not null unique references ledger_accounts(id),
  status text not null default 'ACTIVE' check (status in ('ACTIVE','FROZEN','CLOSED')),
  opened_at timestamptz not null default now(),
  opened_by text not null
);
create index susu_accounts_member_idx on susu_accounts (member_id);

-- ── Journal ─────────────────────────────────────────────────────────────────

create table journal_batches (
  id uuid primary key default gen_random_uuid(),
  idempotency_key text not null unique,
  request_hash text not null,
  kind text not null,
  description text not null,
  branch_id uuid references branches(id),
  actor_uid text not null,
  approved_by text,
  device_id text,
  channel text not null check (channel in ('PORTAL','AGENT_APP','USSD','SMS','SYSTEM')),
  reverses_batch_id uuid references journal_batches(id),
  posted_at timestamptz not null default now(),
  check (approved_by is null or approved_by <> actor_uid)
);
create unique index journal_batches_reversal_once on journal_batches (reverses_batch_id) where reverses_batch_id is not null;
create index journal_batches_branch_idx on journal_batches (branch_id, posted_at);

create table journal_lines (
  id bigint generated always as identity primary key,
  batch_id uuid not null references journal_batches(id),
  account_id uuid not null references ledger_accounts(id),
  side text not null check (side in ('DEBIT','CREDIT')),
  amount_pesewas bigint not null check (amount_pesewas > 0)
);
create index journal_lines_batch_idx on journal_lines (batch_id);
create index journal_lines_account_idx on journal_lines (account_id, id);

create function assert_batch_balanced() returns trigger language plpgsql as $$
declare
  debits bigint;
  credits bigint;
  line_count int;
begin
  select coalesce(sum(amount_pesewas) filter (where side = 'DEBIT'), 0),
         coalesce(sum(amount_pesewas) filter (where side = 'CREDIT'), 0),
         count(*)
    into debits, credits, line_count
    from journal_lines
   where batch_id = new.id;
  if line_count < 2 or debits <> credits then
    raise exception 'journal batch % is unbalanced (debits %, credits %, lines %)', new.id, debits, credits, line_count
      using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create constraint trigger journal_batch_balanced
  after insert on journal_batches
  deferrable initially deferred
  for each row execute function assert_batch_balanced();

create trigger journal_batches_append_only before update or delete on journal_batches
  for each row execute function forbid_change();
create trigger journal_batches_no_truncate before truncate on journal_batches
  for each statement execute function forbid_change();
create trigger journal_lines_append_only before update or delete on journal_lines
  for each row execute function forbid_change();
create trigger journal_lines_no_truncate before truncate on journal_lines
  for each statement execute function forbid_change();

-- ── Field operations ────────────────────────────────────────────────────────

create table agent_commands (
  id uuid primary key,
  type text not null,
  agent_uid text not null,
  device_id text not null,
  seq bigint not null,
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  status text not null check (status in ('POSTED','REJECTED')),
  reject_reason text,
  batch_id uuid references journal_batches(id),
  unique (device_id, seq)
);

create table collections (
  id uuid primary key references agent_commands(id) deferrable initially deferred,
  member_id uuid not null references members(id),
  susu_account_id uuid not null references susu_accounts(id),
  agent_pair_id uuid not null references agent_pairs(id),
  branch_id uuid not null references branches(id),
  agent_uid text not null,
  device_id text not null,
  amount_pesewas bigint not null check (amount_pesewas > 0),
  captured_at timestamptz not null,
  posted_at timestamptz not null default now(),
  batch_id uuid not null unique references journal_batches(id)
);
create index collections_pair_idx on collections (agent_pair_id, posted_at);
create index collections_branch_idx on collections (branch_id, posted_at);

-- ── Audit and outbox ────────────────────────────────────────────────────────

create table audit_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor_uid text not null,
  action text not null,
  entity_kind text not null,
  entity_id text not null,
  branch_id uuid,
  device_id text,
  channel text not null,
  data jsonb not null default '{}'
);
create index audit_events_entity_idx on audit_events (entity_kind, entity_id, at);
create index audit_events_branch_idx on audit_events (branch_id, at);

create trigger audit_events_append_only before update or delete on audit_events
  for each row execute function forbid_change();
create trigger audit_events_no_truncate before truncate on audit_events
  for each statement execute function forbid_change();

-- Written in the same transaction as the business change; a dispatcher sends them afterwards.
create table outbox (
  id bigint generated always as identity primary key,
  kind text not null,
  dedupe_key text not null unique,
  payload jsonb not null,
  status text not null default 'PENDING' check (status in ('PENDING','SENT','FAILED')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index outbox_pending_idx on outbox (created_at) where status = 'PENDING';
`,
};
