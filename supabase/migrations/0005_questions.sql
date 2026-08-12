-- 0005_questions.sql
-- question_categories, questions, question_options, question_role_scopes. See docs/02-DATABASE.md §6.

create table question_categories (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  label       text not null,
  description text,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table questions (
  id                    uuid primary key default gen_random_uuid(),
  category_id           uuid not null references question_categories(id) on delete restrict,
  key                   text not null unique,      -- stable machine key, immutable
  label                 text not null,
  help_text             text,
  placeholder           text,
  question_type         question_type not null,
  audience              question_audience not null default 'client',
  is_required           boolean not null default false,
  is_active             boolean not null default true,
  sort_order            int not null default 0,
  validation            jsonb not null default '{}'::jsonb,
  conditional_on_question_id uuid references questions(id),
  conditional_operator  text,      -- 'equals','not_equals','in','is_true','is_false'
  conditional_value     jsonb,
  answer_count          int not null default 0,    -- maintained by trigger
  created_by            uuid references users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz,
  constraint chk_conditional_complete check (
    (conditional_on_question_id is null and conditional_operator is null)
    or (conditional_on_question_id is not null and conditional_operator is not null)
  ),
  constraint chk_no_self_condition check (conditional_on_question_id is distinct from id)
);

create index idx_questions_category on questions(category_id) where is_active;

create table question_options (
  id          uuid primary key default gen_random_uuid(),
  question_id uuid not null references questions(id) on delete cascade,
  value       text not null,
  label       text not null,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  unique (question_id, value)
);

-- Scopes a question to specific role categories. No rows = universal question.
create table question_role_scopes (
  question_id      uuid not null references questions(id) on delete cascade,
  role_category_id uuid not null references role_categories(id) on delete cascade,
  primary key (question_id, role_category_id)
);
