-- 0012_fix_candidate_source_default.sql
--
-- 02-DATABASE.md §8.1 specifies `source candidate_source not null default
-- 'manual'::text::candidate_source`, but 'manual' is not a value of the
-- candidate_source enum ('manual' belongs to submission_channel). The default
-- as written fails at insert time for any row that omits `source`.
--
-- Forward-only fix: default to 'other'. The API repository layer always sets
-- `source` explicitly, so the default is a safety net only.

alter table candidates
  alter column source set default 'other'::candidate_source;
