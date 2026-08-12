/**
 * API-local response envelopes for client management, built from
 * @sdb/contracts. Shared by route validation and OpenAPI generation.
 */
import { z } from 'zod';
import {
  ClientMemberSchema,
  ClientSchema,
  RevokeAccessResponseSchema,
  SingleResponseSchema,
} from '@sdb/contracts';

export const ClientEnvelopeSchema = SingleResponseSchema(ClientSchema);

export const ClientCollectionSchema = z.object({
  data: z.array(ClientSchema),
  meta: z.object({
    count: z.number().int().nonnegative(),
    nextCursor: z.string().nullable(),
  }),
});

export const MemberEnvelopeSchema = SingleResponseSchema(ClientMemberSchema);

export const MemberCollectionSchema = z.object({
  data: z.array(ClientMemberSchema),
  meta: z.object({
    count: z.number().int().nonnegative(),
    nextCursor: z.string().nullable(),
  }),
});

export const RevokeAccessEnvelopeSchema = SingleResponseSchema(
  RevokeAccessResponseSchema,
);

export const ClientIdParamSchema = z.object({ id: z.string().uuid() });

export const MemberParamsSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
});
