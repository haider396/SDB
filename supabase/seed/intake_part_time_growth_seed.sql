-- intake_part_time_growth_seed.sql
--
-- T14: the two intake questions behind migration 0019.
--
-- Rebecca, 49:25: "there might be the option to start part-time and then grow
-- into full-time... how quickly they're expecting to be full-time."
-- 51:11: "I always want to start part-time, but I always want them to grow
-- into full-time, and I was never able to properly communicate that on their
-- intake form."
--
-- TWO questions, not three. The obvious shape is "start part-time? → grow to
-- full-time? → how soon?", but the middle question is redundant once the
-- timeframe list carries a "stays part-time" option: choosing a timeframe IS
-- the answer to "does it grow". One fewer click, one fewer conditional level.
--
-- Both are mapped questions (MAPPED_QUESTION_KEYS), so the answers project
-- onto requisitions.starts_part_time / .full_time_transition_after as well as
-- being stored as answers.
--
-- Placed with the hours block: this is an hours arrangement, and it reads
-- naturally right after "hours per week".
--
-- Re-runnable: fixed ids + on conflict do nothing.

insert into questions
  (id, category_id, key, label, help_text, placeholder, question_type, audience,
   is_required, sort_order, validation,
   conditional_on_question_id, conditional_operator, conditional_value)
values
  ('00000000-0000-4000-8000-000000000730',
   '00000000-0000-4000-8000-000000000403',
   'starts_part_time',
   'Would you like to start them part-time?',
   'Some clients prefer to begin with fewer hours and build up.',
   null,
   'yes_no', 'client', false, 104, '{}', null, null, null),

  ('00000000-0000-4000-8000-000000000731',
   '00000000-0000-4000-8000-000000000403',
   'full_time_transition_after',
   'When would you want them full-time?',
   'We tell candidates this up front — someone looking for full-time work will take a part-time start if they know it grows.',
   null,
   'single_select', 'client', false, 105, '{}',
   -- Only asked when they said yes above.
   '00000000-0000-4000-8000-000000000730', 'is_true', null)
on conflict (id) do nothing;

-- Values MUST match FullTimeTransitionSchema in packages/contracts — the
-- projection parses against it and drops anything unrecognised, so a reworded
-- LABEL is safe but a changed VALUE silently stops populating the column.
insert into question_options (id, question_id, value, label, sort_order) values
  ('00000000-0000-4000-8000-000009700001', '00000000-0000-4000-8000-000000000731', '2_weeks',         'After about 2 weeks',        1),
  ('00000000-0000-4000-8000-000009700002', '00000000-0000-4000-8000-000000000731', '1_month',         'After about a month',        2),
  ('00000000-0000-4000-8000-000009700003', '00000000-0000-4000-8000-000000000731', '2_months',        'After about 2 months',       3),
  ('00000000-0000-4000-8000-000009700004', '00000000-0000-4000-8000-000000000731', '3_months',        'After about 3 months',       4),
  ('00000000-0000-4000-8000-000009700005', '00000000-0000-4000-8000-000000000731', 'longer',          'Longer — we can discuss',    5),
  ('00000000-0000-4000-8000-000009700006', '00000000-0000-4000-8000-000000000731', 'stays_part_time', 'It stays part-time',         6)
on conflict (id) do nothing;
