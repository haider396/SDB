-- 0019_part_time_growth.sql
--
-- T14: a role that STARTS part-time and grows into full-time.
--
-- Rebecca, 49:25: "there might be the option to start part-time and then grow
-- into full-time... how quickly they're expecting to be full-time. I like to
-- bring people along where they're on part-time for a minimum of two weeks up
-- to a couple months, but then I want them to grow into full-time after X
-- date."
--
-- And the reason it matters, 51:11: "That's with Virtual Latinos — I always
-- want to start part-time, but I always want them to grow into full-time, and
-- I was never able to properly communicate that on their intake form."
--
-- Why this needs its own columns rather than leaning on `engagement_type`:
-- that enum is a single value ('full_time' | 'part_time' | 'project'), so a
-- growth arrangement records as plain "part_time" and the candidate is never
-- told it becomes full-time. A candidate who wants full-time work turns down a
-- role they would have accepted — which is precisely the miscommunication
-- Rebecca described.
--
-- `full_time_transition_after` is text, matching the existing `urgency` column
-- rather than introducing a fourth enum for a value only the form writes.
-- The allowed set is enforced by the Zod schema in packages/contracts and by
-- the question's own options, which is where the intake engine already
-- validates select answers.

alter table requisitions
  add column if not exists starts_part_time boolean,
  add column if not exists full_time_transition_after text;

comment on column requisitions.starts_part_time is
  'Client wants the hire to begin on part-time hours (T14). Null = not asked.';
comment on column requisitions.full_time_transition_after is
  'How soon part-time should become full-time: 2_weeks | 1_month | 2_months | 3_months | longer | stays_part_time. Only meaningful when starts_part_time is true (T14).';
