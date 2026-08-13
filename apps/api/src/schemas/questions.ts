/**
 * API-local response envelopes for question management, built from
 * @sdb/contracts schemas. Shared by route validation and OpenAPI generation.
 */
import { z } from 'zod';
import {
  QuestionCategorySchema,
  QuestionDeactivateWarningSchema,
  QuestionDetailSchema,
  QuestionSchema,
  SingleResponseSchema,
} from '@sdb/contracts';

export const QuestionEnvelopeSchema = SingleResponseSchema(QuestionDetailSchema);

export const QuestionCollectionSchema = z.object({
  data: z.array(QuestionSchema),
  meta: z.object({
    count: z.number().int().nonnegative(),
    nextCursor: z.string().nullable(),
  }),
});

export const QuestionDeactivateEnvelopeSchema = z.object({
  data: QuestionDetailSchema,
  warnings: z.array(QuestionDeactivateWarningSchema),
});

export const CategoryEnvelopeSchema = SingleResponseSchema(
  QuestionCategorySchema,
);

/**
 * `POST /question-categories/:id/deactivate` — 200 with warnings[] naming
 * ACTIVE questions in OTHER categories whose conditional controller lives in
 * this category (UX 2.7). Mirrors QuestionDeactivateEnvelopeSchema.
 */
export const CategoryDeactivateEnvelopeSchema = z.object({
  data: QuestionCategorySchema,
  warnings: z.array(QuestionDeactivateWarningSchema),
});

export const CategoryCollectionSchema = z.object({
  data: z.array(QuestionCategorySchema),
  meta: z.object({
    count: z.number().int().nonnegative(),
    nextCursor: z.string().nullable(),
  }),
});

export const ReorderResponseSchema = SingleResponseSchema(
  z.object({ reordered: z.literal(true) }),
);

export const UuidParamSchema = z.object({ id: z.string().uuid() });
export const OptionParamsSchema = z.object({
  id: z.string().uuid(),
  optionId: z.string().uuid(),
});
