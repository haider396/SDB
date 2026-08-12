-- 0007_candidates.sql
-- candidates and all candidate child tables. See docs/02-DATABASE.md §8.

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

-- ---------------------------------------------------------------------------
-- Candidate child tables (§8.2)
-- ---------------------------------------------------------------------------

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
