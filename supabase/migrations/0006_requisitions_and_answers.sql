-- 0006_requisitions_and_answers.sql
-- requisitions, requisition_answers, requisition_answer_options, and the
-- answer value-shape trigger. See docs/02-DATABASE.md §6.1 and §7.

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

-- ---------------------------------------------------------------------------
-- Exactly-one-value constraint (docs/02-DATABASE.md §6.1).
-- Raises check_violation when more than one value column is non-null, or when
-- the populated column does not match the question's declared question_type.
--
--   short_text, long_text, email, phone  -> value_text
--   number, scale                        -> value_number
--   yes_no                               -> value_boolean
--   date                                 -> value_date
--   single_select                        -> value_text (the option value)
--   multi_select                         -> value_json (array of option values)
--   currency_range                       -> value_json ({min,max,unit,currency})
--   file_upload                          -> value_json ({fileIds:[...]})
-- ---------------------------------------------------------------------------
create or replace function enforce_answer_value_shape()
returns trigger
language plpgsql
as $$
declare
  q_type          question_type;
  populated_count int;
  expected_column text;
  populated_ok    boolean;
begin
  select q.question_type into q_type
  from questions q
  where q.id = new.question_id;

  if q_type is null then
    raise exception 'requisition_answers.question_id % does not reference an existing question', new.question_id
      using errcode = 'check_violation';
  end if;

  populated_count :=
      (new.value_text    is not null)::int
    + (new.value_number  is not null)::int
    + (new.value_boolean is not null)::int
    + (new.value_date    is not null)::int
    + (new.value_json    is not null)::int;

  if populated_count > 1 then
    raise exception 'requisition_answers row for question % (%) populates % value columns; exactly one is allowed',
      new.question_key, q_type, populated_count
      using errcode = 'check_violation';
  end if;

  case q_type
    when 'short_text', 'long_text', 'email', 'phone', 'single_select' then
      expected_column := 'value_text';
      populated_ok    := new.value_text is not null;
    when 'number', 'scale' then
      expected_column := 'value_number';
      populated_ok    := new.value_number is not null;
    when 'yes_no' then
      expected_column := 'value_boolean';
      populated_ok    := new.value_boolean is not null;
    when 'date' then
      expected_column := 'value_date';
      populated_ok    := new.value_date is not null;
    when 'multi_select', 'currency_range', 'file_upload' then
      expected_column := 'value_json';
      populated_ok    := new.value_json is not null;
  end case;

  if not populated_ok then
    raise exception 'requisition_answers row for question % must populate % (question_type %)',
      new.question_key, expected_column, q_type
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_answer_value_shape
  before insert or update on requisition_answers
  for each row execute function enforce_answer_value_shape();
