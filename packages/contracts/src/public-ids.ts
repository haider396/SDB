/**
 * Short public identifiers (migration 0015_public_ids.sql).
 *
 * Candidates, clients, and requisitions carry a DB-generated `public_id`:
 * 12 base62 characters (e.g. 'lSbqRVXPbTmC'). It is the URL-facing handle —
 * internal `uuid` primary keys stay, and the human REQ-/CAN- references stay.
 * Single-resource endpoints for these three entities accept EITHER the UUID
 * or the public id in the `:id` path segment.
 */
import { z } from 'zod';

export const PUBLIC_ID_LENGTH = 12;

/** Exactly 12 base62 characters. */
export const PUBLIC_ID_REGEX = /^[0-9A-Za-z]{12}$/;

export const PublicIdSchema = z.string().regex(PUBLIC_ID_REGEX, {
  message: 'Must be a 12-character base62 public id',
});
export type PublicId = z.infer<typeof PublicIdSchema>;

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/**
 * A path-parameter reference to a public-id-bearing entity: an internal UUID
 * or a 12-char base62 public id. Used by the API param schemas and by the
 * web router for candidate/client/requisition detail URLs.
 */
export const EntityRefSchema = z
  .string()
  .refine((value) => UUID_REGEX.test(value) || PUBLIC_ID_REGEX.test(value), {
    message: 'Must be a UUID or a 12-character public id',
  });
export type EntityRef = z.infer<typeof EntityRefSchema>;
