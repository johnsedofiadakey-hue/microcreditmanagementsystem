import type { Migration } from '../migrate.js';

/**
 * SMS dispatch (BUILD_PLAN Step 5). The outbox row written in the posting transaction is the only
 * source of truth for "a receipt is owed". The dispatcher claims rows with SKIP LOCKED and a lease, so
 * two runs never send the same row at the same time; a run that dies mid-send leaves the lease to
 * expire and the row is tried again (at-least-once — the provider gets our dedupe key as reference).
 *
 *   PENDING  waiting for (next_attempt_at <= now)
 *   SENDING  claimed until lease_until
 *   SENT     the provider accepted it (provider_message_id); delivery_status is filled by reports
 *   FAILED   gave up after max attempts, or the provider refused it permanently (e.g. invalid number)
 *
 * Rows are never deleted. Only dispatch fields change; kind, dedupe_key and payload are frozen.
 */
export const migration004OutboxDispatch: Migration = {
  id: '004_outbox_dispatch',
  sql: /* sql */ `
alter table outbox drop constraint outbox_status_check;
alter table outbox add constraint outbox_status_check check (status in ('PENDING','SENDING','SENT','FAILED'));
alter table outbox
  add column next_attempt_at timestamptz not null default now(),
  add column lease_until timestamptz,
  add column provider text,
  add column provider_message_id text,
  add column delivery_status text,
  add column delivered_at timestamptz;

drop index outbox_pending_idx;
create index outbox_due_idx on outbox (next_attempt_at, id) where status in ('PENDING', 'SENDING');
create index outbox_provider_message_idx on outbox (provider, provider_message_id) where provider_message_id is not null;

create function outbox_frozen_fields() returns trigger language plpgsql as $$
begin
  if new.kind is distinct from old.kind or new.dedupe_key is distinct from old.dedupe_key
     or new.payload is distinct from old.payload or new.created_at is distinct from old.created_at then
    raise exception 'outbox %: kind, dedupe_key, payload and created_at cannot change', old.id using errcode = 'P0001';
  end if;
  if old.status in ('SENT', 'FAILED') and new.status is distinct from old.status then
    raise exception 'outbox %: a % message cannot change status', old.id, old.status using errcode = 'P0001';
  end if;
  return new;
end;
$$;
create trigger outbox_frozen before update on outbox for each row execute function outbox_frozen_fields();

create function outbox_no_delete() returns trigger language plpgsql as $$
begin
  raise exception 'outbox rows are never deleted' using errcode = 'P0001';
end;
$$;
create trigger outbox_no_delete before delete on outbox for each row execute function outbox_no_delete();
`,
};
