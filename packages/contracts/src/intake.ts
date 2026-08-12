/**
 * Intake form engine contracts.
 * Source: docs/03-INTAKE-FORM-ENGINE.md §3.2 (form rendering response) and
 * §3.3 (submission payload).
 */
import { z } from 'zod';
import { QuestionTypeSchema } from './enums.js';
import { ValidationRulesSchema } from './validation-rules.js';

/** Recursive JSON value — the only shape allowed in `valueJson`. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(JsonValueSchema),
  ]),
);

/** Conditional operators supported by `questions.conditional_operator` (02 §6). */
export const ConditionalOperatorSchema = z.enum([
  'equals',
  'not_equals',
  'in',
  'is_true',
  'is_false',
]);
export type ConditionalOperator = z.infer<typeof ConditionalOperatorSchema>;

export const QuestionConditionalSchema = z.object({
  questionKey: z.string(),
  operator: ConditionalOperatorSchema,
  value: JsonValueSchema.nullable(),
});
export type QuestionConditional = z.infer<typeof QuestionConditionalSchema>;

export const IntakeFormOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
});
export type IntakeFormOption = z.infer<typeof IntakeFormOptionSchema>;

export const IntakeFormQuestionSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  label: z.string(),
  helpText: z.string().nullable(),
  placeholder: z.string().nullable(),
  questionType: QuestionTypeSchema,
  isRequired: z.boolean(),
  sortOrder: z.number().int(),
  validation: ValidationRulesSchema,
  options: z.array(IntakeFormOptionSchema),
  conditional: QuestionConditionalSchema.nullable(),
});
export type IntakeFormQuestion = z.infer<typeof IntakeFormQuestionSchema>;

export const IntakeFormCategorySchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  label: z.string(),
  description: z.string().nullable(),
  sortOrder: z.number().int(),
  questions: z.array(IntakeFormQuestionSchema),
});
export type IntakeFormCategory = z.infer<typeof IntakeFormCategorySchema>;

/** Response of `GET /api/v1/intake-form`. */
export const IntakeFormResponseSchema = z.object({
  formVersionHash: z.string(),
  generatedAt: z.string().datetime({ offset: true }),
  categories: z.array(IntakeFormCategorySchema),
});
export type IntakeFormResponse = z.infer<typeof IntakeFormResponseSchema>;

const ANSWER_VALUE_FIELDS = [
  'valueText',
  'valueNumber',
  'valueBoolean',
  'valueDate',
  'valueJson',
] as const;

/**
 * One answer in a submission. Exactly one of the value fields must be present
 * — mirrors the database `trg_answer_value_shape` trigger (02 §6.1).
 */
export const IntakeAnswerSchema = z
  .object({
    questionKey: z.string().min(1),
    valueText: z.string().optional(),
    valueNumber: z.number().optional(),
    valueBoolean: z.boolean().optional(),
    valueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'valueDate must be an ISO date (YYYY-MM-DD)')
      .optional(),
    valueJson: JsonValueSchema.optional(),
  })
  .superRefine((answer, ctx) => {
    const populated = ANSWER_VALUE_FIELDS.filter(
      (field) => answer[field] !== undefined,
    );
    if (populated.length !== 1) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Exactly one of ${ANSWER_VALUE_FIELDS.join(', ')} must be provided; received ${populated.length === 0 ? 'none' : populated.join(', ')}`,
      });
    }
  });
export type IntakeAnswer = z.infer<typeof IntakeAnswerSchema>;

/** Body of `POST /api/v1/intake-submissions`. */
export const IntakeSubmissionSchema = z.object({
  formVersionHash: z.string(),
  roleCategoryId: z.string().uuid(),
  answers: z.array(IntakeAnswerSchema).min(1),
});
export type IntakeSubmission = z.infer<typeof IntakeSubmissionSchema>;

/** `201` response of `POST /api/v1/intake-submissions` — nothing else is returned. */
export const IntakeSubmissionResponseSchema = z.object({
  requisitionReference: z.string(),
});
export type IntakeSubmissionResponse = z.infer<
  typeof IntakeSubmissionResponseSchema
>;
