/**
 * API-local response envelopes for interviews (docs/04-API.md §10), built
 * from @sdb/contracts. Shared by route validation and OpenAPI generation.
 */
import { z } from 'zod';
import { InterviewSchema, SingleResponseSchema } from '@sdb/contracts';

const collectionMeta = z.object({
  count: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});

export const InterviewEnvelopeSchema = SingleResponseSchema(InterviewSchema);

export const InterviewCollectionSchema = z.object({
  data: z.array(InterviewSchema),
  meta: collectionMeta,
});

export const InterviewIdParamSchema = z.object({ id: z.string().uuid() });
