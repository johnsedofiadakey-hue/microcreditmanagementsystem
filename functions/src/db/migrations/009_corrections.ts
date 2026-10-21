import type { Migration } from '../migrate.js';

/**
 * Corrections and disputes (client guide §10; audit 18 Oct M5). A posted collection is never edited:
 * a staff member requests a correction, a DIFFERENT authorised person decides it, and only an
 * approval posts money — in the same transaction, with the journal batch tied to that approval.
 *
 *   correction_requests  the maker's request, immutable
 *   approvals            one decision per subject (APPROVED | REJECTED), immutable, generic so later
 *                        maker-checker flows (loans, write-offs) reuse it
 *
 * Database-enforced:
 *   - nothing here is ever updated or deleted;
 *   - the decider is never the requester;
 *   - an APPROVED correction carries the batch it posted, and that batch names the requester as
 *     actor and the decider as approver (so a ledger correction cannot exist without its approval);
 *   - a collection is corrected at most once (one APPROVED correction per collection);
 *   - a MOVE names a target account, other kinds do not; amounts are positive and never more than
 *     the collection.
 */
export const migration009Corrections: Migration = {
  id: '009_corrections',
  sql: /* sql */ `
create table correction_requests (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('REVERSE_COLLECTION', 'REDUCE_COLLECTION', 'MOVE_COLLECTION')),
  collection_id uuid not null references collections(id),
  branch_id uuid not null references branches(id),
  business_id uuid not null references businesses(id),
  -- What leaves the collected member's account: the whole collection (REVERSE, MOVE) or the excess (REDUCE).
  amount_pesewas bigint not null check (amount_pesewas > 0),
  to_susu_account_id uuid references susu_accounts(id),
  reason text not null check (length(reason) >= 10),
  needs_head_office boolean not null,
  requested_by text not null,
  requested_at timestamptz not null default now(),
  check ((kind = 'MOVE_COLLECTION') = (to_susu_account_id is not null))
);
create index correction_requests_branch_idx on correction_requests (branch_id, requested_at);
create index correction_requests_collection_idx on correction_requests (collection_id);
create trigger correction_requests_append_only before update or delete on correction_requests
  for each row execute function refuse_change();

create function check_correction_request() returns trigger language plpgsql as $$
declare
  c collections%rowtype;
begin
  select * into c from collections where id = new.collection_id;
  if new.branch_id <> c.branch_id or new.business_id <> c.business_id then
    raise exception 'correction %: branch and business must be the collection''s', new.id using errcode = 'P0001';
  end if;
  if new.amount_pesewas > c.amount_pesewas
     or (new.kind in ('REVERSE_COLLECTION', 'MOVE_COLLECTION') and new.amount_pesewas <> c.amount_pesewas)
     or (new.kind = 'REDUCE_COLLECTION' and new.amount_pesewas >= c.amount_pesewas) then
    raise exception 'correction %: amount does not fit a % of %', new.id, new.kind, c.amount_pesewas using errcode = 'P0001';
  end if;
  if new.to_susu_account_id = c.susu_account_id then
    raise exception 'correction %: cannot move a collection to the same account', new.id using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger correction_requests_check before insert on correction_requests
  for each row execute function check_correction_request();

-- ── Generic, append-only maker-checker decisions ─────────────────────────────

create table approvals (
  id uuid primary key default gen_random_uuid(),
  subject_kind text not null check (subject_kind in ('CORRECTION')),
  subject_id uuid not null,
  decision text not null check (decision in ('APPROVED', 'REJECTED')),
  decided_by text not null,
  decided_at timestamptz not null default now(),
  reason text,
  batch_id uuid unique references journal_batches(id),
  unique (subject_kind, subject_id),
  check ((decision = 'APPROVED') = (batch_id is not null)),
  check ((decision = 'REJECTED') = (reason is not null and length(reason) >= 3))
);
create trigger approvals_append_only before update or delete on approvals
  for each row execute function refuse_change();
create trigger approvals_no_truncate before truncate on approvals
  for each statement execute function forbid_change();

create function check_approval() returns trigger language plpgsql as $$
declare
  req correction_requests%rowtype;
  batch journal_batches%rowtype;
begin
  if new.subject_kind = 'CORRECTION' then
    select * into req from correction_requests where id = new.subject_id;
    if req.id is null then
      raise exception 'approval: correction % does not exist', new.subject_id using errcode = 'P0001';
    end if;
    if new.decided_by = req.requested_by then
      raise exception 'approval: the person who requested correction % cannot decide it', req.id using errcode = 'P0001';
    end if;
    if new.decision = 'APPROVED' then
      select * into batch from journal_batches where id = new.batch_id;
      if batch.actor_uid is distinct from req.requested_by or batch.approved_by is distinct from new.decided_by then
        raise exception 'approval: batch % must name the requester as actor and the decider as approver', new.batch_id
          using errcode = 'P0001';
      end if;
      if exists (
        select 1 from approvals a join correction_requests r on r.id = a.subject_id
         where a.subject_kind = 'CORRECTION' and a.decision = 'APPROVED' and r.collection_id = req.collection_id
      ) then
        raise exception 'approval: collection % is already corrected', req.collection_id using errcode = 'P0001';
      end if;
    end if;
  end if;
  return new;
end;
$$;
create trigger approvals_check before insert on approvals for each row execute function check_approval();
`,
};
