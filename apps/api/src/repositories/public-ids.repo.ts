/**
 * Shared public-id resolution (migration 0015_public_ids.sql).
 *
 * Candidates, clients, and requisitions carry a DB-generated 12-char base62
 * `public_id` alongside their internal uuid primary key. Single-resource
 * endpoints accept EITHER form in the `:id` segment; everything below the
 * route layer works with the internal uuid. This module is the ONE place
 * that maps an incoming reference to that uuid:
 *
 * - value matches the UUID shape  → returned as-is (no query; downstream
 *   lookups keep their existing existence/404 semantics)
 * - value matches the public-id shape → indexed `public_id` lookup;
 *   null when no row carries it
 * - anything else → null (the route param schema normally rejects these
 *   with a 400 before we get here)
 *
 * The resolver is identity-only on purpose: no archived_at filtering and no
 * tenancy logic — those stay with the callers so behaviour is byte-for-byte
 * identical between uuid and public-id addressing.
 */
import { PUBLIC_ID_REGEX } from '@sdb/contracts';
import type { Queryable } from '../lib/db.js';

export const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export function isUuid(value: string): boolean {
  return UUID_REGEX.test(value);
}

/** The three tables that carry a public_id column (0015). */
export type PublicIdTable = 'candidates' | 'clients' | 'requisitions';

/**
 * Resolve a uuid-or-public-id reference to the internal uuid, or null when
 * no row matches. See the module docblock for the exact semantics.
 */
export async function resolvePublicId(
  sql: Queryable,
  table: PublicIdTable,
  ref: string,
): Promise<string | null> {
  if (isUuid(ref)) return ref;
  if (!PUBLIC_ID_REGEX.test(ref)) return null;
  const rows = await sql<{ id: string }[]>`
    select id from ${sql(table)} where public_id = ${ref}
  `;
  return rows[0]?.id ?? null;
}
