-- 0030_requisition_priority.sql
--
-- T18: SDB's own ranking of which open positions matter most.
--
-- Rebecca, 39:18 — Haider: "Priority matters." Rebecca: "Priority definitely
-- matters. Priority would need to be seen on the card, preview card."
--
-- ── Why this is NOT `urgency` ──────────────────────────────────────────────
-- `requisitions.urgency` already exists and is a different fact: it is the
-- CLIENT's stated timeline, answered on the intake form. `priority` is SDB's
-- operational ranking of its own work. They are allowed to disagree, and the
-- disagreement is the useful part — a client saying "immediately" on a role
-- whose job description has not been written is exactly what an admin wants
-- to see.
--
-- Two further reasons they cannot be one column, decided with Haider 9 Sep:
--
--   1. `urgency` is an intake ANSWER. It is frozen in `question_snapshot` as
--      the record of what that client was asked and what they said. Letting an
--      admin overwrite it would put the column and the snapshot in permanent
--      disagreement, which AC-IF-11 exists to prevent.
--   2. They have different authors. `urgency` is written by a client through a
--      public form; `priority` is admin-only. Merging them would mean either
--      letting a client set SDB's queue order, or silently discarding what the
--      client told us.
--
-- ── Shape ─────────────────────────────────────────────────────────────────
-- A native enum, mirrored as a Zod enum in packages/contracts (the house rule
-- for enums, 02-DATABASE §2). NOT NULL with a default, so every existing row
-- is valid the moment this applies and no backfill is needed — and so no
-- reader ever has to decide what a null priority means.
--
-- The values are ranked, not alphabetical: any ordering built on this must use
-- the enum's own order (Postgres orders an enum by declaration), never a
-- string sort, or "high" sorts above "urgent" and the ranking actively misleads.

create type requisition_priority as enum ('low', 'normal', 'high', 'urgent');

alter table requisitions
  add column priority requisition_priority not null default 'normal';

-- Positions are listed and grouped by this on the client portal, always within
-- one client. Partial: a closed or placed role is not what anyone is ranking.
create index idx_requisitions_priority
  on requisitions (client_id, priority)
  where status not in ('placed', 'closed_unfilled');

comment on column requisitions.priority is
  'SDB''s operational ranking of this position. Admin-writable only; visible to '
  'the client. Distinct from `urgency`, which is the client''s own stated '
  'timeline captured as an intake answer — see 0030 for why they are separate.';
