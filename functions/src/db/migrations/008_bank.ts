import type { Migration } from '../migrate.js';

/**
 * Step 7: bank deposits matched to branch closes (BUILD_PLAN §7.2, "branch close → bank deposit →
 * bank statement match"). Money still moves only through journal batches:
 *
 *   recordBankDeposit   Debit CASH_IN_TRANSIT (branch, business)   Credit BRANCH_CASH (branch, business)
 *   matchBankDeposit    Debit BANK (bank account)                  Credit CASH_IN_TRANSIT (branch, business)
 *                       plus BRANCH_CASH_VARIANCE for any difference the bank line shows, with a case.
 *
 * Every table here is append-only: a deposit, its covered closes, a statement line, a match and an
 * "ignore" are facts, never edited. Status (UNMATCHED / MATCHED / IGNORED) is derived from them.
 * Database-enforced:
 *   - a deposit covers only closed days of its own branch and business, never more than the close counted;
 *   - the person who matches a deposit is not the person who recorded it;
 *   - a deposit and a statement line are matched at most once, and a line is either matched or ignored;
 *   - a deposit is matched only to a line of a bank account of its own business, dated on or after it.
 */
export const migration008Bank: Migration = {
  id: '008_bank',
  sql: /* sql */ `
alter table ledger_accounts drop constraint ledger_accounts_kind_check;
alter table ledger_accounts add constraint ledger_accounts_kind_check check (kind in (
  'MEMBER_SUSU', 'AGENT_CASH_CUSTODY', 'BRANCH_CASH', 'BRANCH_CASH_VARIANCE', 'OPENING_BALANCE_EQUITY',
  'CASH_IN_TRANSIT', 'BANK'
));

alter table cases drop constraint cases_kind_check;
alter table cases add constraint cases_kind_check
  check (kind in ('HANDOVER_DIFFERENCE', 'HANDOVER_DISPUTE', 'CLOSE_DIFFERENCE', 'OFF_ROUTE_COLLECTION', 'DEPOSIT_DIFFERENCE'));

-- ── Bank accounts: one business each ─────────────────────────────────────────

create table bank_accounts (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id),
  bank_name text not null,
  account_name text not null,
  -- Only the last four digits are stored; the full number stays with the client's finance team.
  account_number_last4 text not null check (account_number_last4 ~ '^[0-9]{4}$'),
  status text not null default 'ACTIVE' check (status in ('ACTIVE', 'CLOSED')),
  ledger_account_id uuid not null unique references ledger_accounts(id),
  created_by text not null,
  created_at timestamptz not null default now(),
  unique (business_id, bank_name, account_number_last4)
);
create function bank_accounts_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' or (new.id, new.business_id, new.bank_name, new.account_name, new.account_number_last4, new.ledger_account_id, new.created_by, new.created_at)
       is distinct from (old.id, old.business_id, old.bank_name, old.account_name, old.account_number_last4, old.ledger_account_id, old.created_by, old.created_at) then
    raise exception 'bank account %: only its status can change', old.id using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger bank_accounts_guard before update or delete on bank_accounts for each row execute function bank_accounts_guard();

-- ── Deposits: cash leaves the branch vault for the bank ─────────────────────

create table bank_deposits (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references branches(id),
  business_id uuid not null references businesses(id),
  bank_account_id uuid not null references bank_accounts(id),
  amount_pesewas bigint not null check (amount_pesewas > 0),
  slip_reference text not null check (length(slip_reference) between 1 and 64),
  deposited_on date not null,
  recorded_by text not null,
  recorded_at timestamptz not null default now(),
  note text,
  batch_id uuid not null unique references journal_batches(id),
  unique (bank_account_id, slip_reference)
);
create index bank_deposits_branch_idx on bank_deposits (branch_id, business_id, recorded_at);
create trigger bank_deposits_append_only before update or delete on bank_deposits for each row execute function refuse_change();

create table bank_deposit_days (
  deposit_id uuid not null references bank_deposits(id) deferrable initially deferred,
  branch_id uuid not null,
  business_id uuid not null,
  day date not null,
  amount_pesewas bigint not null check (amount_pesewas > 0),
  primary key (deposit_id, day),
  foreign key (branch_id, business_id, day) references branch_closes(branch_id, business_id, day)
);
create index bank_deposit_days_close_idx on bank_deposit_days (branch_id, business_id, day);
create trigger bank_deposit_days_append_only before update or delete on bank_deposit_days for each row execute function refuse_change();

-- The covered days sum to the deposit, belong to its branch and business, and never exceed what the close counted.
create function check_bank_deposit() returns trigger language plpgsql as $$
declare
  dep bank_deposits%rowtype;
  covered bigint;
begin
  select * into dep from bank_deposits where id = new.deposit_id;
  if dep.id is null then
    raise exception 'deposit % does not exist', new.deposit_id using errcode = 'P0001';
  end if;
  if new.branch_id <> dep.branch_id or new.business_id <> dep.business_id then
    raise exception 'deposit %: a covered day must be its own branch and business', dep.id using errcode = 'P0001';
  end if;
  select coalesce(sum(amount_pesewas), 0) into covered from bank_deposit_days where deposit_id = dep.id;
  if covered <> dep.amount_pesewas then
    raise exception 'deposit %: covered days total % but the deposit is %', dep.id, covered, dep.amount_pesewas using errcode = 'P0001';
  end if;
  if exists (
    select 1 from bank_deposit_days d join branch_closes c using (branch_id, business_id, day)
     where d.branch_id = new.branch_id and d.business_id = new.business_id and d.day = new.day
     group by c.counted_pesewas having sum(d.amount_pesewas) > c.counted_pesewas
  ) then
    raise exception 'deposit %: more than the close of % counted would be banked', dep.id, new.day using errcode = 'P0001';
  end if;
  return null;
end;
$$;
create constraint trigger bank_deposit_days_check after insert on bank_deposit_days
  deferrable initially deferred for each row execute function check_bank_deposit();

create function bank_deposit_has_days() returns trigger language plpgsql as $$
begin
  if not exists (select 1 from bank_deposit_days where deposit_id = new.id) then
    raise exception 'deposit %: it must cover at least one closed day', new.id using errcode = 'P0001';
  end if;
  return null;
end;
$$;
create constraint trigger bank_deposits_have_days after insert on bank_deposits
  deferrable initially deferred for each row execute function bank_deposit_has_days();

-- ── Bank statement lines, imported by finance ────────────────────────────────

create table bank_statement_lines (
  id uuid primary key default gen_random_uuid(),
  bank_account_id uuid not null references bank_accounts(id),
  line_date date not null,
  amount_pesewas bigint not null check (amount_pesewas <> 0),
  reference text not null default '',
  description text not null default '',
  balance_after_pesewas bigint,
  -- Same line in two overlapping imports ⇒ same hash ⇒ stored once.
  line_hash text not null,
  imported_by text not null,
  imported_at timestamptz not null default now(),
  import_id uuid not null,
  unique (bank_account_id, line_hash)
);
create index bank_statement_lines_account_idx on bank_statement_lines (bank_account_id, line_date);
create trigger bank_statement_lines_append_only before update or delete on bank_statement_lines for each row execute function refuse_change();

-- ── Matches and ignores ──────────────────────────────────────────────────────

create table bank_matches (
  id uuid primary key default gen_random_uuid(),
  deposit_id uuid not null unique references bank_deposits(id),
  statement_line_id uuid not null unique references bank_statement_lines(id),
  difference_pesewas bigint not null,
  matched_by text not null,
  matched_at timestamptz not null default now(),
  note text,
  case_id uuid references cases(id),
  batch_id uuid not null unique references journal_batches(id),
  check ((case_id is null) = (difference_pesewas = 0))
);
create trigger bank_matches_append_only before update or delete on bank_matches for each row execute function refuse_change();

create table bank_line_ignores (
  statement_line_id uuid primary key references bank_statement_lines(id),
  reason text not null check (length(reason) >= 3),
  ignored_by text not null,
  ignored_at timestamptz not null default now()
);
create trigger bank_line_ignores_append_only before update or delete on bank_line_ignores for each row execute function refuse_change();

create function check_bank_match() returns trigger language plpgsql as $$
declare
  dep bank_deposits%rowtype;
  line bank_statement_lines%rowtype;
begin
  select * into dep from bank_deposits where id = new.deposit_id;
  select * into line from bank_statement_lines where id = new.statement_line_id;
  if new.matched_by = dep.recorded_by then
    raise exception 'deposit %: the person who recorded it cannot match it', dep.id using errcode = 'P0001';
  end if;
  if line.bank_account_id <> dep.bank_account_id then
    raise exception 'deposit %: the statement line is from a different bank account', dep.id using errcode = 'P0001';
  end if;
  if line.amount_pesewas <= 0 then
    raise exception 'deposit %: only a credit (money in) can match a deposit', dep.id using errcode = 'P0001';
  end if;
  if line.line_date < dep.deposited_on then
    raise exception 'deposit %: the bank line is dated before the deposit', dep.id using errcode = 'P0001';
  end if;
  if new.difference_pesewas <> line.amount_pesewas - dep.amount_pesewas then
    raise exception 'deposit %: recorded difference does not equal bank minus deposit', dep.id using errcode = 'P0001';
  end if;
  if exists (select 1 from bank_line_ignores where statement_line_id = new.statement_line_id) then
    raise exception 'statement line % was set aside as not a deposit', new.statement_line_id using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger bank_matches_check before insert on bank_matches for each row execute function check_bank_match();

create function check_bank_ignore() returns trigger language plpgsql as $$
begin
  if exists (select 1 from bank_matches where statement_line_id = new.statement_line_id) then
    raise exception 'statement line % is already matched to a deposit', new.statement_line_id using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger bank_line_ignores_check before insert on bank_line_ignores for each row execute function check_bank_ignore();
`,
};
