import type { Migration } from '../migrate.js';

/**
 * Collection routes (BUILD_PLAN Step 4). Each Susu account is collected by at most one agent pair, at
 * an agreed amount per visit. Assignments are operational, not financial: they can be changed or
 * removed, and every change is in audit_events.
 *
 * The database itself refuses an assignment whose pair is in another branch than the account.
 */
export const migration003Routes: Migration = {
  id: '003_routes',
  sql: /* sql */ `
create table route_assignments (
  susu_account_id uuid primary key references susu_accounts(id),
  agent_pair_id uuid not null references agent_pairs(id),
  expected_pesewas bigint not null check (expected_pesewas > 0 and expected_pesewas <= 1000000),
  assigned_at timestamptz not null default now(),
  assigned_by text not null
);
create index route_assignments_pair_idx on route_assignments (agent_pair_id);

create function check_route_assignment_branch() returns trigger language plpgsql as $$
begin
  if (select branch_id from susu_accounts where id = new.susu_account_id)
     is distinct from (select branch_id from agent_pairs where id = new.agent_pair_id) then
    raise exception 'route assignment: agent pair % is not in the branch of account %', new.agent_pair_id, new.susu_account_id
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger route_assignments_same_branch
  before insert or update on route_assignments
  for each row execute function check_route_assignment_branch();
`,
};
