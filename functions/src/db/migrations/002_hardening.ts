import type { Migration } from '../migrate.js';

/**
 * Hardening from the first audit (docs/audit/AUDIT-2026-10-18.md). Everything here is enforced by the
 * database, so a bug in a future posting path or a manual fix by an operator cannot break it.
 *
 *   H1  A journal line can only be added to a batch created in the same transaction, and every batch
 *       a line touches is re-checked for balance at commit.
 *   L3  A reversal must mirror its original exactly (same accounts and amounts, sides swapped).
 *   M4  account_balances is maintained only by a trigger on journal_lines; direct writes are refused,
 *       and a non-negative account can never go below zero. Ledger account definitions are frozen.
 *   M5  A member's maker, Ghana Card, branch and consent are immutable; approval only moves a pending
 *       member to ACTIVE, once. Members are never deleted.
 *   M3  An agent can be in at most one active pair (agent_pair_members primary key).
 *   H2  Devices carry the public key that signs their commands.
 *
 * Note: the H1 same-transaction check compares the batch row's xmin with the top-level transaction
 * ID, so journal postings must not run inside a savepoint.
 */
export const migration002Hardening: Migration = {
  id: '002_hardening',
  sql: /* sql */ `
-- ── H1 + L3: batch balance and reversal checks, run for every batch a line touches ──────────

create function check_journal_batch(target uuid) returns void language plpgsql as $$
declare
  debits bigint;
  credits bigint;
  line_count int;
  original uuid;
begin
  select coalesce(sum(amount_pesewas) filter (where side = 'DEBIT'), 0),
         coalesce(sum(amount_pesewas) filter (where side = 'CREDIT'), 0),
         count(*)
    into debits, credits, line_count
    from journal_lines
   where batch_id = target;
  if line_count < 2 or debits <> credits then
    raise exception 'journal batch % is unbalanced (debits %, credits %, lines %)', target, debits, credits, line_count
      using errcode = 'P0001';
  end if;

  select reverses_batch_id into original from journal_batches where id = target;
  if original is not null and exists (
    (select account_id, case side when 'DEBIT' then 'CREDIT' else 'DEBIT' end as side, amount_pesewas
       from journal_lines where batch_id = original
     except all
     select account_id, side, amount_pesewas from journal_lines where batch_id = target)
    union all
    (select account_id, side, amount_pesewas from journal_lines where batch_id = target
     except all
     select account_id, case side when 'DEBIT' then 'CREDIT' else 'DEBIT' end, amount_pesewas
       from journal_lines where batch_id = original)
  ) then
    raise exception 'journal batch % does not mirror the batch it reverses (%)', target, original
      using errcode = 'P0001';
  end if;
end;
$$;

create or replace function assert_batch_balanced() returns trigger language plpgsql as $$
begin
  perform check_journal_batch(new.id);
  return null;
end;
$$;

create function assert_line_batch_balanced() returns trigger language plpgsql as $$
begin
  perform check_journal_batch(new.batch_id);
  return null;
end;
$$;

create constraint trigger journal_line_batch_balanced
  after insert on journal_lines
  deferrable initially deferred
  for each row execute function assert_line_batch_balanced();

create function journal_line_same_transaction() returns trigger language plpgsql as $$
declare
  batch_xmin xid;
begin
  select xmin into batch_xmin from journal_batches where id = new.batch_id;
  if batch_xmin is null then
    raise exception 'journal batch % does not exist', new.batch_id using errcode = 'P0001';
  end if;
  if not (batch_xmin = pg_current_xact_id()::xid) then
    raise exception 'journal batch % is already committed; post a new batch instead', new.batch_id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger journal_lines_same_transaction before insert on journal_lines
  for each row execute function journal_line_same_transaction();

-- ── M4: balances follow the journal and nothing else ────────────────────────────────────────

create function apply_journal_line() returns trigger language plpgsql as $$
declare
  normal text;
begin
  select normal_side into normal from ledger_accounts where id = new.account_id;
  update account_balances
     set balance_pesewas = balance_pesewas
           + case when new.side = normal then new.amount_pesewas else -new.amount_pesewas end,
         version = version + 1,
         updated_at = now()
   where account_id = new.account_id;
  if not found then
    raise exception 'ledger account % has no balance row', new.account_id using errcode = 'P0001';
  end if;
  return null;
end;
$$;

create trigger journal_lines_apply after insert on journal_lines
  for each row execute function apply_journal_line();

create function guard_account_balance() returns trigger language plpgsql as $$
declare
  negative_allowed boolean;
begin
  if tg_op = 'DELETE' or tg_op = 'TRUNCATE' then
    raise exception 'account_balances rows cannot be deleted' using errcode = 'P0001';
  end if;
  if tg_op = 'INSERT' then
    if new.balance_pesewas <> 0 or new.version <> 0 then
      raise exception 'a new account balance starts at zero' using errcode = 'P0001';
    end if;
    return new;
  end if;
  -- Depth 1 = a statement aimed at account_balances directly; depth 2 = apply_journal_line.
  if pg_trigger_depth() < 2 then
    raise exception 'account_balances is maintained from journal_lines; post a journal batch instead'
      using errcode = 'P0001';
  end if;
  if new.account_id <> old.account_id then
    raise exception 'account_balances.account_id is immutable' using errcode = 'P0001';
  end if;
  select allow_negative into negative_allowed from ledger_accounts where id = new.account_id;
  if new.balance_pesewas < 0 and not negative_allowed then
    raise exception 'ledger account % cannot go below zero', new.account_id using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger account_balances_guard before insert or update or delete on account_balances
  for each row execute function guard_account_balance();
create trigger account_balances_no_truncate before truncate on account_balances
  for each statement execute function guard_account_balance();

create function guard_ledger_account() returns trigger language plpgsql as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'ledger accounts cannot be deleted' using errcode = 'P0001';
  end if;
  if new.id <> old.id or new.kind <> old.kind
     or new.owner_id is distinct from old.owner_id or new.branch_id is distinct from old.branch_id
     or new.account_type <> old.account_type or new.normal_side <> old.normal_side
     or new.allow_negative <> old.allow_negative then
    raise exception 'ledger account definitions are immutable; only status and name can change'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger ledger_accounts_guard before update or delete on ledger_accounts
  for each row execute function guard_ledger_account();
create trigger ledger_accounts_no_truncate before truncate on ledger_accounts
  for each statement execute function guard_ledger_account();

-- ── M5: members ─────────────────────────────────────────────────────────────────────────────

create function guard_member() returns trigger language plpgsql as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception 'members are never deleted; close them instead' using errcode = 'P0001';
  end if;
  if new.id <> old.id or new.created_by <> old.created_by or new.created_at <> old.created_at
     or new.ghana_card_number <> old.ghana_card_number or new.branch_id <> old.branch_id
     or new.consent_at <> old.consent_at then
    raise exception 'member maker, Ghana Card, branch and consent are immutable' using errcode = 'P0001';
  end if;
  if old.approved_by is not null
     and (new.approved_by is distinct from old.approved_by or new.approved_at is distinct from old.approved_at) then
    raise exception 'a member approval cannot be changed' using errcode = 'P0001';
  end if;
  if old.approved_by is null and new.approved_by is not null
     and not (old.status = 'PENDING_APPROVAL' and new.status = 'ACTIVE') then
    raise exception 'approval must move a pending member to ACTIVE' using errcode = 'P0001';
  end if;
  if old.status = 'PENDING_APPROVAL' and new.status = 'ACTIVE' and old.approved_by is null and new.approved_by is null then
    raise exception 'a member can only become ACTIVE through approval' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger members_guard before update or delete on members
  for each row execute function guard_member();
create trigger members_no_truncate before truncate on members
  for each statement execute function guard_member();

-- ── M3: one active pair per agent ───────────────────────────────────────────────────────────

create table agent_pair_members (
  agent_uid text primary key references staff_users(uid),
  agent_pair_id uuid not null references agent_pairs(id),
  joined_at timestamptz not null default now()
);
create index agent_pair_members_pair_idx on agent_pair_members (agent_pair_id);

insert into agent_pair_members (agent_uid, agent_pair_id)
  select agent_a_uid, id from agent_pairs where status = 'ACTIVE'
  on conflict (agent_uid) do nothing;
insert into agent_pair_members (agent_uid, agent_pair_id)
  select agent_b_uid, id from agent_pairs where status = 'ACTIVE'
  on conflict (agent_uid) do nothing;

-- ── H2: device keys ─────────────────────────────────────────────────────────────────────────

alter table devices add column public_key text;
alter table devices add column key_fingerprint text;
alter table devices add column enrolled_at timestamptz;
`,
};
