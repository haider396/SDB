-- 0013_reference_sequences.sql
-- Sequence-backed reference generators for requisitions ('REQ-NNNNNN') and
-- candidates ('CAN-NNNNNN'). `nextval()` is concurrency-safe by construction
-- (AC-RQ-07: unique, sequential references under 50 concurrent creations),
-- unlike a max()+1 read inside the transaction.
--
-- Both start at 1000 so generated references can never collide with the
-- fixed dev-seed rows (REQ-000001 / REQ-000002 in supabase/seed/dev_seed.sql).
-- Forward-only; never edited after commit.

create sequence if not exists requisition_reference_seq start 1000;
create sequence if not exists candidate_reference_seq start 1000;
