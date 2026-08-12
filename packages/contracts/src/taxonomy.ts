/**
 * Public taxonomy contract — `GET /api/v1/taxonomy/public` (docs/04-API.md §3):
 * active staffed engines → active departments → active role categories, for
 * the cascading selects on the public intake form. Field names follow the
 * table columns in docs/02-DATABASE.md §5, camelCased per the API convention.
 *
 * The web app's local parse (apps/web/src/features/intake-form/taxonomy.ts)
 * strips unknown keys, so additive fields are safe; the fields below must be
 * present with these exact names.
 */
import { z } from 'zod';

export const PublicRoleCategorySchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  label: z.string(),
  advertisedTitle: z.string().nullable(),
  description: z.string().nullable(),
});
export type PublicRoleCategory = z.infer<typeof PublicRoleCategorySchema>;

export const PublicDepartmentSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  label: z.string(),
  roleCategories: z.array(PublicRoleCategorySchema),
});
export type PublicDepartment = z.infer<typeof PublicDepartmentSchema>;

export const PublicEngineSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  departments: z.array(PublicDepartmentSchema),
});
export type PublicEngine = z.infer<typeof PublicEngineSchema>;

/** Payload of `GET /api/v1/taxonomy/public` (inside the `{ data }` envelope). */
export const PublicTaxonomySchema = z.object({
  engines: z.array(PublicEngineSchema),
});
export type PublicTaxonomy = z.infer<typeof PublicTaxonomySchema>;
