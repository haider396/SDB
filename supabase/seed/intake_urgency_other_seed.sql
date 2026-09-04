-- intake_urgency_other_seed.sql
--
-- Follow-up to intake_working_setup_seed.sql, from review feedback:
--
-- 1. `hiring_urgency` gains an "Other" option with a free-text follow-up, so a
--    client whose timeline does not fit the five presets can say so in their
--    own words rather than picking the nearest wrong answer.
--
--    Adding the sixth option ALSO switches the renderer from radios to a
--    dropdown: select-fields.tsx uses radios at <= 5 options and a select
--    above that (05 §5). Six options therefore takes less vertical space,
--    which is the other half of the request — no renderer change needed.
--
-- 2. `additional_context` ("Anything else we should know?") moves to the END
--    of the step. It was sitting at sort_order 104, ahead of the whole
--    working-hours block, so the catch-all question interrupted the
--    structured ones.
--
-- Re-runnable: fixed ids + on conflict do nothing.

-- ---------------------------------------------------------------------------
-- 1. "Other" option + its conditional free-text question
-- ---------------------------------------------------------------------------
insert into question_options (id, question_id, value, label, sort_order) values
  ('00000000-0000-4000-8000-000009600005',
   '00000000-0000-4000-8000-000000000709',
   'other', 'Other — let me describe it', 6)
on conflict (id) do nothing;

insert into questions
  (id, category_id, key, label, help_text, placeholder, question_type, audience,
   is_required, sort_order, validation,
   conditional_on_question_id, conditional_operator, conditional_value)
values
  ('00000000-0000-4000-8000-000000000710',
   '00000000-0000-4000-8000-000000000403',
   'hiring_urgency_other',
   'Tell us about your timeline',
   null,
   'e.g. we need someone before our busy season starts in March',
   'short_text', 'client', false, 111, '{"maxLength":300}',
   -- Shown only when the dropdown is set to "other". The value is jsonb, so
   -- the string needs its quotes (03 §3.2 conditional shape).
   '00000000-0000-4000-8000-000000000709', 'equals', '"other"'::jsonb)
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Free-text catch-all goes last
-- ---------------------------------------------------------------------------
update questions
   set sort_order = 200
 where key = 'additional_context';
