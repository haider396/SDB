/**
 * API-local response envelopes for dashboards, stats, reports, and the
 * global event log (docs/04-API.md §12), built from @sdb/contracts. Shared
 * by route validation and OpenAPI generation.
 */
import { z } from 'zod';
import {
  AdminStatsSchema,
  AttentionQueueSchema,
  ClientDashboardSchema,
  EntityEventSchema,
  RejectionReasonsReportSchema,
  SingleResponseSchema,
} from '@sdb/contracts';

export const ClientDashboardEnvelopeSchema = SingleResponseSchema(
  ClientDashboardSchema,
);

export const AttentionQueueEnvelopeSchema = SingleResponseSchema(
  AttentionQueueSchema,
);

export const AdminStatsEnvelopeSchema = SingleResponseSchema(AdminStatsSchema);

export const RejectionReasonsReportEnvelopeSchema = SingleResponseSchema(
  RejectionReasonsReportSchema,
);

/** `GET /events` — a real cursor, unlike the unpaged nested event lists. */
export const GlobalEventCollectionSchema = z.object({
  data: z.array(EntityEventSchema),
  meta: z.object({
    count: z.number().int().nonnegative(),
    nextCursor: z.string().nullable(),
  }),
});
