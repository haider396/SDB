/**
 * API-local response envelopes for candidates, built from @sdb/contracts.
 * Shared by route validation and OpenAPI generation.
 */
import { z } from 'zod';
import {
  CandidateAssessmentSchema,
  CandidateCertificationSchema,
  CandidateDetailSchema,
  CandidateDisqualifierCheckSchema,
  CandidateEducationSchema,
  CandidateEmploymentSchema,
  CandidateFileSchema,
  CandidateLanguageSchema,
  CandidateNoteSchema,
  CandidateReferenceSchema,
  CandidateSchema,
  CandidateSkillSchema,
  CandidateToolSchema,
  CollectionResponseSchema,
  FileDownloadUrlResponseSchema,
  FileUploadUrlResponseSchema,
  SingleResponseSchema,
  WebhookResponseSchema,
} from '@sdb/contracts';

export const CandidateEnvelopeSchema = SingleResponseSchema(CandidateSchema);
export const CandidateDetailEnvelopeSchema =
  SingleResponseSchema(CandidateDetailSchema);
export const CandidateCollectionSchema = CollectionResponseSchema(CandidateSchema);

const unpagedCollection = <T extends z.ZodTypeAny>(item: T) =>
  z.object({
    data: z.array(item),
    meta: z.object({
      count: z.number().int().nonnegative(),
      nextCursor: z.null(),
    }),
  });

export const LanguageCollectionSchema = unpagedCollection(CandidateLanguageSchema);
export const ToolCollectionSchema = unpagedCollection(CandidateToolSchema);
export const SkillCollectionSchema = unpagedCollection(CandidateSkillSchema);
export const EmploymentCollectionSchema = unpagedCollection(
  CandidateEmploymentSchema,
);
export const EducationCollectionSchema = unpagedCollection(CandidateEducationSchema);
export const CertificationCollectionSchema = unpagedCollection(
  CandidateCertificationSchema,
);
export const ReferenceCollectionSchema = unpagedCollection(CandidateReferenceSchema);
export const NoteCollectionSchema = unpagedCollection(CandidateNoteSchema);
export const DisqualifierCheckCollectionSchema = unpagedCollection(
  CandidateDisqualifierCheckSchema,
);
export const AssessmentCollectionSchema = unpagedCollection(
  CandidateAssessmentSchema,
);
export const FileCollectionSchema = unpagedCollection(CandidateFileSchema);

export const CandidateFileEnvelopeSchema = SingleResponseSchema(CandidateFileSchema);
export const FileUploadUrlEnvelopeSchema = SingleResponseSchema(
  FileUploadUrlResponseSchema,
);
export const FileDownloadUrlEnvelopeSchema = SingleResponseSchema(
  FileDownloadUrlResponseSchema,
);
export const WebhookResponseEnvelopeSchema = WebhookResponseSchema;

export const CandidateIdParamSchema = z.object({ id: z.string().uuid() });
export const CandidateChildParamsSchema = z.object({
  id: z.string().uuid(),
  entryId: z.string().uuid(),
});
export const CandidateFileParamsSchema = z.object({
  id: z.string().uuid(),
  fileId: z.string().uuid(),
});
export const FileIdParamSchema = z.object({ fileId: z.string().uuid() });
