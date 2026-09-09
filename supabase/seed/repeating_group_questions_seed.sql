-- repeating_group_questions_seed.sql
--
-- Five `repeating_group` questions for the shared candidate library, the
-- one-time copy of the skills/tools catalogue into one of them, and THREE of
-- the five placed as blocks on the default registration template.
--
-- Design: docs/superpowers/specs/2026-09-09-repeating-group-question-type-design.md
-- (§4 the catalogue copy, §13 placement). Plan: Task 11.
-- Requires migrations 0028 (the enum member) and 0029 (both answer-shape
-- trigger functions) to be applied first.
--
-- Reference data, NOT a migration: 02-DATABASE.md §14 keeps question content
-- out of migrations because Rebecca owns it and edits it in the Question
-- Manager. Seeded only so the tables exist on day one — every row here is
-- editable, reorderable and deactivatable in the UI without a deploy.
--
-- Re-runnable: fixed UUIDs and `on conflict do nothing` throughout. The
-- conflict clauses are deliberately UNTARGETED. A targeted one names a single
-- arbiter index and still raises 23505 on any other unique constraint — which
-- is exactly what the taxonomy seed hit when it was re-applied after someone
-- had created a row through the API under a different id. Untargeted catches
-- the primary key, `question_options (question_id, value)` and the PARTIAL
-- index `uq_form_blocks_question` alike.
--
-- ---------------------------------------------------------------------------
-- WHAT THE LIVE DEFAULT TEMPLATE ACTUALLY IS  (read 9 Sep 2026, not assumed)
-- ---------------------------------------------------------------------------
-- Task 11 says to check this rather than trust 0021's comment, and the check
-- matters: 0021 wrote its blocks onto version 1
-- (00000000-0000-4000-8000-000000000602), but that is NOT what /register
-- serves today. The form has been republished twice since:
--
--   candidate_forms  '00000000-0000-4000-8000-000000000601'
--                    key 'default_registration', slug 'WoK6hBgzhuey',
--                    is_default = true, status 'active',
--                    published_version_id = '5a8e1675-...-3dd68443dfc6'
--
--   candidate_form_versions for that form:
--     v1  00000000-...-000000000602  published 2026-09-04 15:38  5 pages, 23 blocks
--     v2  1c78717f-...-75545cf67e60  published 2026-09-04 22:32  5 pages, 24 blocks
--     v3  5a8e1675-...-3dd68443dfc6  published 2026-09-04 22:32  5 pages, 23 blocks  <- LIVE
--
-- So this seed NEVER hardcodes a version id. It resolves
-- `candidate_forms.published_version_id where is_default` — the row both
-- /register and /f/WoK6hBgzhuey actually render (both go through
-- candidate-form-public.service.ts `getDefault()`), on this database and on
-- any other.
--
-- APPEND to the live version rather than publish a new one. A new version would
-- mean copying all 23 existing blocks, inserting three, and swapping
-- published_version_id — a bigger change, not idempotent without a second
-- fixed-uuid block, and it moves the form's identity for no gain. Appending
-- three rows is one atomic insert; /register keeps serving throughout and picks
-- the new blocks up within `intake.form_cache_ttl_seconds` (60).
-- Precedent: 0021 wrote blocks straight onto a published version, and 0022 and
-- 0026 repaired blocks in place on published versions. Nothing in 0020 makes a
-- published version immutable.
--
-- ON A FRESH DATABASE, stated plainly. A new environment runs 0001–0029 and
-- then the files in supabase/seed/. In that order 0021 builds version 1 from a
-- questions table that is still EMPTY (candidate_questions_seed.sql has not run
-- yet), so it produces a form with zero pages and zero blocks. The block
-- inserts in §3 anchor on blocks that already exist, so on such a database they
-- insert nothing and the five library questions land alone — the same outcome
-- every other block on that form gets. On any database whose default template
-- does carry the seeded questions (this one, and staging), the three blocks
-- land beneath exactly the same questions, because the anchors are resolved by
-- question key and category key, never by row or page number.
--
-- ---------------------------------------------------------------------------
-- UUID BLOCK
-- ---------------------------------------------------------------------------
-- Clear of everything already in use: dev_seed 0000000009xx, candidate
-- questions 00000000005xx, countries 000000900001–000000900251, question
-- options 0000095xxxxx/0000096xxxxx/0000097xxxxx, tools 000000910001+,
-- skills 000000920001+. Verified against the database: no id anywhere matches
-- 000000980___.
--
--   questions          000000980001 – 000000980005
--   language options   000000980101 – 000000980118
--   form blocks        000000980201 – 000000980203
--
-- The ~200 skill options are the one exception and use an md5 of the catalogue
-- name instead. A positional block (`980300 + row_number`) would re-number
-- every option the day someone adds a tool: the shifted id would collide with
-- an id already taken, `do nothing` would swallow it, and the new skill would
-- silently never appear. md5(name) is stable per name, so a re-run inserts
-- exactly the names that are new.
--
-- ---------------------------------------------------------------------------
-- REFERENCES IS DELIBERATELY NOT HERE
-- ---------------------------------------------------------------------------
-- A candidate typing a third party's name and contact details into a public
-- form is the same legal question as change-request D5. Cut on purpose (spec
-- §16). Do not add it without asking Rebecca.

-- ---------------------------------------------------------------------------
-- 1. The five questions.
--
-- All `audience = 'candidate'`, optional, active. Column definitions live in
-- `validation.repeatingGroup`, which is where buildSnapshot() already copies
-- them from — so the columns are captured in question_snapshot for free.
--
-- LEVEL VALUES ARE MIRRORED, NEVER INVENTED. `proficiency` mirrors the
-- `proficiency_level` enum (aware/working/proficient/expert) and the two
-- language columns mirror `language_level` / LanguageLevelSchema in
-- packages/contracts/src/enums.ts exactly (basic/conversational/professional/
-- native_equivalent) — read from the enum, not from the plan's table. A
-- parallel set of level words is how two vocabularies for one idea get into a
-- database; the existing english_spoken_level / english_written_level options
-- already mirror the same enum.
--
-- `skills_and_tools` is the table Rebecca drew on the 13 Aug call (T7, 19:20 —
-- "that's under one column, the next column would be Proficiency... and then
-- let's add a third for just notes"). Its skill column reads the question's OWN
-- options, seeded in §2a.
--
-- `other_languages` covers OTHER languages only. Its label and help text say so
-- in as many words: english_spoken_level and english_written_level are in
-- CANDIDATE_MAPPED_QUESTION_KEYS and project onto candidates.english_*_level,
-- and a candidate who records English here as well leaves two contradictory
-- statements of one fact. There is no is_native column — spec §13 argues it out.
-- ---------------------------------------------------------------------------
insert into questions
  (id, category_id, key, label, help_text, question_type, audience,
   is_required, is_active, sort_order, validation)
select v.id, c.id, v.key, v.label, v.help_text, 'repeating_group', 'candidate',
       false, true, v.sort_order, v.validation
from (values
  ('00000000-0000-4000-8000-000000980001'::uuid,
   'candidate_experience',
   'skills_and_tools',
   'Skills & tools',
   'Pick a skill or tool, say how good you are with it, and add a note if it helps.',
   6,
   '{
      "repeatingGroup": {
        "columns": [
          {"key":"skill","label":"Skill","columnType":"single_select","isRequired":true,
           "widthWeight":2,"choices":{"from":"question_options"}},
          {"key":"proficiency","label":"Proficiency","columnType":"single_select","isRequired":true,
           "widthWeight":1,"choices":{"from":"inline","options":[
             {"value":"aware","label":"Aware"},
             {"value":"working","label":"Working"},
             {"value":"proficient","label":"Proficient"},
             {"value":"expert","label":"Expert"}]}},
          {"key":"notes","label":"Notes","columnType":"short_text","isRequired":false,
           "widthWeight":3,"maxLength":500}
        ],
        "minRows": 0, "maxRows": 20, "addRowLabel": "Add another"
      }
    }'::jsonb),

  -- `month` (YYYY-MM), not `date`: "March 2024" is what someone remembers about
  -- a job, and a fabricated day-of-month is a lie the row would carry forever.
  ('00000000-0000-4000-8000-000000980002'::uuid,
   'candidate_experience',
   'employment_history',
   'Employment history',
   'Your recent roles, most recent first. The month is enough — exact dates are not needed.',
   7,
   '{
      "repeatingGroup": {
        "columns": [
          {"key":"employer","label":"Employer","columnType":"short_text","isRequired":true,
           "widthWeight":2,"maxLength":200},
          {"key":"job_title","label":"Job title","columnType":"short_text","isRequired":true,
           "widthWeight":2,"maxLength":200},
          {"key":"from_month","label":"From","columnType":"month","isRequired":true,
           "widthWeight":1},
          {"key":"to_month","label":"To","columnType":"month","isRequired":false,
           "widthWeight":1},
          {"key":"summary","label":"What you did","columnType":"long_text","isRequired":false,
           "widthWeight":3,"maxLength":1000}
        ],
        "minRows": 0, "maxRows": 20, "addRowLabel": "Add another"
      }
    }'::jsonb),

  -- Education and Certifications join the library but get NO block on the
  -- default template (spec §13): all five tables at once would make /register —
  -- a public form with a completion rate — noticeably longer for no evidence.
  -- They are one drag away in the builder.
  ('00000000-0000-4000-8000-000000980003'::uuid,
   'candidate_experience',
   'education_history',
   'Education',
   'Where you studied. Add as many entries as you like.',
   8,
   '{
      "repeatingGroup": {
        "columns": [
          {"key":"school","label":"School","columnType":"short_text","isRequired":true,
           "widthWeight":3,"maxLength":200},
          {"key":"qualification","label":"Qualification","columnType":"short_text","isRequired":false,
           "widthWeight":3,"maxLength":200},
          {"key":"year","label":"Year","columnType":"number","isRequired":false,
           "widthWeight":1,"min":1950,"max":2100}
        ],
        "minRows": 0, "maxRows": 20, "addRowLabel": "Add another"
      }
    }'::jsonb),

  ('00000000-0000-4000-8000-000000980004'::uuid,
   'candidate_experience',
   'certifications',
   'Certifications',
   'Any certificates or courses worth knowing about.',
   9,
   '{
      "repeatingGroup": {
        "columns": [
          {"key":"name","label":"Certification","columnType":"short_text","isRequired":true,
           "widthWeight":3,"maxLength":200},
          {"key":"issuer","label":"Issued by","columnType":"short_text","isRequired":false,
           "widthWeight":3,"maxLength":200},
          {"key":"year","label":"Year","columnType":"number","isRequired":false,
           "widthWeight":1,"min":1950,"max":2100}
        ],
        "minRows": 0, "maxRows": 20, "addRowLabel": "Add another"
      }
    }'::jsonb),

  ('00000000-0000-4000-8000-000000980005'::uuid,
   'candidate_language',
   'other_languages',
   'Other languages you speak',
   'English is covered by the two questions above — list any other languages here.',
   3,
   '{
      "repeatingGroup": {
        "columns": [
          {"key":"language","label":"Language","columnType":"single_select","isRequired":true,
           "widthWeight":2,"choices":{"from":"question_options"}},
          {"key":"spoken_level","label":"Spoken","columnType":"single_select","isRequired":true,
           "widthWeight":1,"choices":{"from":"inline","options":[
             {"value":"basic","label":"Basic"},
             {"value":"conversational","label":"Conversational"},
             {"value":"professional","label":"Professional"},
             {"value":"native_equivalent","label":"Native or equivalent"}]}},
          {"key":"written_level","label":"Written","columnType":"single_select","isRequired":true,
           "widthWeight":1,"choices":{"from":"inline","options":[
             {"value":"basic","label":"Basic"},
             {"value":"conversational","label":"Conversational"},
             {"value":"professional","label":"Professional"},
             {"value":"native_equivalent","label":"Native or equivalent"}]}}
        ],
        "minRows": 0, "maxRows": 20, "addRowLabel": "Add another"
      }
    }'::jsonb)
) as v(id, category_key, key, label, help_text, sort_order, validation)
join question_categories c on c.key = v.category_key
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2a. The skills catalogue — a ONE-TIME COPY, not a view and not a sync.
--
-- THE TWO LISTS DIVERGE FROM HERE, and someone will be surprised by it later,
-- so it is written down: renaming or retiring a skill in these question options
-- does NOT change the `tools` or `skills` tables, and adding a row to `tools`
-- does NOT appear on this form. That is deliberate. DO NOT BUILD A SYNC.
--
-- The reason it is the right trade today is concrete: there is no admin
-- taxonomy screen at all. /admin/settings is a sidebar link to a
-- PlaceholderPage, and apps/api/src/routes/taxonomy.ts exposes only
-- GET/POST /tools and GET/POST /skills — create-only, with no update, no
-- deactivate and no delete. Rebecca cannot rename or retire a catalogue row
-- through the API. She CAN do all three through the question options editor she
-- already uses, which is the whole reason the copy lands here.
--
-- Consequence to record: the skill picker is a FLAT type-to-filter list of ~200
-- names, not grouped under Tech Stack / Leadership headings — question_options
-- has no category column. Rebecca's "organized by section" (18:01) was about
-- the candidate profile table (T7), a different surface.
--
-- distinct on (name): `tools` and `skills` are unique within themselves but not
-- across each other, and question_options carries unique (question_id, value).
-- They happen not to overlap today — checked, 102 + 98 = 200 distinct — but a
-- future row present in both tables must not break the seed.
--
-- value = label = the catalogue `name`. The names are already written
-- candidate-facing ("ClickUp", "Monday.com"), and a stable human-readable value
-- is what keeps an answer readable in its snapshot years later.
-- ---------------------------------------------------------------------------
insert into question_options (id, question_id, value, label, sort_order)
select md5('sdb.repeating_group.skill_option:' || catalogue.name)::uuid,
       '00000000-0000-4000-8000-000000980001',
       catalogue.name,
       catalogue.name,
       (row_number() over (order by catalogue.name))::int
from (
  select distinct on (name) name
  from (
    select name from tools  where is_active
    union all
    select name from skills where is_active
  ) both_tables
  order by name
) catalogue
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2b. A starter language list for `other_languages`.
--
-- ENGLISH IS NOT ON IT, and must never be added: english_spoken_level and
-- english_written_level already record it and project onto the candidates
-- table. LATAM-weighted, matching the country list's focus, with "Another
-- language" as the escape hatch Rebecca asked for on dropdowns (T15). A
-- starting point Rebecca edits in the options editor, not a taxonomy.
-- ---------------------------------------------------------------------------
insert into question_options (id, question_id, value, label, sort_order) values
  ('00000000-0000-4000-8000-000000980101', '00000000-0000-4000-8000-000000980005', 'Spanish',          'Spanish',           1),
  ('00000000-0000-4000-8000-000000980102', '00000000-0000-4000-8000-000000980005', 'Portuguese',       'Portuguese',        2),
  ('00000000-0000-4000-8000-000000980103', '00000000-0000-4000-8000-000000980005', 'French',           'French',            3),
  ('00000000-0000-4000-8000-000000980104', '00000000-0000-4000-8000-000000980005', 'Italian',          'Italian',           4),
  ('00000000-0000-4000-8000-000000980105', '00000000-0000-4000-8000-000000980005', 'German',           'German',            5),
  ('00000000-0000-4000-8000-000000980106', '00000000-0000-4000-8000-000000980005', 'Dutch',            'Dutch',             6),
  ('00000000-0000-4000-8000-000000980107', '00000000-0000-4000-8000-000000980005', 'Mandarin Chinese', 'Mandarin Chinese',  7),
  ('00000000-0000-4000-8000-000000980108', '00000000-0000-4000-8000-000000980005', 'Japanese',         'Japanese',          8),
  ('00000000-0000-4000-8000-000000980109', '00000000-0000-4000-8000-000000980005', 'Korean',           'Korean',            9),
  ('00000000-0000-4000-8000-000000980110', '00000000-0000-4000-8000-000000980005', 'Hindi',            'Hindi',            10),
  ('00000000-0000-4000-8000-000000980111', '00000000-0000-4000-8000-000000980005', 'Arabic',           'Arabic',           11),
  ('00000000-0000-4000-8000-000000980112', '00000000-0000-4000-8000-000000980005', 'Russian',          'Russian',          12),
  ('00000000-0000-4000-8000-000000980113', '00000000-0000-4000-8000-000000980005', 'Tagalog',          'Tagalog',          13),
  ('00000000-0000-4000-8000-000000980114', '00000000-0000-4000-8000-000000980005', 'Haitian Creole',   'Haitian Creole',   14),
  ('00000000-0000-4000-8000-000000980115', '00000000-0000-4000-8000-000000980005', 'Guarani',          'Guarani',          15),
  ('00000000-0000-4000-8000-000000980116', '00000000-0000-4000-8000-000000980005', 'Quechua',          'Quechua',          16),
  ('00000000-0000-4000-8000-000000980117', '00000000-0000-4000-8000-000000980005', 'Nahuatl',          'Nahuatl',          17),
  ('00000000-0000-4000-8000-000000980118', '00000000-0000-4000-8000-000000980005', 'Another language', 'Another language', 18)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 3. THREE blocks on the default template. No other form gains anything —
--    every write below is scoped to the single row where `is_default`.
--
-- -- rowSpan 20 is computed, not chosen -------------------------------------
-- The canvas grid has FIXED 8px rows, so rowSpan is the whole layout contract:
-- a block taller than rowSpan x 8px renders ON TOP of the one beneath it.
-- Guessing one is the bug migration 0026 existed to repair, so this number is
-- what apps/web/src/features/form-builder/block-height.ts actually returns —
-- obtained by running naturalRowSpan() against these exact questions and the
-- live version's theme (maxWidthPx 880, padding 24), and cross-checked by
-- reproducing the row spans already in the database for english_spoken_level
-- (21), english_written_level (18) and candidate_summary (20).
--
--   block width           blockWidthPx(24, 880 - 24 - 24) = 820px
--   label, one line       21px      text-sm x 1.5; "... (optional)" included
--   help text, one line   6 + 18    every help string here is < 124 chars
--   shell gap             6px
--   control, base state   100px     RG_HEADER 18 + gap 6 + one 36px row
--                                   + "Add another" 40 — max(minRows, 1) = 1
--                                   row, because rows added at fill time are
--                                   handled by shiftForGrowth, and reserving
--                                   maxRows would leave a ~900px hole
--   slack                 6px
--                       = 157px  ->  ceil(157 / 8) = 20 rows
--
-- -- Positions are derived, never hardcoded ---------------------------------
-- Anchored on question key and category key so they land beneath the same
-- questions on any database, whatever the page numbering. The +2 is
-- BLOCK_GAP_ROWS, the gap tidyBlocks leaves between stacked blocks and the
-- pitch every existing block on this form already uses.
-- ---------------------------------------------------------------------------

-- 3a. skills_and_tools, then employment_history beneath it, after the last
--     block on the "Your experience" step.
with target as (
  select f.published_version_id as version_id
  from candidate_forms f
  where f.is_default
    and f.published_version_id is not null
),
-- The page the experience questions live on. `order by count(*) desc` rather
-- than an assumption: if an admin has moved one of them to another step, the
-- new blocks follow the majority instead of landing on a page at random.
experience_page as (
  select b.page_index
  from candidate_form_blocks b
  join target t on t.version_id = b.form_version_id
  join questions q on q.id = b.question_id
  join question_categories c on c.id = q.category_id
  where c.key = 'candidate_experience'
  group by b.page_index
  order by count(*) desc, b.page_index
  limit 1
),
-- The bottom of EVERY block on that page, not just the experience ones — the
-- new blocks must clear whatever else an admin has dropped there.
experience_anchor as (
  select p.page_index,
         max((b.layout->'desktop'->>'row')::int
             + (b.layout->'desktop'->>'rowSpan')::int) as bottom,
         max(b.sort_order) as last_sort
  from experience_page p
  cross join target t
  join candidate_form_blocks b
    on b.form_version_id = t.version_id
   and b.page_index = p.page_index
  group by p.page_index
)
insert into candidate_form_blocks
  (id, form_version_id, block_type, question_id, page_index, sort_order, layout)
select spec.block_id,
       t.version_id,
       'question',
       spec.question_id,
       a.page_index,
       a.last_sort + spec.sort_offset,
       jsonb_build_object(
         'desktop', jsonb_build_object(
           'col', 0,
           'row', a.bottom + spec.row_offset,
           'colSpan', 24,
           'rowSpan', 20,
           'z', 0
         ),
         -- null = auto-stack in reading order on a phone, as 0021 wrote every
         -- other block on this form.
         'mobile', null
       )
from target t
cross join experience_anchor a
cross join (values
  -- row_offset: the gap (2) for the first, then gap + rowSpan + gap = 22 more.
  ('00000000-0000-4000-8000-000000980201'::uuid,
   '00000000-0000-4000-8000-000000980001'::uuid, 1,  2),
  ('00000000-0000-4000-8000-000000980202'::uuid,
   '00000000-0000-4000-8000-000000980002'::uuid, 2, 24)
) as spec(block_id, question_id, sort_offset, row_offset)
on conflict do nothing;

-- 3b. other_languages, INSIDE the existing `candidate_language` step, beneath
--     english_written_level.
--
-- THE POSITION IS THE REQUIREMENT, NOT A LAYOUT PREFERENCE. Change-request T6
-- is Rebecca at 15:49 — "You have Languages twice" — and its fix is "merge them
-- into ONE section: scalar fields first, then the languages list below."
-- Putting this table under the two English questions in the SAME existing
-- category IS that merge, delivered on the form. Moving the block to a new step
-- "for tidiness" would silently undo the change request. Do not move it.
--
-- The two English questions themselves are untouched: both are in
-- CANDIDATE_MAPPED_QUESTION_KEYS and project onto candidates.english_*_level.
with target as (
  select f.published_version_id as version_id
  from candidate_forms f
  where f.is_default
    and f.published_version_id is not null
),
english_written as (
  select b.page_index,
         (b.layout->'desktop'->>'row')::int
           + (b.layout->'desktop'->>'rowSpan')::int as bottom
  from candidate_form_blocks b
  join target t on t.version_id = b.form_version_id
  join questions q on q.id = b.question_id
  where q.key = 'english_written_level'
),
language_page as (
  select w.page_index,
         max((b.layout->'desktop'->>'row')::int
             + (b.layout->'desktop'->>'rowSpan')::int) as page_bottom,
         max(b.sort_order) as last_sort
  from english_written w
  cross join target t
  join candidate_form_blocks b
    on b.form_version_id = t.version_id
   and b.page_index = w.page_index
  group by w.page_index
)
insert into candidate_form_blocks
  (id, form_version_id, block_type, question_id, page_index, sort_order, layout)
select '00000000-0000-4000-8000-000000980203',
       t.version_id,
       'question',
       '00000000-0000-4000-8000-000000980005',
       w.page_index,
       p.last_sort + 1,
       jsonb_build_object(
         'desktop', jsonb_build_object(
           'col', 0,
           -- Beneath english_written_level. `greatest` only bites if an admin
           -- has since dropped something lower on this step: the block still
           -- sits in the Language section under the English fields, and can
           -- never render on top of anything.
           'row', greatest(w.bottom, p.page_bottom) + 2,
           'colSpan', 24,
           'rowSpan', 20,
           'z', 0
         ),
         'mobile', null
       )
from target t
cross join english_written w
join language_page p on p.page_index = w.page_index
on conflict do nothing;
