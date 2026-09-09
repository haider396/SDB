-- 0027_grant_question_manage_to_admin.sql
--
-- Give the `admin` role `question.manage`, so an admin can actually use the
-- form builder and the question manager instead of only looking at them.
--
-- ── What was wrong ─────────────────────────────────────────────────────────
-- 0011 seeded `admin` as "every permission except settings.manage, user.manage
-- and question.manage":
--
--     where r.key = 'admin'
--       and p.key not in ('settings.manage', 'user.manage', 'question.manage')
--
-- That grouping made sense when `question.manage` meant "edit the twenty-odd
-- intake questions on the public client form" — a rare, config-shaped act next
-- to settings and user administration. It stopped making sense when the
-- candidate FORM BUILDER (0020–0026) was put behind the same key: routes/
-- candidate-forms.ts reuses `question.manage` deliberately, because "a form
-- builder is question configuration with a layout layer on top" and
-- PERMISSION_KEYS is documented as exhaustive for the MVP.
--
-- The result is a screen that opens and then refuses every write. `admin` DOES
-- hold `question.view`, and apps/web/src/router.tsx gates /admin/forms on
-- question.view — so an admin lands in the builder, drags blocks around, and
-- gets a 403 from every save, publish, block create and form activate. Reading
-- without writing is the worst of both: the UI implies the permission the API
-- withholds.
--
-- routes/candidate-forms.ts anticipated this exactly, in a header note that
-- this migration answers:
--
--     NOTE for whoever wires the first non-super-admin operator:
--     `question.manage` is seeded to super_admin ONLY ... That is a seed
--     decision, not a code one — see the plan's open items.
--
-- It is settled: admin AND super_admin both manage questions and forms
-- (client-approved, Haider). This is the seed change; the stale note and the
-- two tests that asserted the old rule are corrected in the same commit.
--
-- ── Why this is the whole fix ──────────────────────────────────────────────
-- `question.manage` is the ONLY permission any form-builder or question-manager
-- route requires for a write. Both routes/questions.ts and
-- routes/candidate-forms.ts declare exactly two keys — `question.view` for
-- reads, `question.manage` for writes — and `admin` already holds the first.
-- The one neighbouring surface, role-category choices in the forms list, is
-- served by the PUBLIC /taxonomy/public endpoint and needs no permission at
-- all. So there is no sibling grant hiding behind this one: nothing else in
-- these two screens 403s an admin.
--
-- `settings.manage` and `user.manage` stay super_admin-only. Taxonomy writes
-- (routes/taxonomy.ts) sit behind `settings.manage` and are deliberately NOT
-- touched here — that is a different screen and a different decision.
--
-- ── Fresh database vs. existing ────────────────────────────────────────────
-- A new environment runs 0011 (which grants admin everything but the three)
-- then 0027 (which adds back one of them) and lands on the same set of grants
-- an already-migrated database reaches. `on conflict do nothing` against the
-- (role_id, permission_id) primary key makes the insert a no-op on re-run, so
-- this file is safe to replay and reports zero changes the second time.
--
-- Deliberately scoped to one role and one permission: no `delete`, no
-- recompute of the whole matrix. Every other role's grants are untouched, and
-- in particular `client_admin` and `client_user` still do not hold
-- `question.manage` — they never did, and nothing below can give it to them.

insert into role_permissions (role_id, permission_id)
select r.id, p.id
from roles r
cross join permissions p
where r.key = 'admin'
  and p.key = 'question.manage'
on conflict do nothing;
