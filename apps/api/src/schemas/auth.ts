/**
 * API-local response envelopes for the auth routes, built from @sdb/contracts
 * schemas. Shared by route validation and the OpenAPI generator.
 */
import { z } from 'zod';
import { AuthMeResponseSchema, SingleResponseSchema } from '@sdb/contracts';

export const AcceptInvitationResponseSchema = SingleResponseSchema(
  z.object({ accepted: z.literal(true) }),
);

export const AuthMeEnvelopeSchema = SingleResponseSchema(AuthMeResponseSchema);
