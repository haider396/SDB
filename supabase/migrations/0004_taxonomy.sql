-- 0004_taxonomy.sql
-- engines, departments, role_categories, tools, skills, industries. See docs/02-DATABASE.md §5.
-- Deviation from §5 DDL: `engines.description text` is added because §5 mandates seeding the
-- verbatim 5E engine definitions "as `description`", which requires the column to exist.

create table engines (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  label       text not null,
  description text,
  is_staffed  boolean not null default false,   -- false for Revenue, Leadership
  sort_order  int not null default 0,
  is_active   boolean not null default true
);

create table departments (
  id          uuid primary key default gen_random_uuid(),
  engine_id   uuid not null references engines(id) on delete restrict,
  key         text not null,
  label       text not null,
  manager_user_id uuid references users(id),   -- engine/department owner
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  unique (engine_id, key)
);

create table role_categories (
  id             uuid primary key default gen_random_uuid(),
  department_id  uuid not null references departments(id) on delete restrict,
  key            text not null,
  label          text not null,               -- internal name
  advertised_title text,                      -- public-facing title, may differ
  description    text,
  sort_order     int not null default 0,
  is_active      boolean not null default true,
  unique (department_id, key)
);

create table tools      (id uuid primary key default gen_random_uuid(), name text not null unique, category text, is_active boolean not null default true);
create table skills     (id uuid primary key default gen_random_uuid(), name text not null unique, category text, is_active boolean not null default true);
create table industries (id uuid primary key default gen_random_uuid(), name text not null unique, is_active boolean not null default true);
