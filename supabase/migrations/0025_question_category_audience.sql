-- 0025_question_category_audience.sql
--
-- Which admin surface owns a question category.
--
-- Candidate questions are now created and edited in the FORM BUILDER, and the
-- Questions page keeps only client and internal ones. That page groups by
-- category, so it needs to know which categories to leave alone.
--
-- ── Why a column and not a derivation ───────────────────────────────────────
-- The existing pattern (intake.repo.ts, and 0021's page builder) decides
-- "candidate category" by asking whether it currently holds an active
-- candidate question:
--
--     exists (select 1 from questions q
--              where q.category_id = c.id and q.audience = 'candidate' ...)
--
-- That cannot classify an EMPTY category — which is exactly what an admin has
-- the moment they create one in the builder and before they put a question in
-- it. It would appear on the Questions page, and its first question would make
-- it silently vanish. So ownership is stated, not inferred.
--
-- ── What this column is NOT ─────────────────────────────────────────────────
-- It does not constrain the audience of the questions inside. Internal-audience
-- questions live in client categories today and continue to. This says only
-- "which screen manages this category", so the Questions page and the builder
-- never show each other's groupings.

alter table question_categories
  add column audience question_audience not null default 'client';

comment on column question_categories.audience is
  'Which admin surface manages this category: candidate categories belong to '
  'the form builder, everything else to the Questions page. Does NOT constrain '
  'the audience of the questions inside it.';

-- Backfill. The split is already clean — the five candidate_* categories seeded
-- by supabase/seed/candidate_questions_seed.sql hold only candidate questions,
-- and no other category holds any. Keyed off the seed's own naming convention,
-- which is what has been carrying this distinction informally until now.
update question_categories
   set audience = 'candidate'
 where key like 'candidate\_%';

-- Belt and braces: catch any category that holds candidate questions but does
-- not match the naming convention, so the backfill cannot miss one.
update question_categories c
   set audience = 'candidate'
 where c.audience = 'client'
   and exists (
     select 1
       from questions q
      where q.category_id = c.id
        and q.audience = 'candidate'
        and q.archived_at is null
   );

create index idx_question_categories_audience
  on question_categories (audience)
  where is_active;
