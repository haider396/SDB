/**
 * API-local params and response envelopes for the public candidate
 * registration endpoints (T38), built from @sdb/contracts.
 */
import { z } from 'zod';
import {
  CandidateRegistrationFormResponseSchema,
  CandidateRegistrationResponseSchema,
  RegistrationSessionResponseSchema,
  RegistrationUploadUrlResponseSchema,
  SingleResponseSchema,
} from '@sdb/contracts';

export { RegistrationUploadUrlBodySchema } from '@sdb/contracts';

export const CandidateRegistrationFormEnvelopeSchema = SingleResponseSchema(
  CandidateRegistrationFormResponseSchema,
);

export const CandidateRegistrationEnvelopeSchema = SingleResponseSchema(
  CandidateRegistrationResponseSchema,
);

export const RegistrationSessionEnvelopeSchema = SingleResponseSchema(
  RegistrationSessionResponseSchema,
);

export const RegistrationUploadUrlEnvelopeSchema = SingleResponseSchema(
  RegistrationUploadUrlResponseSchema,
);

export const RegistrationConfirmEnvelopeSchema = SingleResponseSchema(
  z.object({ confirmed: z.literal(true) }),
);

export const SessionParamsSchema = z.object({
  sessionId: z.string().uuid(),
});

export const SessionFileParamsSchema = z.object({
  sessionId: z.string().uuid(),
  fileId: z.string().uuid(),
});
