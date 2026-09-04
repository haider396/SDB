-- 0021_candidate_form_seed_template.sql
--
-- Turn the existing /register question set into the seeded, editable template
-- form, and move existing candidate answers under synthetic submissions.
--
-- After this, /register is served BY THE BUILDER: the same questions, the same
-- steps, the same URL — but an admin can now edit it like any other form.
--
-- Idempotent throughout (fixed ids + on conflict do nothing), matching the
-- convention in 0011 and the seed files.

-- ---------------------------------------------------------------------------
-- 1. The template form.
--
-- is_default pins /register to this row even if its slug is regenerated or its
-- label changed, and uq_candidate_forms_default guarantees there is only ever
-- one. role_category_id stays null: a general registration is not for one role,
-- which chk_form_role_category_required permits precisely because is_default.
--
-- Typing test and documents are ON, because that is what /register does today.
-- ---------------------------------------------------------------------------
insert into candidate_forms
  (id, key, label, description, is_default,
   has_typing_test, has_documents_step, status)
values
  ('00000000-0000-4000-8000-000000000601',
   'default_registration',
   'Candidate registration',
   'The general talent-pool form. Seeded from the original /register question set.',
   true, true, true, 'draft')
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. Version 1, with one page per active candidate question CATEGORY.
--
-- The categories become the form's steps, in their existing order, so the
-- rendered form is identical to what /register serves today.
-- ---------------------------------------------------------------------------
insert into candidate_form_versions
  (id, form_id, version_number, pages, theme, published_at)
select '00000000-0000-4000-8000-000000000602',
       '00000000-0000-4000-8000-000000000601',
       1,
       coalesce(
         jsonb_agg(
           jsonb_build_object(
             'index', p.page_index,
             'title', p.label,
             'description', p.description
           ) order by p.page_index
         ),
         '[]'::jsonb
       ),
       '{}'::jsonb,          -- empty theme = every default from FormThemeSchema
       now()
from (
  select c.id,
         c.label,
         c.description,
         (dense_rank() over (order by c.sort_order, c.created_at, c.id))::int - 1
           as page_index
  from question_categories c
  where c.is_active
    and exists (
      select 1 from questions q
       where q.category_id = c.id
         and q.audience = 'candidate'
         and q.is_active
         and q.archived_at is null
    )
) p
on conflict (id) do nothing;

-- ---------------------------------------------------------------------------
-- 3. One question block per active candidate question.
--
-- Laid out as a single full-width column (24 of 24) in the existing order, so
-- the form reads exactly as it does now and the admin can rearrange from there.
-- rowSpan 8 = 64px at the 8px row unit; row is spaced 10 apart to leave a gap.
-- ---------------------------------------------------------------------------
insert into candidate_form_blocks
  (form_version_id, block_type, question_id, page_index, sort_order, layout)
select '00000000-0000-4000-8000-000000000602',
       'question',
       s.id,
       s.page_index,
       s.ord,
       jsonb_build_object(
         'desktop', jsonb_build_object(
           'col', 0, 'row', (s.ord - 1) * 10, 'colSpan', 24, 'rowSpan', 8, 'z', 0
         ),
         -- null = auto-stack in reading order on a phone. The admin only
         -- positions the blocks where that default is wrong.
         'mobile', null
       )
from (
  select q.id,
         (dense_rank() over (order by c.sort_order, c.created_at, c.id))::int - 1
           as page_index,
         (row_number() over (
            partition by c.id order by q.sort_order, q.created_at, q.id
          ))::int as ord
  from questions q
  join question_categories c on c.id = q.category_id
  where q.audience = 'candidate'
    and q.is_active
    and q.archived_at is null
    and c.is_active
) s
-- uq_form_blocks_question is a PARTIAL unique index, so ON CONFLICT must
-- repeat its predicate for Postgres to infer it.
on conflict (form_version_id, question_id) where question_id is not null
do nothing;

-- Publish it: chk_form_active_needs_version requires the version first.
update candidate_forms
   set published_version_id = '00000000-0000-4000-8000-000000000602',
       status = 'active',
       activated_at = coalesce(activated_at, now())
 where id = '00000000-0000-4000-8000-000000000601'
   and published_version_id is null;

-- ---------------------------------------------------------------------------
-- 4. Backfill: give every existing candidate answer a submission.
--
-- The read model groups answers BY submission, so without this pre-builder
-- answers would need a second "loose answers" rendering path. One synthetic
-- submission per candidate gives the UI exactly one path.
--
-- ONE-WAY DOOR, stated plainly: this collapses each candidate's existing
-- answers into a SINGLE submission. If someone genuinely answered across two
-- historical sessions, that distinction is lost. Nothing real is lost, because
-- the old `unique (candidate_id, question_id)` made two submissions
-- unrecordable in the first place — but a future reader should not go looking
-- for data that was never there.
-- ---------------------------------------------------------------------------
insert into candidate_form_submissions
  (form_id, form_version_id, candidate_id, role_category_id, session_id,
   source, is_created_candidate, answer_count, submitted_at)
select '00000000-0000-4000-8000-000000000601',
       '00000000-0000-4000-8000-000000000602',
       a.candidate_id,
       null,
       (select s.id
          from candidate_registration_sessions s
         where s.candidate_id = a.candidate_id
         order by s.submitted_at
         limit 1),
       'backfill',
       true,
       count(*)::int,
       min(a.created_at)
from candidate_answers a
where a.submission_id is null
group by a.candidate_id
on conflict (form_id, candidate_id) do nothing;

-- Assigning a submission is bookkeeping, not a business change, so updated_at
-- must not move. (0015's public_id backfill sets this precedent.)
--
-- trg_candidate_question_answer_count needs NO handling:
-- maintain_question_answer_count() is a no-op on UPDATE when question_id is
-- unchanged (0010) — verified, not assumed.
alter table candidate_answers disable trigger trg_candidate_answers_updated_at;

update candidate_answers a
   set submission_id = s.id
  from candidate_form_submissions s
 where s.candidate_id = a.candidate_id
   and s.source = 'backfill'
   and a.submission_id is null;

alter table candidate_answers enable trigger trg_candidate_answers_updated_at;
