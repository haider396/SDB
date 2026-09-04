-- 0023_form_block_content_overrides.sql
--
-- Per-form wording and choice selection on a block.
--
-- A form builder in which you cannot rename a field is not a form builder. The
-- original design deliberately kept blocks free of question content so a block
-- could never hold a stale copy — that part still holds, and these are NOT
-- copies. They are overrides applied to the resolved question record BEFORE
-- validateSubmission runs, exactly as is_required_override already is.
--
-- ── Why this does not corrupt question_snapshot ─────────────────────────────
-- The earlier objection to label overrides was that buildSnapshot reads
-- question.label, so the snapshot would record the LIBRARY wording while the
-- candidate saw the override — a false record of what was asked.
--
-- That is only true of a naive implementation. Because the override is applied
-- upstream, buildSnapshot sees the overridden label and records it. The
-- snapshot therefore says exactly what that candidate was shown, which is the
-- whole point of 03 §1.4.
--
-- ── What is deliberately NOT here ───────────────────────────────────────────
-- question_type. The answer-shape triggers validate the value column against
-- questions.question_type, so the same question storing text on one form and a
-- date on another is rejected by the database — and candidates.email and
-- friends read from those columns. Type is chosen when a field is created and
-- is not a per-form concern.

alter table candidate_form_blocks
  -- NULL means "use the library wording". An empty string is a real override
  -- (a deliberately blank help line), which is why these are nullable text
  -- rather than defaulting to ''.
  add column if not exists label_override       text,
  add column if not exists placeholder_override text,
  add column if not exists help_text_override   text,
  -- Which of the question's choices this form shows, in this order.
  -- NULL = all of them. Values reference question_options.value, so a
  -- candidate's answer still resolves to a real option row and reporting
  -- across forms stays comparable — the subset only narrows what is offered.
  add column if not exists option_value_overrides text[];

comment on column candidate_form_blocks.label_override is
  'Per-form label. Applied to the question record before validation, so it is '
  'what question_snapshot records.';
comment on column candidate_form_blocks.option_value_overrides is
  'Subset and order of question_options.value shown on this form. NULL = all.';

-- A wording override only makes sense on a question block; a heading carries
-- its own text in props. Cheap to enforce, and it stops a confusing state.
alter table candidate_form_blocks
  add constraint chk_block_overrides_need_question check (
    question_id is not null
    or (label_override is null
        and placeholder_override is null
        and help_text_override is null
        and option_value_overrides is null)
  );
