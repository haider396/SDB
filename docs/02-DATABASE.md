# 02 — Database

## 1. Platform decision

**Postgres 15 via Supabase.** Rationale: the client already owns a Supabase project; Supabase Auth, Storage, and Postgres in one platform removes an integration; row-level security gives a genuine second layer of tenant isolation; and `jsonb` plus native enums cover the flexible-configuration needs without a second datastore.

**No secondary datastore.** No Redis, no Mongo, no separate search index in MVP. Postgres full-text search over `candidates.cv_search` is sufficient at the stated scale (NFR-3).

**Extensions required:**

```sql
create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "citext";     -- case-insensitive email
create extension if not exists "pg_trgm";    -- fuzzy name search
```

---

## 2. Enums

```sql
create type user_role_key as enum ('super_admin','admin','client_admin','client_user');

create type client_status as enum ('prospect','active','inactive','archived');

create type service_tier as enum ('standard_placement','handheld_six_month');

create type requisition_status as enum (
  'submitted','pending_principal_approval','changes_requested','sourcing',
  'candidates_presented','interviewing','offer_extended','placed',
  'on_hold','closed_unfilled'
);

create type assignment_stage as enum (
  'sourced','screened','vetted','presented','client_reviewing',
  'interview_scheduled','interviewed','offer','placed',
  'rejected_by_admin','rejected_by_client','withdrawn','closed_not_selected'
);

create type rejection_actor as enum ('admin','client');

create type question_type as enum (
  'short_text','long_text','email','phone','number','currency_range',
  'single_select','multi_select','yes_no','date','scale','file_upload'
);

create type question_audience as enum ('client','internal');

create type proficiency_level as enum ('aware','working','proficient','expert');

create type language_level as enum ('basic','conversational','professional','native_equivalent');

create type accent_strength as enum ('none','light','moderate','heavy');

create type rate_unit as enum ('hourly','monthly');

create type engagement_type as enum ('full_time','part_time','project');

create type pool_status as enum ('active','passive','placed','unavailable','do_not_use');

create type vetting_status as enum ('not_started','in_progress','passed','failed');

create type employment_status as enum ('employed','available','serving_notice');

create type autonomy_level as enum ('needs_direction','balanced','fully_autonomous');

create type seniority_level as enum ('junior','mid','senior','lead');

create type candidate_file_type as enum (
  'cv','photo','video_intro','voice_sample','writing_sample',
  'portfolio','certificate','assessment_report','speedtest','other'
);

create type candidate_source as enum (
  'linkedin','upwork','referral','partner_recruiter','inbound','webhook','import','other'
);

create type submission_channel as enum ('manual','webhook','csv_import');

create type data_completeness as enum ('complete','incomplete');

create type workspace_type as enum ('dedicated_home_office','shared_space','coworking','unknown');

create type interview_outcome as enum ('pending','passed','failed','no_show','rescheduled','cancelled');

create type placement_status as enum ('active','ended_by_client','ended_by_candidate','completed');

create type notification_event as enum (
  'intake_submitted','portal_invitation','principal_approval_requested',
  'candidates_presented','client_decision_recorded','interview_scheduled',
  'requisition_status_changed'
);
```

---

## 3. Identity, roles, permissions

The permission model is granular from day one so a scoped `recruiter` role can be added later as data, not as a refactor.

```sql
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
```

**Permission keys to seed** (exhaustive for MVP):

```
client.view, client.create, client.update, client.grant_access, client.invite_user
requisition.view, requisition.create, requisition.update, requisition.transition,
  requisition.approve_as_principal, requisition.view_commercials
candidate.view, candidate.create, candidate.update, candidate.view_pii,
  candidate.assign, candidate.present, candidate.reject
assignment.view, assignment.advance, assignment.reject
interview.view, interview.create, interview.update
question.view, question.manage
settings.manage, user.manage, event.view
```

**Role → permission mapping to seed:**

| Role | Permissions |
|---|---|
| `super_admin` | All of the above |
| `admin` | All except `settings.manage`, `user.manage`. **Amended by migration 0027 (client-approved):** at v1.1 `question.manage` was also excluded; it is now granted, because the candidate form builder reuses that key and an admin could otherwise open the builder and be refused every save |
| `client_admin` | `client.view` (own), `client.invite_user`, `requisition.view`, `requisition.create`, `requisition.approve_as_principal`, `candidate.view`, `assignment.view`, `assignment.reject`, `interview.view` |
| `client_user` | Same as `client_admin` minus `client.invite_user` and `requisition.approve_as_principal` |

---

## 4. Clients and membership

```sql
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
```

`chk_access_requires_payment` enforces the payment gate at the database level, so it holds even if application code is wrong.

---

## 5. Taxonomy

```sql
create table engines (
  id          uuid primary key default gen_random_uuid(),
  key         text not null unique,
  label       text not null,
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
```

Seed `engines` with all five, `is_staffed = true` only for Client Experience, Operations, Brand. Official definitions, taken verbatim from the client's own 5E diagnostic, to be seeded as `description`:

| Engine | `is_staffed` | Description |
|---|---|---|
| Revenue | false | How your business attracts clients and generates consistent income |
| Brand | **true** | How the market perceives you and whether it builds trust before a call |
| Client Experience | **true** | How you deliver, retain clients, and turn them into advocates |
| Operations | **true** | The systems and structure that keep the business moving without you |
| Leadership | false | Your ability to lead the company instead of just running inside it |

Departments and role categories are seeded empty — the client populates them through the admin UI.

---

## 6. Intake question engine

See `03-INTAKE-FORM-ENGINE.md` for the full rationale and admin behaviour. Schema:

```sql
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
```

`validation` jsonb accepted keys, validated by a Zod schema in `packages/contracts`:

```jsonc
{
  "minLength": 0, "maxLength": 5000,
  "min": 0, "max": 1000000,
  "minSelections": 1, "maxSelections": 5,
  "pattern": "^[0-9]{4}$",
  "scaleMin": 1, "scaleMax": 5, "scaleMinLabel": "Low", "scaleMaxLabel": "High",
  "currency": "USD", "allowedUnits": ["hourly","monthly"],
  "acceptedMimeTypes": ["application/pdf"], "maxFileSizeMb": 25
}
```

Unknown keys are rejected on write with `422 INVALID_VALIDATION_RULE`.

### 6.1 Answers

```sql
create table requisition_answers (
  id             uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references requisitions(id) on delete cascade,
  question_id    uuid not null references questions(id) on delete restrict,
  question_key   text not null,          -- denormalised for stable reporting
  value_text     text,
  value_number   numeric(14,2),
  value_boolean  boolean,
  value_date     date,
  value_json     jsonb,                  -- currency_range, file refs, scale metadata
  question_snapshot jsonb not null,      -- label, type, options AS AT answer time
  answered_by    uuid references users(id),   -- null for public intake
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (requisition_id, question_id)
);

create index idx_answers_requisition on requisition_answers(requisition_id);
create index idx_answers_question_key on requisition_answers(question_key);
create index idx_answers_text_trgm on requisition_answers using gin (value_text gin_trgm_ops);

create table requisition_answer_options (
  answer_id uuid not null references requisition_answers(id) on delete cascade,
  option_id uuid not null references question_options(id) on delete restrict,
  primary key (answer_id, option_id)
);
```

**Exactly-one-value constraint**, enforced by trigger `trg_answer_value_shape` (function in migration 0006):

| question_type | Populated column |
|---|---|
| short_text, long_text, email, phone | `value_text` |
| number, scale | `value_number` |
| yes_no | `value_boolean` |
| date | `value_date` |
| single_select | `value_text` (the option value) + one `requisition_answer_options` row |
| multi_select | `value_json` (array of option values) + N `requisition_answer_options` rows |
| currency_range | `value_json` — `{ "min": n, "max": n, "unit": "hourly", "currency": "USD" }` |
| file_upload | `value_json` — `{ "fileIds": ["uuid"] }` |

The trigger raises `check_violation` if more than one value column is non-null, or if the populated column does not match the question's type.

---

## 7. Requisitions

```sql
create table requisitions (
  id                      uuid primary key default gen_random_uuid(),
  reference               text not null unique,      -- 'REQ-000123', generated
  client_id               uuid not null references clients(id) on delete restrict,
  engine_id               uuid references engines(id),
  department_id           uuid references departments(id),
  role_category_id        uuid references role_categories(id),
  primary_role_category_id uuid references role_categories(id),
  secondary_specialisation_id uuid references role_categories(id),
  advertised_title        text,
  headcount               int not null default 1 check (headcount >= 1),
  status                  requisition_status not null default 'submitted',
  service_tier            service_tier,
  seniority_level         seniority_level,
  budget_min              numeric(12,2),
  budget_max              numeric(12,2),
  budget_unit             rate_unit,
  budget_currency         char(3) default 'USD',
  budget_is_flexible      boolean,
  engagement_type         engagement_type,
  hours_per_week          int,
  overlap_start           time,
  overlap_end             time,
  overlap_timezone        text,
  target_start_date       date,
  urgency                 text,
  region_preference       text,
  english_spoken_required language_level,
  english_written_required language_level,
  max_accent_strength     accent_strength,
  brief_markdown          text,                      -- admin-authored brief
  intake_completed_by     uuid references users(id), -- null for public submission
  intake_contact_name     text,
  intake_contact_email    citext,
  principal_user_id       uuid references users(id),
  principal_approved_at   timestamptz,
  principal_change_request text,
  submitted_at            timestamptz not null default now(),
  sourcing_started_at     timestamptz,
  closed_at              timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  archived_at             timestamptz,
  constraint chk_budget_order check (budget_min is null or budget_max is null or budget_min <= budget_max)
);

create index idx_requisitions_client on requisitions(client_id);
create index idx_requisitions_status on requisitions(status) where archived_at is null;
```

`budget_unit` is mandatory whenever a budget amount is present — enforced in the API layer, because clients quote hourly and recruiters quote monthly and the two must never share an unlabelled column.

---

## 8. Candidates

### 8.1 Core

```sql
create table candidates (
  id                  uuid primary key default gen_random_uuid(),
  reference           text not null unique,          -- 'CAN-000123'
  external_id         text unique,                   -- webhook idempotency key
  first_name          text not null,
  last_name           text not null,
  preferred_name      text,
  display_name        text generated always as (
                        coalesce(preferred_name, first_name) || ' ' || left(last_name,1) || '.'
                      ) stored,
  email               citext,
  phone               text,
  whatsapp            text,
  linkedin_url        text,
  portfolio_url       text,
  photo_path          text,
  country             text,
  region_state        text,
  city                text,
  timezone            text,
  nationality         text,
  relocation_status   text,

  -- language & communication
  english_spoken_level   language_level,
  english_written_level  language_level,
  accent_strength        accent_strength,
  accent_notes           text,
  language_assessed_by   uuid references users(id),
  language_assessed_at   timestamptz,

  -- professional
  years_experience_total    numeric(4,1),
  years_experience_relevant numeric(4,1),
  current_title             text,
  current_employer          text,
  employment_status         employment_status,
  notice_period_days        int,
  available_from            date,
  seniority_level           seniority_level,
  engine_id                 uuid references engines(id),
  primary_role_category_id  uuid references role_categories(id),
  secondary_specialisation_id uuid references role_categories(id),
  has_management_experience boolean,
  team_size_managed         int,
  has_client_facing_experience boolean,
  has_us_client_experience  boolean,
  remote_experience_years   numeric(4,1),

  -- skills summary
  ai_tool_proficiency  proficiency_level,
  typing_wpm           int,
  tech_literacy_rating int check (tech_literacy_rating between 1 and 5),

  -- compensation
  expected_rate_amount numeric(12,2),
  expected_rate_unit   rate_unit,
  expected_rate_currency char(3) default 'USD',
  rate_min             numeric(12,2),
  rate_max             numeric(12,2),
  is_rate_negotiable   boolean,
  current_rate_amount  numeric(12,2),
  current_rate_unit    rate_unit,
  engagement_types     engagement_type[],
  hours_available_per_week int,
  overlap_start        time,
  overlap_end          time,
  overlap_timezone     text,
  max_concurrent_clients int default 1,

  -- remote environment
  internet_down_mbps   numeric(7,2),
  internet_up_mbps     numeric(7,2),
  has_backup_internet  boolean,
  has_backup_power     boolean,
  computer_specs       text,
  has_dual_monitor     boolean,
  headset_quality      text,
  workspace            workspace_type default 'unknown',
  is_quiet_environment_verified boolean,

  -- vetting & fit
  vetting_status       vetting_status not null default 'not_started',
  vetted_by            uuid references users(id),
  vetted_at            timestamptz,
  screening_call_at    timestamptz,
  recruiter_rating     int check (recruiter_rating between 1 and 5),
  recruiter_recommendation text,          -- client-visible
  strengths            text,              -- client-visible
  watch_points         text,              -- internal
  red_flags            text,              -- internal
  autonomy             autonomy_level,
  can_manage_up        boolean,
  proactivity_rating   int check (proactivity_rating between 1 and 5),
  attention_to_detail_rating int check (attention_to_detail_rating between 1 and 5),
  communication_rating int check (communication_rating between 1 and 5),
  energy_presentation_rating int check (energy_presentation_rating between 1 and 5),
  sales_background_weight text,           -- 'none','light','moderate','heavy'
  has_ops_background   boolean,
  has_entrepreneurial_ambition boolean,
  are_references_checked boolean not null default false,
  background_check_status text,

  -- source & provenance
  source            candidate_source not null default 'manual'::text::candidate_source,
  source_detail     text,
  sourced_by        uuid references users(id),
  submitted_via     submission_channel not null default 'manual',
  external_system   text,
  first_contacted_at timestamptz,
  responsiveness_rating int check (responsiveness_rating between 1 and 5),
  last_activity_at  timestamptz,
  data_completeness data_completeness not null default 'complete',

  -- consent
  has_consent_to_share_profile boolean not null default false,
  consent_captured_at timestamptz,
  consent_source      text,
  retention_until     date,
  do_not_present_to_client_ids uuid[] not null default '{}',

  pool_status       pool_status not null default 'active',
  cv_primary_file_id uuid,
  cv_search         tsvector,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  archived_at       timestamptz
);

create index idx_candidates_pool on candidates(pool_status) where archived_at is null;
create index idx_candidates_role on candidates(primary_role_category_id);
create index idx_candidates_country on candidates(country);
create index idx_candidates_cv_search on candidates using gin(cv_search);
create index idx_candidates_name_trgm on candidates using gin ((first_name || ' ' || last_name) gin_trgm_ops);
```

### 8.2 Candidate child tables

```sql
create table candidate_languages (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  language text not null, spoken_level language_level, written_level language_level,
  is_native boolean not null default false,
  unique (candidate_id, language)
);

create table candidate_tools (
  candidate_id uuid not null references candidates(id) on delete cascade,
  tool_id uuid not null references tools(id) on delete restrict,
  proficiency proficiency_level not null,
  years_used numeric(4,1), last_used_year int,
  primary key (candidate_id, tool_id)
);

create table candidate_skills (
  candidate_id uuid not null references candidates(id) on delete cascade,
  skill_id uuid not null references skills(id) on delete restrict,
  proficiency proficiency_level not null,
  verified_by uuid references users(id), verified_at timestamptz,
  primary key (candidate_id, skill_id)
);

create table candidate_industries (
  candidate_id uuid not null references candidates(id) on delete cascade,
  industry_id uuid not null references industries(id) on delete restrict,
  years numeric(4,1),
  primary key (candidate_id, industry_id)
);

create table candidate_employment_history (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  employer text not null, title text not null,
  start_date date, end_date date, is_current boolean not null default false,
  responsibilities text, reason_for_leaving text,   -- internal only
  sort_order int not null default 0
);

create table candidate_education (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  institution text not null, degree text, field_of_study text,
  country text, start_year int, end_year int
);

create table candidate_certifications (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  name text not null, issuer text, issued_date date, expires_date date, credential_url text
);

create table candidate_references (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  referee_name text not null, relationship text, company text, contact text,
  checked_by uuid references users(id), checked_at timestamptz,
  outcome text, notes text
);

create table candidate_files (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  file_type candidate_file_type not null,
  storage_path text not null,
  original_filename text not null,
  mime_type text not null,
  size_bytes bigint not null,
  is_client_visible boolean not null default false,
  virus_scan_status text not null default 'pending',
  uploaded_by uuid references users(id),
  uploaded_at timestamptz not null default now()
);

create index idx_candidate_files_candidate on candidate_files(candidate_id);

create table candidate_notes (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  author_id uuid not null references users(id),
  body text not null,
  is_client_visible boolean not null default false,
  created_at timestamptz not null default now()
);

-- Structured deal-breaker checks. Turns Rebecca's disqualifier list into reportable data.
create table disqualifiers (
  id uuid primary key default gen_random_uuid(),
  key text not null unique, label text not null,
  role_category_id uuid references role_categories(id),  -- null = applies to all
  is_active boolean not null default true, sort_order int not null default 0
);

create table candidate_disqualifier_checks (
  candidate_id uuid not null references candidates(id) on delete cascade,
  disqualifier_id uuid not null references disqualifiers(id) on delete cascade,
  result text not null check (result in ('pass','fail','not_applicable')),
  notes text, checked_by uuid references users(id), checked_at timestamptz not null default now(),
  primary key (candidate_id, disqualifier_id)
);

-- Schema hook only. No assessment tool is built in MVP.
create table candidate_assessments (
  id uuid primary key default gen_random_uuid(),
  candidate_id uuid not null references candidates(id) on delete cascade,
  provider text not null,          -- 'harrison','culture_index','predictive_index','internal'
  assessment_type text,
  taken_at timestamptz,
  score_summary jsonb,
  report_file_id uuid references candidate_files(id),
  interpreted_by uuid references users(id),
  interpretation_notes text,
  raw_payload jsonb,
  created_at timestamptz not null default now()
);
```

---

## 9. Assignments, rejections, interviews, placements

```sql
create table assignments (
  id             uuid primary key default gen_random_uuid(),
  requisition_id uuid not null references requisitions(id) on delete cascade,
  candidate_id   uuid not null references candidates(id) on delete restrict,
  stage          assignment_stage not null default 'sourced',
  presented_at   timestamptz,
  client_decision_at timestamptz,
  assigned_by    uuid not null references users(id),
  presented_by   uuid references users(id),
  admin_note     text,                    -- internal
  client_note    text,                    -- shown to client alongside the candidate
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (requisition_id, candidate_id)
);

create index idx_assignments_requisition on assignments(requisition_id);
create index idx_assignments_stage on assignments(stage);
create index idx_assignments_candidate on assignments(candidate_id);

create table rejection_reasons (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  label text not null,
  actor rejection_actor not null,
  sort_order int not null default 0,
  is_active boolean not null default true
);

create table rejections (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  actor         rejection_actor not null,
  rejected_by   uuid not null references users(id),
  reason_id     uuid references rejection_reasons(id),
  reason_other  text,
  detail        text,
  created_at    timestamptz not null default now(),
  constraint chk_reason_present check (reason_id is not null or reason_other is not null)
);

create index idx_rejections_reason on rejections(reason_id);

create table interviews (
  id            uuid primary key default gen_random_uuid(),
  assignment_id uuid not null references assignments(id) on delete cascade,
  round_number  int not null default 1,
  scheduled_at  timestamptz,
  timezone      text,
  duration_minutes int,
  meeting_url   text,
  interviewer_names text,
  requested_by  uuid references users(id),
  created_by    uuid not null references users(id),
  outcome       interview_outcome not null default 'pending',
  outcome_notes text,
  outcome_recorded_by uuid references users(id),
  outcome_recorded_at timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (assignment_id, round_number)
);

create table placements (
  id             uuid primary key default gen_random_uuid(),
  assignment_id  uuid not null unique references assignments(id) on delete restrict,
  candidate_id   uuid not null references candidates(id),
  client_id      uuid not null references clients(id),
  requisition_id uuid not null references requisitions(id),
  start_date     date not null,
  end_date       date,
  rate_amount    numeric(12,2),
  rate_unit      rate_unit,
  rate_currency  char(3) default 'USD',
  hours_per_week int,
  service_tier   service_tier,
  guarantee_end_date date,
  status         placement_status not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
```

---

## 10. Events, notifications, settings, webhooks

```sql
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
```

Seed `app_settings` with the needs-attention thresholds from `01-PRODUCT-OVERVIEW.md` §6, keys: `queue.principal_approval_days` (3), `queue.no_candidates_days` (5), `queue.awaiting_client_days` (3), `intake.form_cache_ttl_seconds` (60).

---

## 11. Views — visibility enforcement

Client-facing candidate data is served **only** through this view. No client-scoped endpoint may query `candidates` directly.

```sql
create or replace view client_visible_assignments as
select
  a.id                as assignment_id,
  a.requisition_id,
  a.stage,
  a.presented_at,
  a.client_note,
  r.client_id,
  c.id                as candidate_id,
  c.reference,
  -- always visible
  c.display_name,
  c.photo_path,
  c.country, c.region_state, c.city, c.timezone,
  c.english_spoken_level, c.english_written_level, c.accent_strength,
  c.years_experience_total, c.years_experience_relevant,
  c.current_title, c.seniority_level,
  c.has_management_experience, c.team_size_managed,
  c.has_client_facing_experience, c.has_us_client_experience,
  c.remote_experience_years, c.available_from,
  c.engagement_types, c.hours_available_per_week,
  c.overlap_start, c.overlap_end, c.overlap_timezone,
  c.autonomy, c.can_manage_up,
  c.recruiter_recommendation, c.strengths,
  -- gated: unlocked at interview_scheduled or later
  case when a.stage = any (array['interview_scheduled','interviewed','offer','placed']::assignment_stage[])
       then c.first_name  else null end as first_name,
  case when a.stage = any (array['interview_scheduled','interviewed','offer','placed']::assignment_stage[])
       then c.last_name   else null end as last_name,
  case when a.stage = any (array['interview_scheduled','interviewed','offer','placed']::assignment_stage[])
       then c.email::text else null end as email,
  case when a.stage = any (array['interview_scheduled','interviewed','offer','placed']::assignment_stage[])
       then c.phone       else null end as phone,
  case when a.stage = any (array['interview_scheduled','interviewed','offer','placed']::assignment_stage[])
       then c.whatsapp    else null end as whatsapp,
  case when a.stage = any (array['interview_scheduled','interviewed','offer','placed']::assignment_stage[])
       then c.linkedin_url else null end as linkedin_url,
  case when a.stage = any (array['interview_scheduled','interviewed','offer','placed']::assignment_stage[])
       then c.current_employer else null end as current_employer
from assignments a
join requisitions r on r.id = a.requisition_id
join candidates   c on c.id = a.candidate_id
where a.stage = any (array[
  'presented','client_reviewing','interview_scheduled',
  'interviewed','offer','placed','rejected_by_client','closed_not_selected'
]::assignment_stage[]);
```

Client-visible files are filtered separately: `candidate_files where is_client_visible = true`.

**Verification test (AC-DB-07):** insert an assignment at every stage; assert the view returns rows only for the eight listed stages, and that `email`, `phone`, `last_name`, `whatsapp`, `linkedin_url`, `current_employer` are null for `presented` and `client_reviewing`.

---

## 12. Triggers

| Trigger | Table | Purpose |
|---|---|---|
| `trg_set_updated_at` | all tables with `updated_at` | Set `updated_at = now()` on update |
| `trg_answer_value_shape` | `requisition_answers` | Enforce exactly-one-value-column matching question type (§6.1) |
| `trg_question_answer_count` | `requisition_answers` | Maintain `questions.answer_count` |
| `trg_block_question_type_change` | `questions` | Raise if `question_type` changes while `answer_count > 0` |
| `trg_events_immutable` | `events` | Raise on UPDATE or DELETE |
| `trg_candidate_cv_search` | `candidates` | Rebuild `cv_search` tsvector from name, title, strengths, and extracted CV text |
| `trg_assignment_stage_event` | `assignments` | Write an `events` row on every stage change |
| `trg_requisition_status_event` | `requisitions` | Write an `events` row on every status change |

---

## 13. Row-level security

**Access model:** the browser never queries Postgres directly. All data access is mediated by the Node API using the `service_role` key. RLS is nonetheless enabled on every table with **deny-all** policies for the `anon` and `authenticated` roles.

Rationale: a single enforcement point in the API keeps authorization logic testable and avoids maintaining the same rule in two languages. Deny-all RLS means that if an `anon` or `authenticated` key is ever exposed in the front-end bundle, it grants nothing.

```sql
-- Applied to every table
alter table <table> enable row level security;
alter table <table> force row level security;
-- No policies created for anon/authenticated => deny all.
-- service_role bypasses RLS by design.

revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to service_role;
```

**Verification test (AC-DB-08):** using the `anon` key and the `authenticated` key with a valid client user JWT, attempt `select * from candidates`. Both must return zero rows or a permission error. A test that returns data is a failure.

---

## 14. Migrations

Forward-only, numbered, never edited after commit.

| # | File | Contents |
|---|---|---|
| 0001 | `extensions_and_enums.sql` | Extensions, all enum types |
| 0002 | `identity.sql` | users, roles, permissions, role_permissions, user_roles |
| 0003 | `clients.sql` | clients, client_members, indexes, payment-gate constraint |
| 0004 | `taxonomy.sql` | engines, departments, role_categories, tools, skills, industries |
| 0005 | `questions.sql` | question_categories, questions, question_options, question_role_scopes |
| 0006 | `requisitions_and_answers.sql` | requisitions, requisition_answers, answer_options, value-shape trigger |
| 0007 | `candidates.sql` | candidates + all candidate child tables |
| 0008 | `pipeline.sql` | assignments, rejection_reasons, rejections, interviews, placements |
| 0009 | `events_and_ops.sql` | events, notification_log, webhook_ingest_log, app_settings |
| 0010 | `views_triggers_rls.sql` | client_visible_assignments, all triggers, RLS enablement |
| 0011 | `seed_reference_data.sql` | roles, permissions, role_permissions, engines, rejection_reasons, app_settings |

Seed data for departments, role categories, questions, tools, skills, and industries is **not** in migrations — it is entered by the client through the admin UI. A separate `supabase/seed/dev_seed.sql` provides realistic dummy data for development, including 25 dummy candidates.
