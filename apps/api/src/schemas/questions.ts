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
