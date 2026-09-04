/**
 * Question-management contracts (admin surface).
 * Source: docs/04-API.md §4 (endpoint table) and docs/03-INTAKE-FORM-ENGINE.md
 * §1.5 (edit guard rails) / §2 (super admin capabilities).
 *
 * Shared by API validation, the OpenAPI generator, and the admin front end.
 */
import { z } from 'zod';
import { QuestionAudienceSchema, QuestionTypeSchema } from './enums.js';
import { QuestionConditionalSchema } from './intake.js';
import { ValidationRulesSchema } from './validation-rules.js';

/** Machine keys: snake_case slugs (auto-generated from the label on create). */
export const QuestionKeySchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9_]*$/, 'key must be a snake_case slug');

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export const QuestionOptionSchema = z.object({
  id: z.string().uuid(),
  value: z.string(),
  label: z.string(),
  sortOrder: z.number().int(),
  isActive: z.boolean(),
});
export type QuestionOption = z.infer<typeof QuestionOptionSchema>;

export const CreateQuestionOptionBodySchema = z.object({
  value: z.string().min(1).max(200),
  label: z.string().min(1).max(500),
  sortOrder: z.number().int().optional(),
});
export type CreateQuestionOptionBody = z.infer<
  typeof CreateQuestionOptionBodySchema
>;

/**
 * PATCH body for an option. `value` is accepted here but the API blocks the
 * change once the option is referenced by any answer (03 §1.5).
 */
export const UpdateQuestionOptionBodySchema = z
  .object({
    label: z.string().min(1).max(500).optional(),
    sortOrder: z.number().int().optional(),
    value: z.string().min(1).max(200).optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateQuestionOptionBody = z.infer<
  typeof UpdateQuestionOptionBodySchema
>;

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

/** Admin view of a question (includes internal audience and inactive rows). */
export const QuestionSchema = z.object({
  id: z.string().uuid(),
  categoryId: z.string().uuid(),
  key: QuestionKeySchema,
  label: z.string(),
  helpText: z.string().nullable(),
  placeholder: z.string().nullable(),
  questionType: QuestionTypeSchema,
  audience: QuestionAudienceSchema,
  isRequired: z.boolean(),
  isActive: z.boolean(),
  sortOrder: z.number().int(),
  validation: ValidationRulesSchema,
  conditional: QuestionConditionalSchema.nullable(),
  options: z.array(QuestionOptionSchema),
  roleCategoryIds: z.array(z.string().uuid()),
  answerCount: z.number().int().nonnegative(),
  /** Present when requested via `includeAnswerCounts=true` or on detail reads. */
  lastAnsweredAt: z.string().datetime({ offset: true }).nullable().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  archivedAt: z.string().datetime({ offset: true }).nullable(),
});
export type Question = z.infer<typeof QuestionSchema>;

/** A question that conditionally depends on another (dependent listing). */
export const QuestionDependentSchema = z.object({
  id: z.string().uuid(),
  key: QuestionKeySchema,
  label: z.string(),
  isActive: z.boolean(),
});
export type QuestionDependent = z.infer<typeof QuestionDependentSchema>;

/** `GET /questions/:id` — question plus dependents and usage stats. */
/** A candidate form that has this question on one of its versions. */
export const QuestionFormUsageSchema = z.object({
  formId: z.string().uuid(),
  label: z.string(),
  status: z.string(),
});
export type QuestionFormUsage = z.infer<typeof QuestionFormUsageSchema>;

export const QuestionDetailSchema = QuestionSchema.extend({
  dependents: z.array(QuestionDependentSchema),
  /**
   * Which candidate forms use this question. Editing a question changes it for
   * all of them at once, so the builder shows this before letting an admin
   * rename wording or retire a question.
   */
  usedByForms: z.array(QuestionFormUsageSchema),
  lastAnsweredAt: z.string().datetime({ offset: true }).nullable(),
});
export type QuestionDetail = z.infer<typeof QuestionDetailSchema>;

export const CreateQuestionBodySchema = z.object({
  categoryId: z.string().uuid(),
  /** Auto-generated as a slug of the label when omitted. Immutable thereafter. */
  key: QuestionKeySchema.optional(),
  label: z.string().min(1).max(500),
  helpText: z.string().max(2000).nullable().optional(),
  placeholder: z.string().max(500).nullable().optional(),
  questionType: QuestionTypeSchema,
  audience: QuestionAudienceSchema,
  isRequired: z.boolean(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
  validation: z.record(z.unknown()).optional(),
  options: z.array(CreateQuestionOptionBodySchema).optional(),
  roleCategoryIds: z.array(z.string().uuid()).optional(),
  conditional: QuestionConditionalSchema.nullable().optional(),
});
export type CreateQuestionBody = z.infer<typeof CreateQuestionBodySchema>;

/**
 * PATCH body. `key` is accepted so the API can answer a re-key attempt with
 * the documented 409/422 instead of a generic 400; `questionType` likewise for
 * the QUESTION_TYPE_LOCKED path (03 §1.5).
 */
export const UpdateQuestionBodySchema = z
  .object({
    categoryId: z.string().uuid().optional(),
    key: QuestionKeySchema.optional(),
    label: z.string().min(1).max(500).optional(),
    helpText: z.string().max(2000).nullable().optional(),
    placeholder: z.string().max(500).nullable().optional(),
    questionType: QuestionTypeSchema.optional(),
    audience: QuestionAudienceSchema.optional(),
    isRequired: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    validation: z.record(z.unknown()).optional(),
    roleCategoryIds: z.array(z.string().uuid()).optional(),
    conditional: QuestionConditionalSchema.nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateQuestionBody = z.infer<typeof UpdateQuestionBodySchema>;

export const ReorderQuestionsBodySchema = z.object({
  categoryId: z.string().uuid(),
  orderedQuestionIds: z.array(z.string().uuid()).min(1),
});
export type ReorderQuestionsBody = z.infer<typeof ReorderQuestionsBodySchema>;

/**
 * `POST /questions/:id/deactivate` — 200 with warnings[] naming conditional
 * dependents (AC-Q-09, 03 §2.3).
 */
export const QuestionDeactivateWarningSchema = z.object({
  /**
   * CONDITIONAL_DEPENDENT — another question is shown based on this one and
   * will stop appearing.
   * MAPPED_QUESTION — this question fills a column on the candidate profile,
   * which stops being captured. Allowed, unlike deactivating 'email', which is
   * refused outright.
   */
  code: z.enum(['CONDITIONAL_DEPENDENT', 'MAPPED_QUESTION']),
  message: z.string(),
  /** Null for warnings that are about the question itself, not another one. */
  dependent: QuestionDependentSchema.nullable(),
});
export type QuestionDeactivateWarning = z.infer<
  typeof QuestionDeactivateWarningSchema
>;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export const QuestionCategorySchema = z.object({
  id: z.string().uuid(),
  key: QuestionKeySchema,
  label: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  /**
   * Which admin surface manages this category: 'candidate' categories belong
   * to the form builder, everything else to the Questions page. It does not
   * constrain the audience of the questions inside (0025).
   */
  audience: QuestionAudienceSchema,
  isActive: z.boolean(),
  questionCount: z.number().int().nonnegative(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type QuestionCategory = z.infer<typeof QuestionCategorySchema>;

export const CreateQuestionCategoryBodySchema = z.object({
  key: QuestionKeySchema.optional(),
  label: z.string().min(1).max(500),
  description: z.string().max(2000).nullable().optional(),
  sortOrder: z.number().int().optional(),
  /** Defaults to 'client' — the form builder passes 'candidate'. */
  audience: QuestionAudienceSchema.optional(),
});
export type CreateQuestionCategoryBody = z.infer<
  typeof CreateQuestionCategoryBodySchema
>;

export const UpdateQuestionCategoryBodySchema = z
  .object({
    label: z.string().min(1).max(500).optional(),
    description: z.string().max(2000).nullable().optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateQuestionCategoryBody = z.infer<
  typeof UpdateQuestionCategoryBodySchema
>;

export const ReorderQuestionCategoriesBodySchema = z.object({
  orderedCategoryIds: z.array(z.string().uuid()).min(1),
});
export type ReorderQuestionCategoriesBody = z.infer<
  typeof ReorderQuestionCategoriesBodySchema
>;

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Query-string booleans arrive as 'true'/'false' strings. */
const QueryBooleanSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

export const ListQuestionsQuerySchema = z.object({
  categoryId: z.string().uuid().optional(),
  /**
   * Filter by audience. Previously every consumer fetched the lot and filtered
   * in the browser, which meant the Questions page's search could surface
   * questions its own list does not show.
   */
  audience: QuestionAudienceSchema.optional(),
  isActive: QueryBooleanSchema.optional(),
  roleCategoryId: z.string().uuid().optional(),
  includeAnswerCounts: QueryBooleanSchema.optional(),
});
export type ListQuestionsQuery = z.infer<typeof ListQuestionsQuerySchema>;

export const ListQuestionCategoriesQuerySchema = z.object({
  isActive: QueryBooleanSchema.optional(),
  /** Omit for every category; the two admin surfaces each pass their own. */
  audience: QuestionAudienceSchema.optional(),
});
export type ListQuestionCategoriesQuery = z.infer<
  typeof ListQuestionCategoriesQuerySchema
>;
