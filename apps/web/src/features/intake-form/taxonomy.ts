/**
 * Client-side shape of `GET /api/v1/taxonomy/public` (04-API.md §3):
 * active staffed engines → departments → role categories, for the cascading
 * selects. Field names follow the table columns in 02-DATABASE.md §5,
 * camelCased per the API convention. Unknown keys are stripped, not rejected,
 * so additive server changes cannot break the public form.
 */
import { z } from "zod";

export const PublicRoleCategorySchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  label: z.string(),
  advertisedTitle: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
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
  description: z.string().nullable().optional(),
  departments: z.array(PublicDepartmentSchema),
});
export type PublicEngine = z.infer<typeof PublicEngineSchema>;

export const PublicTaxonomySchema = z.object({
  engines: z.array(PublicEngineSchema),
});
export type PublicTaxonomy = z.infer<typeof PublicTaxonomySchema>;
