-- 0009_events_and_ops.sql
-- events, notification_log, webhook_ingest_log, app_settings. See docs/02-DATABASE.md §10.

-- Immutable. No update or delete permitted; enforced by trigger and by revoked grants.
create table events (
  id           uuid primary key default gen_random_uuid(),
  entity_type  text not null,        -- 'requisition','assignment','client','candidate','question'
  entity_id    uuid not null,
  event_type   text not null,        -- 'stage_changed','presented','access_granted', ...
  actor_id     uuid references users(id),
  actor_role   user_role_key,
  from_value   text,
  to_value     text,
  metadata     jsonb not null default '{}'::jsonb,
  occurred_at  timestamptz not null default now()
);

create index idx_events_entity on events(entity_type, entity_id, occurred_at desc);
create index idx_events_type on events(event_type, occurred_at desc);

create table notification_log (
  id           uuid primary key default gen_random_uuid(),
  event        notification_event not null,
  recipient_email citext not null,
  recipient_user_id uuid references users(id),
  entity_type  text, entity_id uuid,
  payload      jsonb not null,
  provider     text not null default 'gohighlevel',
  provider_response jsonb,
  status       text not null default 'queued',   -- queued|sent|failed
  attempts     int not null default 0,
  last_error   text,
  created_at   timestamptz not null default now(),
  sent_at      timestamptz
);

create table webhook_ingest_log (
  id            uuid primary key default gen_random_uuid(),
  source        text not null,
  external_id   text,
  raw_payload   jsonb not null,
  result        text not null,        -- 'created'|'updated'|'rejected'
  candidate_id  uuid references candidates(id),
  error_detail  text,
  received_at   timestamptz not null default now()
);

create table app_settings (
  key         text primary key,
  value       jsonb not null,
  description text,
  updated_by  uuid references users(id),
  updated_at  timestamptz not null default now()
);
