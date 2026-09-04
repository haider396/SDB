-- 0017_candidate_registration.sql
--
-- Storage for the public candidate registration form
-- (docs/CHANGE-REQUESTS-2026-08-13.md T38).
--
-- Design mirrors requisition_answers (docs/03-INTAKE-FORM-ENGINE.md §1.1
-- Option C): normalised question definitions, one typed answer row per
-- question, plus an immutable question_snapshot so historical answers survive
-- later edits to the question. The same reasoning applies here — Rebecca will
-- edit the candidate question set frequently, and the answers must stay
-- reportable in plain SQL.
--
-- Mapped answers ALSO populate first-class `candidates` columns (first_name,
-- email, country, …) exactly as intake maps onto clients/requisitions
-- (03 §3.4). The answer row remains the record of what was asked; the column
-- is a derived projection used for filtering and business logic.

-- ---------------------------------------------------------------------------
-- Typing test (T10). Rebecca: "they can retake it as many times as they want,
-- and it would log their average" — average across attempts, explicitly not
-- the best score. Attempts are stored so the average stays recomputable.
-- ---------------------------------------------------------------------------
alter table candidates
  add column if not exists typing_wpm_average int
    check (typing_wpm_average is null or typing_wpm_average between 0 and 400),
  add column if not exists typing_test_attempts int not null default 0
    check (typing_test_attempts >= 0);

-- ---------------------------------------------------------------------------
-- Registration sessions.
--
-- A public registrant has no candidate row until they submit, but the form
-- accepts file uploads mid-flow. The session is the anchor: uploads are keyed
-- to it, and on submit its files are attached to the newly created candidate.
--
-- Sessions are short-lived and swept by a scheduled job; an abandoned session
-- leaves nothing but orphaned storage objects, which the sweep removes.
-- ---------------------------------------------------------------------------
create table candidate_registration_sessions (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid references candidates(id) on delete set null,
  submitted_at  timestamptz,
  ip_hash       text,                   -- salted hash, abuse tracing only. Never raw IP (NFR-12 spirit)
  user_agent    text,
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default (now() + interval '24 hours')
);

create index idx_registration_sessions_expiry
  on candidate_registration_sessions(expires_at)
  where submitted_at is null;

-- ---------------------------------------------------------------------------
-- Staged uploads.
--
-- `candidate_files.candidate_id` is NOT NULL, so a file uploaded mid-form
-- cannot live there yet — the candidate does not exist until submit. Rather
-- than weakening that constraint (it is what guarantees no orphan files), a
-- registration's uploads land here first and are promoted into
-- candidate_files inside the submit transaction.
--
-- The storage object itself is written once, under registrations/<session>/…,
-- and is not moved on promotion — only the row is created. Abandoned sessions
-- leave rows here plus their objects, both removed by the expiry sweep.
-- ---------------------------------------------------------------------------
create table candidate_registration_files (
  id                uuid primary key default gen_random_uuid(),
  session_id        uuid not null references candidate_registration_sessions(id) on delete cascade,
  file_type         candidate_file_type not null,
  storage_path      text not null,
  original_filename text not null,
  mime_type         text not null,
  size_bytes        bigint not null,
  -- Set by the confirm step once the object is verified present in storage.
  -- Unconfirmed rows are never promoted (06-BACKEND §6 step 3).
  confirmed_at      timestamptz,
  created_at        timestamptz not null default now()
);

create index idx_registration_files_session
  on candidate_registration_files(session_id);

-- ---------------------------------------------------------------------------
-- Candidate answers — one row per answered question.
-- ---------------------------------------------------------------------------
create table candidate_answers (
  id             uuid primary key default gen_random_uuid(),
  candidate_id   uuid not null references candidates(id) on delete cascade,
  question_id    uuid not null references questions(id) on delete restrict,
  question_key   text not null,          -- denormalised for stable reporting
  value_text     text,
  value_number   numeric(14,2),
  value_boolean  boolean,
  value_date     date,
  value_json     jsonb,
  question_snapshot jsonb not null,      -- label, type, options AS AT answer time
  answered_by    uuid references users(id),   -- null for public self-registration
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (candidate_id, question_id)
);

create index idx_candidate_answers_candidate on candidate_answers(candidate_id);
create index idx_candidate_answers_question_key on candidate_answers(question_key);
create index idx_candidate_answers_text_trgm
  on candidate_answers using gin (value_text gin_trgm_ops);

create table candidate_answer_options (
  answer_id uuid not null references candidate_answers(id) on delete cascade,
  option_id uuid not null references question_options(id) on delete restrict,
  primary key (answer_id, option_id)
);

-- ---------------------------------------------------------------------------
-- Exactly-one-value constraint, matching requisition_answers (02 §6.1).
--
-- Deliberately a separate function rather than a shared generic one: the error
-- messages name the table, which is what makes a failing insert diagnosable.
-- The type→column mapping is identical and must stay in lockstep with
-- enforce_answer_value_shape() in 0006.
-- ---------------------------------------------------------------------------
create or replace function enforce_candidate_answer_value_shape()
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
    raise exception 'candidate_answers.question_id % does not reference an existing question', new.question_id
      using errcode = 'check_violation';
  end if;

  populated_count :=
      (new.value_text    is not null)::int
    + (new.value_number  is not null)::int
    + (new.value_boolean is not null)::int
    + (new.value_date    is not null)::int
    + (new.value_json    is not null)::int;

  if populated_count > 1 then
    raise exception 'candidate_answers row for question % (%) populates % value columns; exactly one is allowed',
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
    raise exception 'candidate_answers row for question % (%) must populate %',
      new.question_key, q_type, expected_column
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger trg_candidate_answer_value_shape
  before insert or update on candidate_answers
  for each row execute function enforce_candidate_answer_value_shape();

create trigger trg_candidate_answers_updated_at
  before update on candidate_answers
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Answer counts feed the admin question manager's "is this question actually
-- used?" display (03 §2.2), which must now count BOTH libraries.
--
-- Reuses maintain_question_answer_count() from 0010 rather than defining a
-- second function: it keys off new/old.question_id, which candidate_answers
-- also carries, so it is already generic over any answer table.
--
-- NOTE for the read side: `lastAnsweredAt` is NOT a stored column — questions
-- .repo.ts derives it with max(created_at) over requisition_answers. That
-- query must be widened to union candidate_answers, or a candidate-only
-- question will always report a null lastAnsweredAt (AC-Q-13).
-- ---------------------------------------------------------------------------
create trigger trg_candidate_question_answer_count
  after insert or update or delete on candidate_answers
  for each row execute function maintain_question_answer_count();

-- ---------------------------------------------------------------------------
-- RLS: deny-all, matching every other table (02 §13). All access is through
-- the API's service-role connection.
-- ---------------------------------------------------------------------------
alter table candidate_registration_sessions enable row level security;
alter table candidate_registration_sessions force row level security;
alter table candidate_registration_files enable row level security;
alter table candidate_registration_files force row level security;
alter table candidate_answers enable row level security;
alter table candidate_answers force row level security;
alter table candidate_answer_options enable row level security;
alter table candidate_answer_options force row level security;

revoke all on candidate_registration_sessions from anon, authenticated;
revoke all on candidate_registration_files from anon, authenticated;
revoke all on candidate_answers from anon, authenticated;
revoke all on candidate_answer_options from anon, authenticated;
