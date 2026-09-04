-- 0018_job_and_role_description.sql
--
-- Replaces the single admin-authored "brief" with the two documents Rebecca
-- distinguished on the 13 Aug call (35:09):
--
--   "A job description is what we present externally when we're looking for a
--    candidate. A role description is what they have once they're inside the
--    company."
--
-- Both are written by the CLIENT at intake (or by SDB when the client leaves
-- them blank), which is the opposite direction from the brief — that was
-- written by SDB for the client to approve. Haider chose (28 Aug) to drop the
-- brief rather than keep three overlapping text areas on one position.
--
-- `brief_markdown` is NOT dropped:
--   * migrations are forward-only and it holds real content;
--   * that content is the closest thing each position has to a job
--     description, so it is backfilled into the new column rather than
--     stranded.
-- The column simply stops being surfaced. A later migration can drop it once
-- the backfill is confirmed in production.
--
-- The sourcing gate Rebecca asked for — "we cannot look for the position until
-- we have the job description" — is enforced in the transition service, not by
-- a constraint here: a position legitimately sits without one while it is
-- still `submitted`, and only moving to `sourcing` is blocked.

alter table requisitions
  add column if not exists job_description  text,
  add column if not exists role_description text;

-- Existing briefs become the job description. Only where a brief exists and
-- the new column is still empty, so re-running cannot clobber a later edit.
update requisitions
   set job_description = brief_markdown
 where brief_markdown is not null
   and btrim(brief_markdown) <> ''
   and job_description is null;

comment on column requisitions.job_description is
  'External-facing role description used to attract candidates. Required before a requisition may move to sourcing (T16).';
comment on column requisitions.role_description is
  'Internal description of the role once the hire is onboard (T16).';
comment on column requisitions.brief_markdown is
  'DEPRECATED (0018): superseded by job_description. Retained for history; no longer surfaced in either portal.';
