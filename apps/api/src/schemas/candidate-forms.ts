/**
 * API-local response envelopes for the Candidate Form Builder, built from
 * @sdb/contracts schemas. Shared by route validation and OpenAPI generation.
 */
import { z } from 'zod';
import {
  ActivateFormResultSchema,
  CandidateFormDetailSchema,
  CandidateFormSchema,
  CandidateFormSummarySchema,
  CandidateFormVersionSchema,
  FormBlockSchema,
  FormPageSchema,
  FormThemeSchema,
  IntakeFormCategorySchema,
  SingleResponseSchema,
} from '@sdb/contracts';

export const CandidateFormEnvelopeSchema = SingleResponseSchema(
  CandidateFormDetailSchema,
);

export const CandidateFormCollectionSchema = z.object({
  data: z.array(CandidateFormSummarySchema),
  meta: z.object({
    count: z.number().int().nonnegative(),
    nextCursor: z.string().nullable(),
  }),
});

export const FormVersionEnvelopeSchema = SingleResponseSchema(
  CandidateFormVersionSchema,
);

export const FormBlockEnvelopeSchema = SingleResponseSchema(FormBlockSchema);

export const ActivateFormEnvelopeSchema = SingleResponseSchema(
  ActivateFormResultSchema,
);

export const FormStatusEnvelopeSchema = SingleResponseSchema(CandidateFormSchema);

export const DeletedEnvelopeSchema = SingleResponseSchema(
  z.object({ deleted: z.literal(true) }),
);

export const FormIdParamSchema = z.object({ id: z.string().uuid() });

export const FormVersionParamsSchema = z.object({
  id: z.string().uuid(),
  versionId: z.string().uuid(),
});

export const FormBlockParamsSchema = z.object({
  id: z.string().uuid(),
  versionId: z.string().uuid(),
  blockId: z.string().uuid(),
});

/**
 * The public payload for /f/:slug. Carries the new block/theme shape AND the
 * existing `categories` shape, so the current renderer keeps working while the
 * canvas renderer is built.
 */
export const PublicFormEnvelopeSchema = z.object({
  data: z.object({
    form: z.object({
      slug: z.string(),
      key: z.string(),
      label: z.string(),
      description: z.string().nullable(),
      hasTypingTest: z.boolean(),
      hasDocumentsStep: z.boolean(),
      isDefault: z.boolean(),
      roleCategory: z
        .object({ id: z.string().uuid(), key: z.string(), label: z.string() })
        .nullable(),
    }),
    formVersionId: z.string().uuid(),
    formVersionHash: z.string(),
    generatedAt: z.string().datetime({ offset: true }),
    theme: FormThemeSchema,
    pages: z.array(FormPageSchema),
    blocks: z.array(FormBlockSchema),
    categories: z.array(IntakeFormCategorySchema),
  }),
});
