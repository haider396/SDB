-- 0020_candidate_form_builder.sql
--
-- Candidate Form Builder: an admin composes a candidate form on a canvas,
-- activates it, and shares the resulting public link.
--
-- WHY BLOCKS ARE ROWS, NOT A JSONB DOCUMENT
-- A form's layout is a tree, and storing it as one jsonb blob is the obvious
-- shape — but it fails on the same grounds 03 §1.1 rejected Option B for the
-- question engine:
--   1. No foreign key. A jsonb tree cannot reference questions(id), so
--      archiving a question would leave forms silently pointing at nothing,
--      discovered months later as UNKNOWN_QUESTION for a candidate mid-submit.
--      `question_id ... on delete restrict` makes that state unrepresentable.
--   2. Lost updates. Two admins arranging the same canvas both rewrite the
--      whole blob; last write wins. With rows, a drag is one UPDATE of one row.
--   3. The submit scope is a query — "which questions does this form ask?" is
--      one index scan here, and a recursive jsonb_path_query there.
--   4. Admin safety checks ("used by 3 live forms") need an index, not a scan.
--
-- Only geometry, styling and non-question content are jsonb, and none of it is
-- ever filtered, sorted, aggregated or joined on — which is precisely the rule
-- 03 §1.3 lays down for legitimate jsonb use.
--
-- A block never duplicates question content: label, type, options, validation
-- and conditionals all resolve from `questions` at render time. The single
-- exception is is_required_override, which is form-scoped POLICY rather than
-- question content (see its comment below).

-- ---------------------------------------------------------------------------
-- Forms
--
-- `slug` is the public link and is DB-owned (default generate_public_id(12),
-- migration 0015) exactly as public_id is on candidates/clients/requisitions:
-- the API never writes it, so it cannot be skipped, guessed from a sequence,
-- or spoofed by a caller.
-- ---------------------------------------------------------------------------
create table candidate_forms (
  id                    uuid primary key default gen_random_uuid(),
  slug                  text not null unique default generate_public_id(12),
  key                   text not null unique,          -- stable machine key
  label                 text not null,
  description           text,

  -- Each form is tied to a role, so applicants are tagged automatically.
  -- Nullable ONLY for the seeded general registration form, which is not
  -- role-specific; chk_form_role_category_required enforces the rest.
  role_category_id      uuid references role_categories(id) on delete restrict,

  -- Per-form optional steps. There is deliberately NO consent column:
  -- consent is unconditional, and without it a candidate can never be
  -- presented to a client (422 CONSENT_MISSING, AC-PL-05). A toggle here
  -- would be a bug, not a feature.
  has_typing_test       boolean not null default false,
  has_documents_step    boolean not null default false,

  is_default            boolean not null default false,
  status                text not null default 'draft'
                          check (status in ('draft', 'active', 'inactive')),
  published_version_id  uuid,                          -- FK added below
  activated_at          timestamptz,
  deactivated_at        timestamptz,

  created_by            uuid references users(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  archived_at           timestamptz,

  constraint chk_form_role_category_required
    check (is_default or role_category_id is not null),
  -- An active form must have something published to serve.
  constraint chk_form_active_needs_version
    check (status <> 'active' or published_version_id is not null)
);

-- Exactly one default form, ever. This is what keeps /register pinned to the
-- seeded template even if its slug is regenerated or its label changed.
create unique index uq_candidate_forms_default
  on candidate_forms (is_default) where is_default;

create index idx_candidate_forms_status
  on candidate_forms (status) where archived_at is null;

-- ---------------------------------------------------------------------------
-- Versions
--
-- question_snapshot (03 §1.4) already makes historical ANSWERS immune to later
-- question edits, so content needs no versioning. LAYOUT has no such
-- mechanism, so rather than invent a second snapshot the block tree is
-- versioned and each submission pins the version it was filled against.
--
-- `pages` are the form's steps: pure presentation, never filtered on, so jsonb
-- is correct. Shape: [{"index":0,"title":"About you","description":null}, ...]
-- ---------------------------------------------------------------------------
create table candidate_form_versions (
  id             uuid primary key default gen_random_uuid(),
  form_id        uuid not null references candidate_forms(id) on delete cascade,
  version_number int not null,
  pages          jsonb not null default '[]'::jsonb,
  theme          jsonb not null default '{}'::jsonb,
  created_by     uuid references users(id),
  created_at     timestamptz not null default now(),
  published_at   timestamptz,
  unique (form_id, version_number)
);

alter table candidate_forms
  add constraint candidate_forms_published_version_fk
  foreign key (published_version_id)
  references candidate_form_versions(id) on delete restrict;

-- ---------------------------------------------------------------------------
-- Blocks
-- ---------------------------------------------------------------------------
create table candidate_form_blocks (
  id               uuid primary key default gen_random_uuid(),
  form_version_id  uuid not null
                     references candidate_form_versions(id) on delete cascade,
  parent_block_id  uuid references candidate_form_blocks(id) on delete cascade,
  block_type       text not null check (block_type in
                     ('question', 'row', 'group', 'heading',
                      'paragraph', 'image', 'divider', 'spacer')),

  -- The ONLY link to question content. `on delete restrict` is the guarantee a
  -- jsonb tree cannot give: a question in use by a form cannot vanish.
  question_id      uuid references questions(id) on delete restrict,

  page_index       int not null default 0,
  sort_order       int not null default 0,

  -- Free-canvas geometry, per breakpoint:
  --   {"desktop":{"col":0,"row":0,"colSpan":12,"rowSpan":8,"z":0},
  --    "mobile":null}
  -- mobile null = auto-stack in reading order. Bounded by BlockLayoutSchema in
  -- packages/contracts — unbounded numbers here are a renderer DoS.
  layout           jsonb not null default '{}'::jsonb,
  -- Per-block overrides of the version theme. Colours are TOKEN NAMES, never
  -- hex; FormColorTokenSchema is what enforces the SDB palette (the web's
  -- AC-UI-01 lint rule is static and cannot see a value from this column).
  style            jsonb not null default '{}'::jsonb,
  -- Type-specific content for NON-question blocks: heading text, paragraph
  -- body, image storage_path, divider weight.
  props            jsonb not null default '{}'::jsonb,

  -- "Required ON THIS FORM". NOT content duplication: questions.is_required is
  -- the library default, this is form-scoped policy. Applied by overriding
  -- FormQuestionRecord.isRequired BEFORE it reaches validateSubmission, so the
  -- validator itself is untouched. NULL = inherit.
  is_required_override boolean,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),

  constraint chk_block_question_id check (
    (block_type = 'question' and question_id is not null)
    or (block_type <> 'question' and question_id is null)
  ),
  constraint chk_block_no_self_parent
    check (parent_block_id is distinct from id)
);

-- One block per question per version: an admin cannot drop the same question
-- on the canvas twice. Without this the duplicate surfaces at submit time as a
-- 422 for a candidate, instead of at build time for the admin.
create unique index uq_form_blocks_question
  on candidate_form_blocks (form_version_id, question_id)
  where question_id is not null;

create index idx_form_blocks_version
  on candidate_form_blocks (form_version_id, page_index, sort_order);

-- "Which forms use question X?" — needed before archiving a question.
create index idx_form_blocks_question
  on candidate_form_blocks (question_id) where question_id is not null;

-- ---------------------------------------------------------------------------
-- Submissions
--
-- The unit that makes the identity rule work (Haider, 4 Sep): one candidate
-- may submit each form ONCE, but may submit different forms — applying for
-- Video Editor and for Developer is one person with two applications.
--
--   * unique (form_id, candidate_id) enforces one-per-form AT THE DATABASE;
--   * candidate_answers.submission_id (below) is what lets the same question
--     be answered on two different forms.
--
-- role_category_id is denormalised from the form at submit time so that
-- re-tagging a form later does not rewrite history.
-- ---------------------------------------------------------------------------
create table candidate_form_submissions (
  id                   uuid primary key default gen_random_uuid(),
  form_id              uuid not null
                         references candidate_forms(id) on delete restrict,
  form_version_id      uuid not null
                         references candidate_form_versions(id) on delete restrict,
  candidate_id         uuid not null
                         references candidates(id) on delete cascade,
  role_category_id     uuid references role_categories(id) on delete set null,
  session_id           uuid references candidate_registration_sessions(id)
                         on delete set null,
  -- Provenance, not domain vocabulary — text + check, matching the precedent
  -- of candidate_files.virus_scan_status and notification_log.status.
  source               text not null default 'public_form'
                         check (source in ('public_form', 'backfill', 'admin')),
  form_version_hash    text,
  -- Did this submission create the candidate, or attach to an existing one?
  is_created_candidate boolean not null default false,
  answer_count         int not null default 0,
  ip_hash              text,     -- salted SHA-256, never a raw IP (NFR-12)
  submitted_at         timestamptz not null default now(),

  constraint uq_submission_per_form_per_candidate unique (form_id, candidate_id)
);

create index idx_form_submissions_candidate
  on candidate_form_submissions (candidate_id, submitted_at desc);

create index idx_form_submissions_role
  on candidate_form_submissions (role_category_id)
  where role_category_id is not null;

-- ---------------------------------------------------------------------------
-- Answers belong to a submission
--
-- candidate_answers currently has `unique (candidate_id, question_id)` — one
-- answer per question per candidate. That directly blocks the identity rule:
-- if the Video Editor and Developer forms both ask "what country are you in?",
-- the second application is refused by the database.
--
-- Replaced with two PARTIAL unique indexes rather than one three-column index.
-- A plain `unique (candidate_id, question_id, submission_id)` treats every
-- NULL as distinct, so it would silently permit unlimited duplicate
-- admin-entered answers — losing the very guarantee being replaced. (PG17
-- offers `nulls not distinct`, but the paired indexes state the two rules
-- explicitly and are version-proof.)
-- ---------------------------------------------------------------------------
alter table candidate_answers
  add column submission_id uuid
    references candidate_form_submissions(id) on delete cascade;

alter table candidate_answers
  drop constraint candidate_answers_candidate_id_question_id_key;

-- Rule 1: within one submission, a question is answered at most once.
create unique index uq_candidate_answers_per_submission
  on candidate_answers (candidate_id, question_id, submission_id)
  where submission_id is not null;

-- Rule 2: answers with no submission (admin-entered) keep the original
-- one-per-candidate rule. Existing rows all have submission_id null, so this
-- index IS the constraint just dropped — creation cannot fail on live data.
create unique index uq_candidate_answers_unsubmitted
  on candidate_answers (candidate_id, question_id)
  where submission_id is null;

create index idx_candidate_answers_submission
  on candidate_answers (submission_id) where submission_id is not null;

-- ---------------------------------------------------------------------------
-- updated_at triggers (0010 helper)
-- ---------------------------------------------------------------------------
create trigger trg_candidate_forms_updated_at
  before update on candidate_forms
  for each row execute function set_updated_at();

create trigger trg_candidate_form_blocks_updated_at
  before update on candidate_form_blocks
  for each row execute function set_updated_at();

-- ---------------------------------------------------------------------------
-- Email lookup for candidate identity
--
-- Layer 1 of 3. The lookup index only; it cannot fail on existing data.
-- Layer 2 is a transaction advisory lock in the submit path (the layer that
-- actually holds under concurrency) and layer 3 is the UNIQUE index, shipped
-- separately because it can fail on pre-existing duplicates.
--
-- `email` is citext, so this is case-insensitive with no lower() and no
-- functional index.
-- ---------------------------------------------------------------------------
create index idx_candidates_email_live
  on candidates (email)
  where email is not null and archived_at is null;

-- ---------------------------------------------------------------------------
-- RLS: deny-all, as for every other table (02 §13). All access is via the
-- API's service_role, which bypasses RLS.
-- ---------------------------------------------------------------------------
alter table candidate_forms enable row level security;
alter table candidate_forms force row level security;
alter table candidate_form_versions enable row level security;
alter table candidate_form_versions force row level security;
alter table candidate_form_blocks enable row level security;
alter table candidate_form_blocks force row level security;
alter table candidate_form_submissions enable row level security;
alter table candidate_form_submissions force row level security;

revoke all on candidate_forms from anon, authenticated;
revoke all on candidate_form_versions from anon, authenticated;
revoke all on candidate_form_blocks from anon, authenticated;
revoke all on candidate_form_submissions from anon, authenticated;
