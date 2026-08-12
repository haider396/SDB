/**
 * API-local response envelopes for the public intake endpoints and the
 * authenticated in-portal requisition creation, built from @sdb/contracts.
 */
import { z } from 'zod';
import {
  InPortalRequisitionResponseSchema,
  IntakeFormResponseSchema,
  IntakeSubmissionResponseSchema,
  PublicTaxonomySchema,
  SingleResponseSchema,
} from '@sdb/contracts';

export const IntakeFormEnvelopeSchema = SingleResponseSchema(
  IntakeFormResponseSchema,
);

export const TaxonomyEnvelopeSchema = SingleResponseSchema(PublicTaxonomySchema);

export const IntakeSubmissionEnvelopeSchema = SingleResponseSchema(
  IntakeSubmissionResponseSchema,
);

export const InPortalRequisitionEnvelopeSchema = SingleResponseSchema(
  InPortalRequisitionResponseSchema,
);

/**
 * Query for GET /intake-form and GET /questions/preview. `audience` is
 * accepted but ignored — the public form always serves audience 'client';
 * internal questions are never exposed under any parameter combination
 * (03 §3.2 rule 2, AC-IF-02).
 */
export const IntakeFormQuerySchema = z.object({
  roleCategoryId: z.string().uuid().optional(),
  audience: z.string().optional(),
});
