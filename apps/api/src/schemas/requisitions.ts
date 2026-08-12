/**
 * API-local response envelopes for the requisition lifecycle, built from
 * @sdb/contracts. Shared by route validation and OpenAPI generation.
 */
import { z } from 'zod';
import {
  EntityEventSchema,
  RequisitionDetailSchema,
  RequisitionSchema,
  SingleResponseSchema,
} from '@sdb/contracts';

export const RequisitionEnvelopeSchema = SingleResponseSchema(RequisitionSchema);

export const RequisitionDetailEnvelopeSchema = SingleResponseSchema(
  RequisitionDetailSchema,
);

export const RequisitionCollectionSchema = z.object({
  data: z.array(RequisitionSchema),
  meta: z.object({
    count: z.number().int().nonnegative(),
    nextCursor: z.string().nullable(),
  }),
});

export const EventCollectionSchema = z.object({
  data: z.array(EntityEventSchema),
  meta: z.object({
    count: z.number().int().nonnegative(),
    nextCursor: z.string().nullable(),
  }),
});

export const RequisitionIdParamSchema = z.object({ id: z.string().uuid() });
