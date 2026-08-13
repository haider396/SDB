/**
 * Standard response envelopes and cursor pagination.
 * Source: docs/04-API.md §1 and §1.1.
 */
import { z } from 'zod';

/** `{ "data": { ... } }` — single-resource envelope factory. */
export function SingleResponseSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({ data });
}

export const CollectionMetaSchema = z.object({
  count: z.number().int().nonnegative(),
  /** Opaque cursor for the next page; null when there is no further page. */
  nextCursor: z.string().nullable(),
  /**
   * Full filtered row count (`count(*) over ()`), independent of `limit`.
   * Present only where cheap and accurate — the first (un-cursored) page of
   * the candidates, clients, requisitions, and notifications lists. Absent on
   * cursored pages and on endpoints that do not compute it.
   */
  total: z.number().int().nonnegative().optional(),
});
export type CollectionMeta = z.infer<typeof CollectionMetaSchema>;

/** `{ "data": [ ... ], "meta": { count, nextCursor } }` — collection envelope factory. */
export function CollectionResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({
    data: z.array(item),
    meta: CollectionMetaSchema,
  });
}

/**
 * `?limit=25&cursor=<opaque>` — cursor pagination query.
 * Max limit 100, default 25 (docs/04-API.md §1 "Pagination").
 * `z.coerce` because query-string values arrive as strings.
 */
export const CursorPaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});
export type CursorPaginationQuery = z.infer<typeof CursorPaginationQuerySchema>;
