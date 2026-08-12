-- 0003_clients.sql
-- clients, client_members, partial unique indexes, payment-gate constraint. See docs/02-DATABASE.md §4.

create table clients (
  id                        uuid primary key default gen_random_uuid(),
  company_name              text not null,
  website                   text,
  industry                  text,
  team_size_band            text,
  company_timezone          text,
  status                    client_status not null default 'prospect',
  service_tier              service_tier,
  payment_confirmed_at      timestamptz,
  invoice_reference         text,
  portal_access_enabled_at  timestamptz,
  portal_access_enabled_by  uuid references users(id),
  onboarding_readiness_note text,
  internal_notes            text,
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  archived_at               timestamptz,
  constraint chk_access_requires_payment
    check (portal_access_enabled_at is null or payment_confirmed_at is not null)
);

create table client_members (
  id                 uuid primary key default gen_random_uuid(),
  client_id          uuid not null references clients(id) on delete cascade,
  user_id            uuid not null references users(id) on delete cascade,
  is_primary_contact boolean not null default false,
  is_principal       boolean not null default false,
  job_title          text,
  invited_by         uuid references users(id),
  invited_at         timestamptz,
  accepted_at        timestamptz,
  created_at         timestamptz not null default now(),
  unique (client_id, user_id)
);

create unique index idx_one_primary_contact_per_client
  on client_members(client_id) where is_primary_contact;
create unique index idx_one_principal_per_client
  on client_members(client_id) where is_principal;
