/**
 * SQL for the `users` table (docs/02-DATABASE.md §3). No business logic here.
 * All queries are parameterised postgres.js tagged templates; rows are mapped
 * to camelCase domain objects explicitly.
 */
import type { AuthUser } from '@sdb/contracts';
import type { Queryable } from '../lib/db.js';

interface UserRow {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  avatar_path: string | null;
  timezone: string;
  is_active: boolean;
  last_login_at: Date | null;
}

function mapUser(row: UserRow): AuthUser {
  return {
    id: row.id,
    email: row.email,
    fullName: row.full_name,
    phone: row.phone,
    avatarPath: row.avatar_path,
    timezone: row.timezone,
    isActive: row.is_active,
    lastLoginAt: row.last_login_at === null ? null : row.last_login_at.toISOString(),
  };
}

export async function findUserById(
  sql: Queryable,
  userId: string,
): Promise<AuthUser | null> {
  const rows = await sql<UserRow[]>`
    select id, email, full_name, phone, avatar_path, timezone, is_active, last_login_at
    from users
    where id = ${userId}
      and archived_at is null
  `;
  const row = rows[0];
  return row === undefined ? null : mapUser(row);
}

export async function updateUserProfile(
  sql: Queryable,
  userId: string,
  profile: { fullName: string; timezone: string },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update users
    set full_name = ${profile.fullName},
        timezone  = ${profile.timezone},
        updated_at = now()
    where id = ${userId}
      and archived_at is null
    returning id
  `;
  return rows.length > 0;
}
