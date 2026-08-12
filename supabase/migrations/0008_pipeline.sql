-- 0008_pipeline.sql
-- assignments, rejection_reasons, rejections, interviews, placements.
-- See docs/02-DATABASE.md §9. Placements deliberately exclude the fee-modelling
-- columns floated in README.md's appendix — OPEN-1 is unresolved.

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
