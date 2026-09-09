-- 0029_repeating_group_answer_shape.sql
--
-- Teach both answer value-shape triggers that a `repeating_group` answer
-- (enum value added in 0028) stores its rows in `value_json`.
--
-- ── What was wrong ─────────────────────────────────────────────────────────
-- 0028 added the enum value; nothing yet knows what it means. Both shape
-- functions dispatch on question_type with a `case` that has NO `else` arm, so
-- an answer against a `repeating_group` question raises CASE_NOT_FOUND
-- (SQLSTATE 20000) — "case not found", and nothing else: no table, no question
-- key, no type. The safety net already works; this file teaches it. The type
-- is unusable until it lands, which is why it lands before any seed, any
-- contract change and any UI.
--
-- ── Why both functions, in ONE migration ───────────────────────────────────
-- 0017's own header states the rule this file obeys:
--
--     The type→column mapping is identical and must stay in lockstep with
--     enforce_answer_value_shape() in 0006.
--
-- They are two functions rather than one generic one so that the error message
-- names the table, which is what makes a failing insert diagnosable. That is
-- worth the duplication only while the two stay identical — and splitting a
-- change across two migrations is exactly how they would drift. So both are
-- replaced here, together, and the rolled-back validation exercised both
-- tables rather than one and an assumption.
--
-- ── value_json, and why no new column ──────────────────────────────────────
-- The stored value is an OBJECT, `{ "rows": [ { … }, … ] }`, never a bare
-- array — the same shape `file_upload` already uses for `{ "fileIds": [...] }`.
-- The design (§3.1) settled that: a bare array is caught by the existing
-- Array.isArray branch in apps/web/src/lib/answer-value.ts and rendered as
-- "[object Object], [object Object]" by any consumer nobody remembered to
-- teach. This trigger does not police the object's interior — what is inside
-- value_json is the service's job (RepeatingGroupValueSchema), exactly as it
-- already is for currency_range and file_upload. What the trigger guarantees
-- is what it guarantees for every other type: exactly one value column, and
-- the right one.
--
-- No column is added and no answer row is touched. Every existing answer keeps
-- its value, and the arms for the twelve pre-existing types are character-for-
-- character the ones in 0006 and 0017 — the rolled-back validation inserted
-- one answer per type into BOTH tables to prove it, because the function is
-- replaced WHOLESALE and a typo in an arm nobody meant to touch is the
-- realistic failure here, not the new arm.
--
-- ── The `else` arm — new, and deliberately unreachable ─────────────────────
-- Added while we are in here. It cannot change behaviour for any existing
-- type: all thirteen enum values are matched by a `when` arm above it, so
-- nothing reaches it today, and the validation confirmed every type still
-- succeeds, or fails, exactly as it did before.
--
-- It changes only the failure the NEXT person gets. 02-DATABASE.md §6.1 and
-- 0006's own header both describe this function as raising check_violation;
-- the missing `else` was an oversight, not a design, and it meant that adding
-- an enum value without teaching this function produced an opaque 20000 rather
-- than the documented error naming the question and the type. Nothing depends
-- on CASE_NOT_FOUND (grepped across apps, packages, supabase and docs: zero
-- references outside the design doc), and the API maps 23514 only for
-- chk_budget_order in services/requisitions.service.ts, so no error path
-- anywhere changes shape.
--
-- ── The triggers are NOT recreated ─────────────────────────────────────────
-- `create or replace function` keeps the same pg_proc oid, and pg_trigger
-- .tgfoid holds that oid — so trg_answer_value_shape and
-- trg_candidate_answer_value_shape point at the new bodies with no drop, and
-- no window in which a row could slip past unvalidated. Verified rather than
-- assumed: the validation recorded both triggers' tgfoid before and after the
-- replace and asserted they were unchanged and still resolve to these two
-- functions.
--
-- ── Fresh database vs. existing ────────────────────────────────────────────
-- A new environment runs 0006 (which defines the first function), 0017 (its
-- twin), 0028 (the enum value) and then this file, which replaces both bodies
-- — landing on exactly the definitions an already-migrated database reaches.
-- `create or replace` is idempotent, so replaying this file changes nothing:
-- the second dry run reported zero drift.

-- ---------------------------------------------------------------------------
-- requisition_answers — replaces the body defined in 0006.
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
    -- repeating_group joins the json types: { "rows": [ { … } ] } — 0028.
    when 'multi_select', 'currency_range', 'file_upload', 'repeating_group' then
      expected_column := 'value_json';
      populated_ok    := new.value_json is not null;
    else
      -- Unreachable for all thirteen enum values above. It exists so the
      -- FOURTEENTH — added by someone who never found this file — fails with
      -- the documented error naming the question and the type, rather than a
      -- bare CASE_NOT_FOUND.
      raise exception 'requisition_answers row for question %: question_type % is not handled by enforce_answer_value_shape(); teach it in a new migration before using this type',
        new.question_key, q_type
        using errcode = 'check_violation';
  end case;

  if not populated_ok then
    raise exception 'requisition_answers row for question % must populate % (question_type %)',
      new.question_key, expected_column, q_type
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- candidate_answers — replaces the body defined in 0017. Identical mapping,
-- table-specific messages: the lockstep 0017 asked for.
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
    -- repeating_group joins the json types: { "rows": [ { … } ] } — 0028.
    when 'multi_select', 'currency_range', 'file_upload', 'repeating_group' then
      expected_column := 'value_json';
      populated_ok    := new.value_json is not null;
    else
      raise exception 'candidate_answers row for question %: question_type % is not handled by enforce_candidate_answer_value_shape(); teach it in a new migration before using this type',
        new.question_key, q_type
        using errcode = 'check_violation';
  end case;

  if not populated_ok then
    raise exception 'candidate_answers row for question % (%) must populate %',
      new.question_key, q_type, expected_column
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;
