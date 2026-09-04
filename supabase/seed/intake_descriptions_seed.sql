-- intake_descriptions_seed.sql
--
-- T16: the client writes the job description and role description themselves,
-- at intake. Rebecca, 54:35: "we need to have on the collection form, they can
-- submit a role description there."
--
-- These are MAPPED questions (CANDIDATE-side equivalent: see
-- MAPPED_QUESTION_KEYS in packages/contracts/src/mapped-questions.ts): the
-- answers project onto requisitions.job_description / .role_description as
-- well as being stored as answers. Two consequences worth knowing:
--
--   * the sourcing gate reads the COLUMN, so it never has to parse answers;
--   * mapped keys cannot be deleted or renamed — the API returns
--     409 MAPPED_QUESTION_PROTECTED (03 §3.4). That is deliberate here: if
--     `job_description` could be switched off in the Question Manager, the
--     "no sourcing without a job description" rule would silently stop
--     working.
--
-- Both are OPTIONAL at intake. Rebecca was explicit that a client may not have
-- one and can ask SDB to write it ("they can choose to have us write it for
-- them"); the gate applies at sourcing, not at submission.
--
-- They sort ahead of the working-hours block so the role is described before
-- the logistics are pinned down.
--
-- Re-runnable: fixed ids + on conflict do nothing.

insert into questions
  (id, category_id, key, label, help_text, placeholder, question_type, audience,
   is_required, sort_order, validation)
values
  ('00000000-0000-4000-8000-000000000720',
   '00000000-0000-4000-8000-000000000403',
   'job_description',
   'Job description',
   'What candidates will see. If you would rather we wrote it, leave this blank and we will draft it with you.',
   'What the role is, what a good candidate looks like, and why someone would want it.',
   'long_text', 'client', false, 10, '{"maxLength":20000}'),

  ('00000000-0000-4000-8000-000000000721',
   '00000000-0000-4000-8000-000000000403',
   'role_description',
   'Role description',
   'What the person actually does once they join — this one is for you and them, not for the advert.',
   'Day-to-day responsibilities, who they report to, and what success looks like.',
   'long_text', 'client', false, 11, '{"maxLength":20000}')
on conflict (id) do nothing;
