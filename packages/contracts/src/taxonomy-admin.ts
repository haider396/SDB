/**
 * Taxonomy-management contracts (admin surface).
 * Source: docs/04-API.md §5 — `settings.manage` for writes, `requisition.view`
 * for reads.
 *
 * Field names follow the table columns of docs/02-DATABASE.md §5 (migration
 * 0004), §7 disqualifiers (0007), and §8 rejection_reasons (0008), camelCased
 * per the API convention. None of these tables carry timestamps, so the
 * entities have none.
 *
 * Engines are a fixed set of five: no create/delete contract exists, and the
 * PATCH body is strict — only `label`, `isStaffed`, and `sortOrder` are
 * editable; any other field is rejected at validation time.
 */
import { z } from 'zod';
import { RejectionActorSchema } from './enums.js';

/** Machine keys: snake_case slugs (auto-generated from the label on create). */
export const TaxonomyKeySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9_]*$/, 'key must be a snake_case slug');

/** Query-string booleans arrive as 'true'/'false' strings. */
const QueryBooleanSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

// ---------------------------------------------------------------------------
// Engines — five fixed rows; label/isStaffed/sortOrder editable, nothing else
// ---------------------------------------------------------------------------

export const EngineSchema = z.object({
  id: z.string().uuid(),
  key: TaxonomyKeySchema,
  label: z.string(),
  description: z.string().nullable(),
  isStaffed: z.boolean(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});
export type Engine = z.infer<typeof EngineSchema>;

/**
 * `.strict()` deliberately: 04 §5 fixes engines to five rows with only these
 * three editable fields, so an attempt to touch `key`, `description`,
 * `isActive`, or anything else is a validation error — not silently stripped.
 */
export const UpdateEngineBodySchema = z
  .object({
    label: z.string().min(1).max(200).optional(),
    isStaffed: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateEngineBody = z.infer<typeof UpdateEngineBodySchema>;

// ---------------------------------------------------------------------------
// Departments — belong to an engine; key unique per engine
// ---------------------------------------------------------------------------

export const DepartmentSchema = z.object({
  id: z.string().uuid(),
  engineId: z.string().uuid(),
  key: TaxonomyKeySchema,
  label: z.string(),
  managerUserId: z.string().uuid().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});
export type Department = z.infer<typeof DepartmentSchema>;

export const CreateDepartmentBodySchema = z.object({
  engineId: z.string().uuid(),
  /** Auto-generated as a slug of the label when omitted. Immutable thereafter. */
  key: TaxonomyKeySchema.optional(),
  label: z.string().min(1).max(200),
  managerUserId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateDepartmentBody = z.infer<typeof CreateDepartmentBodySchema>;

/**
 * PATCH body. `key` is accepted so the API can answer a re-key attempt with
 * the documented 422 instead of a generic 400 (keys are immutable after
 * creation, as everywhere else in the system). `isActive: true` reactivates —
 * 04 §5 defines a deactivate action but no activate action, so reactivation
 * goes through PATCH.
 */
export const UpdateDepartmentBodySchema = z
  .object({
    key: TaxonomyKeySchema.optional(),
    label: z.string().min(1).max(200).optional(),
    managerUserId: z.string().uuid().nullable().optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateDepartmentBody = z.infer<typeof UpdateDepartmentBodySchema>;

export const ListDepartmentsQuerySchema = z.object({
  engineId: z.string().uuid().optional(),
  isActive: QueryBooleanSchema.optional(),
});
export type ListDepartmentsQuery = z.infer<typeof ListDepartmentsQuerySchema>;

// ---------------------------------------------------------------------------
// Role categories — belong to a department; key unique per department
// ---------------------------------------------------------------------------

export const RoleCategorySchema = z.object({
  id: z.string().uuid(),
  departmentId: z.string().uuid(),
  key: TaxonomyKeySchema,
  label: z.string(),
  advertisedTitle: z.string().nullable(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});
export type RoleCategory = z.infer<typeof RoleCategorySchema>;

export const CreateRoleCategoryBodySchema = z.object({
  departmentId: z.string().uuid(),
  /** Auto-generated as a slug of the label when omitted. Immutable thereafter. */
  key: TaxonomyKeySchema.optional(),
  label: z.string().min(1).max(200),
  advertisedTitle: z.string().max(200).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateRoleCategoryBody = z.infer<
  typeof CreateRoleCategoryBodySchema
>;

export const UpdateRoleCategoryBodySchema = z
  .object({
    key: TaxonomyKeySchema.optional(),
    label: z.string().min(1).max(200).optional(),
    advertisedTitle: z.string().max(200).nullable().optional(),
    description: z.string().max(2000).nullable().optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateRoleCategoryBody = z.infer<
  typeof UpdateRoleCategoryBodySchema
>;

export const ListRoleCategoriesQuerySchema = z.object({
  departmentId: z.string().uuid().optional(),
  engineId: z.string().uuid().optional(),
  isActive: QueryBooleanSchema.optional(),
});
export type ListRoleCategoriesQuery = z.infer<
  typeof ListRoleCategoriesQuerySchema
>;

// ---------------------------------------------------------------------------
// Reference data: tools, skills, industries (GET/POST only per 04 §5)
// ---------------------------------------------------------------------------

export const ToolSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  category: z.string().nullable(),
  isActive: z.boolean(),
});
export type Tool = z.infer<typeof ToolSchema>;

/** Skills share the tools shape (0004: identical columns). */
export const SkillSchema = ToolSchema;
export type Skill = z.infer<typeof SkillSchema>;

export const IndustrySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
});
export type Industry = z.infer<typeof IndustrySchema>;

export const CreateToolBodySchema = z.object({
  name: z.string().min(1).max(200),
  category: z.string().max(200).nullable().optional(),
});
export type CreateToolBody = z.infer<typeof CreateToolBodySchema>;

export const CreateSkillBodySchema = CreateToolBodySchema;
export type CreateSkillBody = z.infer<typeof CreateSkillBodySchema>;

export const CreateIndustryBodySchema = z.object({
  name: z.string().min(1).max(200),
});
export type CreateIndustryBody = z.infer<typeof CreateIndustryBodySchema>;

export const ListReferenceDataQuerySchema = z.object({
  isActive: QueryBooleanSchema.optional(),
});
export type ListReferenceDataQuery = z.infer<
  typeof ListReferenceDataQuerySchema
>;

// ---------------------------------------------------------------------------
// Disqualifiers (0007) — structured deal-breaker checks
// ---------------------------------------------------------------------------

export const DisqualifierSchema = z.object({
  id: z.string().uuid(),
  key: TaxonomyKeySchema,
  label: z.string(),
  /** Null = applies to all role categories. */
  roleCategoryId: z.string().uuid().nullable(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});
export type Disqualifier = z.infer<typeof DisqualifierSchema>;

export const CreateDisqualifierBodySchema = z.object({
  /** Auto-generated as a slug of the label when omitted. Immutable thereafter. */
  key: TaxonomyKeySchema.optional(),
  label: z.string().min(1).max(500),
  roleCategoryId: z.string().uuid().nullable().optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateDisqualifierBody = z.infer<
  typeof CreateDisqualifierBodySchema
>;

export const UpdateDisqualifierBodySchema = z
  .object({
    key: TaxonomyKeySchema.optional(),
    label: z.string().min(1).max(500).optional(),
    roleCategoryId: z.string().uuid().nullable().optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateDisqualifierBody = z.infer<
  typeof UpdateDisqualifierBodySchema
>;

export const ListDisqualifiersQuerySchema = z.object({
  roleCategoryId: z.string().uuid().optional(),
  isActive: QueryBooleanSchema.optional(),
});
export type ListDisqualifiersQuery = z.infer<
  typeof ListDisqualifiersQuerySchema
>;

// ---------------------------------------------------------------------------
// Rejection reasons (0008) — actor-scoped, key immutable after creation
// ---------------------------------------------------------------------------

export const RejectionReasonSchema = z.object({
  id: z.string().uuid(),
  key: TaxonomyKeySchema,
  label: z.string(),
  actor: RejectionActorSchema,
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});
export type RejectionReason = z.infer<typeof RejectionReasonSchema>;

export const CreateRejectionReasonBodySchema = z.object({
  /** Auto-generated as a slug of the label when omitted. Immutable thereafter. */
  key: TaxonomyKeySchema.optional(),
  label: z.string().min(1).max(500),
  /** Required: every reason belongs to exactly one deciding actor. */
  actor: RejectionActorSchema,
  sortOrder: z.number().int().optional(),
});
export type CreateRejectionReasonBody = z.infer<
  typeof CreateRejectionReasonBodySchema
>;

/**
 * PATCH body. `key` is accepted so a re-key attempt gets the documented 422
 * (key is immutable after creation — rejections reference reasons by id and
 * reporting groups by key).
 */
export const UpdateRejectionReasonBodySchema = z
  .object({
    key: TaxonomyKeySchema.optional(),
    label: z.string().min(1).max(500).optional(),
    actor: RejectionActorSchema.optional(),
    sortOrder: z.number().int().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateRejectionReasonBody = z.infer<
  typeof UpdateRejectionReasonBodySchema
>;

export const ListRejectionReasonsQuerySchema = z.object({
  actor: RejectionActorSchema.optional(),
  isActive: QueryBooleanSchema.optional(),
});
export type ListRejectionReasonsQuery = z.infer<
  typeof ListRejectionReasonsQuerySchema
>;
