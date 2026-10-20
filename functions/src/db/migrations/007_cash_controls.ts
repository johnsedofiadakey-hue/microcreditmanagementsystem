import type { Migration } from '../migrate.js';
import { BUSINESS_IDS } from './006_businesses.js';

/**
 * Audit 19 Oct H1–H3 and M3 (docs/audit/AUDIT-2026-10-19.md, REQUESTS #26–#29).
 *
 *   H1  Route history: every assignment is a period with a server start and end, so a posting can tell
 *       "on this pair's route now", "captured before it was reassigned away" and "never on this route".
 *       Collections record which, and off-route ones open a case (the cash is still posted: the member paid).
 *   H2  Collections carry the cash day they count towards. A collection that arrives after its business's
 *       branch day closed counts towards the next day; the closed day itself never changes.
 *   H3  An agent declares a handover from the phone (signed command, per-business amounts, immutable). A
 *       cashier confirms each business line independently. The database refuses a handover without a
 *       declaration line, or received by one of the pair's own agents.
 *   M3  Business modules: a business can only offer products of a module the client has switched on.
 */
export const migration007CashControls: Migration = {
  id: '007_cash_controls',
  sql: /* sql */ `
-- ── M3: business modules ─────────────────────────────────────────────────────

create table business_modules (
  business_id uuid not null references businesses(id),
  module text not null check (module in ('SUSU', 'LOANS', 'WELFARE')),
  enabled boolean not null,
  changed_by text not null,
  changed_at timestamptz not null default now(),
  reason text not null,
  primary key (business_id, module)
);
create trigger business_modules_no_delete before delete on business_modules for each row execute function refuse_change();
-- Stage 1 pilot (BUILD_PLAN §8, ADR-001): only Gadufia's Susu is live. STF loans and OPWS welfare wait for their stages.
insert into business_modules (business_id, module, enabled, changed_by, reason) values
  ('${BUSINESS_IDS.GADUFIA}', 'SUSU', true, 'migration:007', 'Stage 1 Susu pilot'),
  ('${BUSINESS_IDS.STF}', 'LOANS', false, 'migration:007', 'Stage 3'),
  ('${BUSINESS_IDS.OPWS}', 'WELFARE', false, 'migration:007', 'Stage 4');

-- ── Cases: new kinds ─────────────────────────────────────────────────────────

alter table cases drop constraint cases_kind_check;
alter table cases add constraint cases_kind_check
  check (kind in ('HANDOVER_DIFFERENCE', 'HANDOVER_DISPUTE', 'CLOSE_DIFFERENCE', 'OFF_ROUTE_COLLECTION'));

-- ── H1: route assignment history ─────────────────────────────────────────────

create table route_assignment_periods (
  id uuid primary key default gen_random_uuid(),
  susu_account_id uuid not null references susu_accounts(id),
  agent_pair_id uuid not null references agent_pairs(id),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  started_by text not null,
  ended_by text,
  check ((ended_at is null) = (ended_by is null)),
  check (ended_at is null or ended_at >= started_at)
);
-- At most one open period per account.
create unique index route_assignment_periods_open on route_assignment_periods (susu_account_id) where ended_at is null;
create index route_assignment_periods_pair on route_assignment_periods (susu_account_id, agent_pair_id, ended_at);

create function route_periods_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'route history is never deleted' using errcode = 'P0001';
  end if;
  if old.ended_at is not null
     or (new.id, new.susu_account_id, new.agent_pair_id, new.started_at, new.started_by)
        is distinct from (old.id, old.susu_account_id, old.agent_pair_id, old.started_at, old.started_by) then
    raise exception 'route period %: only ending an open period is allowed', old.id using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger route_periods_guard before update or delete on route_assignment_periods
  for each row execute function route_periods_guard();

insert into route_assignment_periods (susu_account_id, agent_pair_id, started_at, started_by)
  select susu_account_id, agent_pair_id, assigned_at, assigned_by from route_assignments;

-- ── H1 + H2: what each collection was posted as ──────────────────────────────

alter table collections
  add column business_id uuid references businesses(id),
  add column cash_day date,
  add column route_status text check (route_status in ('ON_ROUTE', 'PREVIOUS_ROUTE', 'OFF_ROUTE', 'BEFORE_ROUTE_CHECKS')),
  add column posted_after_close boolean not null default false,
  add column case_id uuid references cases(id);
update collections c
   set business_id = p.business_id,
       cash_day = (c.posted_at at time zone 'UTC')::date,
       route_status = 'BEFORE_ROUTE_CHECKS'
  from susu_accounts s join susu_products p on p.id = s.product_id
 where s.id = c.susu_account_id;
alter table collections alter column business_id set not null;
alter table collections alter column cash_day set not null;
alter table collections alter column route_status set not null;
alter table collections add constraint collections_off_route_case check ((route_status = 'OFF_ROUTE') = (case_id is not null));
create index collections_cash_day_idx on collections (branch_id, business_id, cash_day);
-- Collections are money records: never changed or deleted once posted.
create trigger collections_append_only before update or delete on collections for each row execute function refuse_change();

-- ── H3: agent declarations and independent confirmation ──────────────────────

alter table agent_commands drop constraint agent_commands_status_check;
-- RECORDED: accepted evidence that moves no money (a handover declaration).
alter table agent_commands add constraint agent_commands_status_check check (status in ('POSTED', 'REJECTED', 'RECORDED'));
alter table agent_commands add column record_id uuid;

create table handover_declarations (
  id uuid primary key references agent_commands(id) deferrable initially deferred,
  branch_id uuid not null references branches(id),
  agent_pair_id uuid not null references agent_pairs(id),
  agent_uid text not null,
  device_id text not null,
  captured_at timestamptz not null,
  received_at timestamptz not null default now()
);
create index handover_declarations_branch_idx on handover_declarations (branch_id, received_at);
create trigger handover_declarations_append_only before update or delete on handover_declarations
  for each row execute function refuse_change();

create table handover_declaration_lines (
  declaration_id uuid not null references handover_declarations(id),
  business_id uuid not null references businesses(id),
  declared_pesewas bigint not null check (declared_pesewas >= 0),
  -- Custody balance when the server received the declaration: evidence only.
  custody_at_declaration bigint not null,
  status text not null default 'DECLARED' check (status in ('DECLARED', 'CONFIRMED', 'SUPERSEDED')),
  handover_id uuid unique,
  closed_at timestamptz,
  primary key (declaration_id, business_id),
  check ((status = 'CONFIRMED') = (handover_id is not null)),
  check ((status = 'DECLARED') = (closed_at is null))
);
create index handover_declaration_lines_open on handover_declaration_lines (business_id, status);

create function declaration_lines_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'handover declarations are never deleted' using errcode = 'P0001';
  end if;
  if old.status <> 'DECLARED' or new.status = 'DECLARED'
     or (new.declaration_id, new.business_id, new.declared_pesewas, new.custody_at_declaration)
        is distinct from (old.declaration_id, old.business_id, old.declared_pesewas, old.custody_at_declaration) then
    raise exception 'declaration line %/%: only DECLARED → CONFIRMED | SUPERSEDED is allowed', old.declaration_id, old.business_id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger declaration_lines_guard before update or delete on handover_declaration_lines
  for each row execute function declaration_lines_guard();

drop trigger handovers_append_only on handovers;
alter table handovers add column declaration_id uuid references handover_declarations(id);
alter table handovers add column declared_pesewas bigint check (declared_pesewas >= 0);
alter table handovers add constraint handovers_declared_together check ((declaration_id is null) = (declared_pesewas is null));
-- A dispute (declared ≠ counted) also needs a case, not only a cash difference.
alter table handovers drop constraint handovers_check;
alter table handovers add constraint handovers_difference_needs_case
  check (case_id is not null or (counted_pesewas = expected_pesewas and (declared_pesewas is null or declared_pesewas = counted_pesewas)));
create trigger handovers_append_only before update or delete on handovers for each row execute function refuse_change();

-- From now on a handover needs the agent's declaration, and the receiver cannot be one of the pair's agents.
create function handovers_two_parties() returns trigger language plpgsql as $$
declare
  pair_agents text[];
begin
  if new.declaration_id is null then
    raise exception 'handover %: the agent pair must declare it from the phone first', new.id using errcode = 'P0001';
  end if;
  select array[agent_a_uid, agent_b_uid] into pair_agents from agent_pairs where id = new.agent_pair_id;
  if new.received_by = any(pair_agents) then
    raise exception 'handover %: an agent of the pair cannot receive their own cash', new.id using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from handover_declaration_lines l join handover_declarations d on d.id = l.declaration_id
     where l.declaration_id = new.declaration_id and l.business_id = new.business_id
       and l.handover_id = new.id and d.agent_pair_id = new.agent_pair_id
  ) then
    raise exception 'handover %: no matching declaration line', new.id using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create constraint trigger handovers_two_parties after insert on handovers
  deferrable initially deferred for each row execute function handovers_two_parties();
`,
};
