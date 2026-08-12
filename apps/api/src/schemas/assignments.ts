/**
 * API-local response envelopes for assignments and placements, built from
 * @sdb/contracts. Shared by route validation and OpenAPI generation.
 *
 * The dual-surface endpoints (GET /requisitions/:id/assignments and
 * GET /assignments/:id) serialise a union: AdminAssignmentRow for unscoped
 * callers, ClientVisibleAssignment for client-scoped callers. The union is
 * discriminated by shape, not by a flag — the client shape has no adminNote,
 * assignedBy, or candidate object, so the serialiser cannot leak internal
 * fields through the wrong branch.
 */
import { z } from 'zod';
import {
  AdminAssignmentRowSchema,
  ClientVisibleAssignmentSchema,
  EntityEventSchema,
  PlacementSchema,
  SingleResponseSchema,
} from '@sdb/contracts';

const collectionMeta = z.object({
  count: z.number().int().nonnegative(),
  nextCursor: z.string().nullable(),
});

/** Order matters: the client shape first, so a scoped row can never be
 * widened into the admin shape by a permissive first match. Zod unions try
 * options in order and both shapes are structurally disjoint (assignmentId
 * vs id + candidate). */
export const AssignmentRowUnionSchema = z.union([
  ClientVisibleAssignmentSchema,
  AdminAssignmentRowSchema,
]);

export const AssignmentEnvelopeSchema = SingleResponseSchema(
  AssignmentRowUnionSchema,
);

export const AdminAssignmentEnvelopeSchema = SingleResponseSchema(
  AdminAssignmentRowSchema,
);

export const ClientVisibleAssignmentEnvelopeSchema = SingleResponseSchema(
  ClientVisibleAssignmentSchema,
);

export const AssignmentCollectionSchema = z.object({
  data: z.array(AssignmentRowUnionSchema),
  meta: collectionMeta,
});

export const AdminAssignmentCollectionSchema = z.object({
  data: z.array(AdminAssignmentRowSchema),
  meta: collectionMeta,
});

export const PlacementEnvelopeSchema = SingleResponseSchema(PlacementSchema);

export const PlacementCollectionSchema = z.object({
  data: z.array(PlacementSchema),
  meta: collectionMeta,
});

export const AssignmentEventCollectionSchema = z.object({
  data: z.array(EntityEventSchema),
  meta: collectionMeta,
});

export const AssignmentIdParamSchema = z.object({ id: z.string().uuid() });
export const PlacementIdParamSchema = z.object({ id: z.string().uuid() });
