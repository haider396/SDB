-- 0002_identity.sql
-- users, roles, permissions, role_permissions, user_roles. See docs/02-DATABASE.md §3.

create table users (
  id            uuid primary key,               -- mirrors auth.users.id
  email         citext not null unique,
  full_name     text not null,
  phone         text,
  avatar_path   text,
  timezone      text not null default 'UTC',
  is_active     boolean not null default true,
  last_login_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  archived_at   timestamptz
);

create table roles (
  id          uuid primary key default gen_random_uuid(),
  key         user_role_key not null unique,
  label       text not null,
  is_system   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table permissions (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,   -- e.g. 'candidate.present'
  label       text not null,
  domain      text not null           -- e.g. 'candidate'
);

create table role_permissions (
  role_id       uuid not null references roles(id) on delete cascade,
  permission_id uuid not null references permissions(id) on delete cascade,
  primary key (role_id, permission_id)
);

create table user_roles (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references users(id) on delete cascade,
  role_id    uuid not null references roles(id),
  scope_type text,                    -- null = global; 'client' for client-scoped
  scope_id   uuid,                    -- clients.id when scope_type = 'client'
  created_at timestamptz not null default now(),
  unique (user_id, role_id, scope_type, scope_id)
);

create index idx_user_roles_user on user_roles(user_id);
