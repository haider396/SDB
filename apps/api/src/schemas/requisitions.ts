/**
 * API-local response envelopes for the requisition lifecycle, built from
 * @sdb/contracts. Shared by route validation and OpenAPI generation.
 */
import { z } from 'zod';
import {
  CollectionResponseSchema,
  EntityEventSchema,
  RequisitionDetailSchema,
  RequisitionSchema,
  SingleResponseSchema,
} from '@sdb/contracts';

export const RequisitionEnvelopeSchema = SingleResponseSchema(RequisitionSchema);

export const RequisitionDetailEnvelopeSchema = SingleResponseSchema(
  RequisitionDetailSchema,
);

/** Shared meta (includes the optional first-page `total`, UX 2.9). */
export const RequisitionCollectionSchema =
  CollectionResponseSchema(RequisitionSchema);

export const EventCollectionSchema = z.object({
  data: z.array(EntityEventSchema),
  meta: z.object({
    count: z.number().int().nonnegative(),
    nextCursor: z.string().nullable(),
  }),
});

export const RequisitionIdParamSchema = z.object({ id: z.string().uuid() });
