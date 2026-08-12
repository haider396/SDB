/**
 * SQL behind the loadContext middleware and the auth routes
 * (docs/06-BACKEND.md §3 step 4; docs/02-DATABASE.md §3).
 *
 * Permissions resolve through user_roles → role_permissions → permissions.
 */
import type { PermissionKey, UserRoleKey } from '@sdb/contracts';
import type { Queryable } from '../lib/db.js';

export async function getRoleKeysForUser(
  sql: Queryable,
  userId: string,
): Promise<UserRoleKey[]> {
  const rows = await sql<{ key: UserRoleKey }[]>`
    select distinct r.key
    from user_roles ur
    join roles r on r.id = ur.role_id
    where ur.user_id = ${userId}
  `;
  return rows.map((row) => row.key);
}

export async function getPermissionKeysForUser(
  sql: Queryable,
  userId: string,
): Promise<PermissionKey[]> {
  const rows = await sql<{ key: PermissionKey }[]>`
    select distinct p.key
    from user_roles ur
    join role_permissions rp on rp.role_id = ur.role_id
    join permissions p on p.id = rp.permission_id
    where ur.user_id = ${userId}
  `;
  return rows.map((row) => row.key);
}

/** Client memberships, oldest first (a client user belongs to one client in MVP). */
export async function getClientIdsForUser(
  sql: Queryable,
  userId: string,
): Promise<string[]> {
  const rows = await sql<{ client_id: string }[]>`
    select client_id
    from client_members
    where user_id = ${userId}
    order by created_at asc
  `;
  return rows.map((row) => row.client_id);
}

/**
 * Single-use invitation acceptance: only flips `accepted_at` when it is still
 * null, so a replayed token affects zero rows and the service rejects it.
 * Returns the client_members id, or null when no unaccepted membership matched.
 */
export async function markInvitationAccepted(
  sql: Queryable,
  clientId: string,
  userId: string,
): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    update client_members
    set accepted_at = now()
    where client_id = ${clientId}
      and user_id = ${userId}
      and accepted_at is null
    returning id
  `;
  return rows[0]?.id ?? null;
}
