-- 0024_candidate_email_identity.sql
--
-- Email is the candidate's identity. This is the constraint that makes that
-- true in the database rather than only in application code.
--
-- ── Why this is its own migration ───────────────────────────────────────────
-- Every other migration in this series either always succeeds or fails on a
-- coding error. This one can fail on DATA: if two live candidates already
-- share an address, the index cannot be built. That is not a bug to code
-- around — deciding which of two records is the real person is a judgement no
-- migration should make. So it stops, and says exactly what to look at.
--
-- ── The three layers, of which this is the last ─────────────────────────────
--   1. idx_candidates_email_live (0020) — makes the lookup fast.
--   2. pg_advisory_xact_lock on the email, taken at the top of the submit
--      transaction — what actually serialises two people submitting the same
--      address at the same moment.
--   3. this unique index — the backstop for every path that forgets layer 2,
--      including admin-entered candidates and anything written in future.
--
-- Layer 2 prevents the race; layer 3 means a missed lock is a clean 422
-- instead of a duplicate human being in the pipeline.
--
-- ── Scope: LIVE candidates only ─────────────────────────────────────────────
-- Archived rows are excluded, so archiving a candidate frees their address for
-- a fresh application. That is deliberate: an archived person must not silently
-- absorb a new registration.
--
-- ⚠ LANDMINE for whoever builds un-archiving. Restoring an archived candidate
-- whose address has since been claimed by someone else will raise 23505. No
-- un-archive path exists today; when one is written it must catch that and ask
-- a human which record wins. There is no correct automatic answer.
--
-- citext, so 'Ada@Example.com' and 'ada@example.com' are already the same
-- value to the index — no lower() and no functional index needed.

do $$
declare
  duplicate_addresses integer;
  affected_rows integer;
begin
  select count(*), coalesce(sum(n), 0)
    into duplicate_addresses, affected_rows
  from (
    select count(*) as n
    from candidates
    where email is not null
      and archived_at is null
    group by email
    having count(*) > 1
  ) as duplicates;

  if duplicate_addresses > 0 then
    raise exception
      'Cannot make candidate email unique: % address(es) are shared by % live candidates.',
      duplicate_addresses, affected_rows
      using
        detail =
          'Merge or archive the duplicates first. Archived rows are excluded by '
          'this index, so archiving the superseded record is enough.',
        hint =
          'select email, count(*), array_agg(public_id order by created_at) '
          'from candidates where email is not null and archived_at is null '
          'group by email having count(*) > 1;';
  end if;
end $$;

-- Replaces the plain index from 0020 rather than sitting beside it: a unique
-- index serves the same lookups, so keeping both would be two indexes doing
-- one job and two writes per insert.
drop index if exists idx_candidates_email_live;

create unique index idx_candidates_email_live
  on candidates (email)
  where email is not null
    and archived_at is null;

comment on index idx_candidates_email_live is
  'Candidate identity: one live candidate per email address. Archived rows are '
  'excluded so archiving frees the address. Un-archiving must handle 23505.';
