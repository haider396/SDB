-- 0014_client_members_archived_at.sql
--
-- Why this migration exists (P2): docs/04-API.md §6 requires
-- `DELETE /clients/:id/members/:userId` to be a *soft* removal, and
-- docs/06-BACKEND.md §5 requires the `expire-stale-invitations` job to
-- invalidate unaccepted invitations after 14 days. The 0003 schema gives
-- `client_members` no column that can carry either state, and hard deletes on
-- business entities are forbidden (CLAUDE.md conventions). Per the repo's
-- soft-delete convention this adds `archived_at timestamptz null`.
--
-- Semantics:
-- - An archived membership no longer scopes the user to the client, is not
--   returned by member listings, and its invitation can no longer be accepted
--   (the acceptance UPDATE additionally requires `archived_at is null`).
-- - Removal / expiry also clears `is_primary_contact` and `is_principal`, so
--   the 0003 partial unique indexes (which are not archival-aware and are
--   forward-only) never block appointing a replacement. Enforced in the API
--   layer; re-invites revive the archived row instead of inserting a
--   duplicate, keeping `unique (client_id, user_id)` intact.

alter table client_members
  add column archived_at timestamptz;
