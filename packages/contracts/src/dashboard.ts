/**
 * Dashboard and reporting contracts (docs/04-API.md §12,
 * docs/01-PRODUCT-OVERVIEW.md §6).
 *
 * - `ClientDashboardSchema` — `GET /client/dashboard`, the P5 landing page:
 *   own requisitions with client-visible stage summaries, the caller's
 *   pending actions, and recent client-visible events. Stage counts come
 *   from `client_visible_assignments` ONLY, so internal stages are
 *   structurally absent (CLAUDE.md rule 3).
 * - `AttentionQueueSchema` — `GET /admin/attention-queue`, the seven buckets
 *   of 01 §6 exactly, always all seven, in the documented order.
 * - `AdminStatsSchema` — `GET /admin/stats`.
 * - `RejectionReasonsReportSchema` — `GET /reports/rejection-reasons`, the
 *   report that justifies structured rejection reasons.
 * - `ListEventsQuerySchema` — `GET /events` audit-trail filters.
 */
import { z } from 'zod';
import {
  AssignmentStageSchema,
  RejectionActorSchema,
  RequisitionStatusSchema,
} from './enums.js';
import { ClientVisibleStageSchema } from './assignments.js';
import { EntityEventSchema } from './requisitions.js';

const isoTimestamp = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative();

// ---------------------------------------------------------------------------
// Client dashboard (04 §12, P5 landing page)
// ---------------------------------------------------------------------------

/** One of the caller's requisitions with its client-visible stage summary. */
export const ClientDashboardRequisitionSchema = z.object({
  id: z.string().uuid(),
  reference: z.string(),
  advertisedTitle: z.string().nullable(),
  status: RequisitionStatusSchema,
  submittedAt: isoTimestamp,
  updatedAt: isoTimestamp,
  /**
   * Counts per client-visible stage from `client_visible_assignments`.
   * Keys are absent (not zero) for stages with no assignments; internal
   * stages can never appear.
   */
  stageCounts: z.record(ClientVisibleStageSchema, count),
});
export type ClientDashboardRequisition = z.infer<
  typeof ClientDashboardRequisitionSchema
>;

/** A brief awaiting THIS caller's principal approval (J3). */
export const PendingPrincipalApprovalSchema = z.object({
  requisitionId: z.string().uuid(),
  reference: z.string(),
  advertisedTitle: z.string().nullable(),
  /** When the requisition last changed — the approval has waited since then. */
  since: isoTimestamp,
});
export type PendingPrincipalApproval = z.infer<
  typeof PendingPrincipalApprovalSchema
>;

/** A presented candidate the client has not yet decided on (J6). */
export const CandidateAwaitingReviewSchema = z.object({
  assignmentId: z.string().uuid(),
  requisitionId: z.string().uuid(),
  requisitionReference: z.string(),
  /** First name + last initial — gated PII stays gated (CLAUDE.md rule 4). */
  displayName: z.string(),
  presentedAt: isoTimestamp.nullable(),
});
export type CandidateAwaitingReview = z.infer<
  typeof CandidateAwaitingReviewSchema
>;

export const ClientDashboardSchema = z.object({
  requisitions: z.array(ClientDashboardRequisitionSchema),
  pendingActions: z.object({
    /** Empty unless the caller is a designated principal. */
    principalApprovals: z.array(PendingPrincipalApprovalSchema),
    candidatesAwaitingReview: z.array(CandidateAwaitingReviewSchema),
  }),
  /**
   * Recent requisition events for the caller's own requisitions, newest
   * first, app+trigger pairs de-duplicated. Assignment events are excluded:
   * their from-values can reference internal pipeline stages.
   */
  recentEvents: z.array(EntityEventSchema),
});
export type ClientDashboard = z.infer<typeof ClientDashboardSchema>;

// ---------------------------------------------------------------------------
// Admin attention queue (01 §6 — the seven buckets, exactly)
// ---------------------------------------------------------------------------

/** The seven bucket keys, in the 01 §6 table order. */
export const ATTENTION_QUEUE_BUCKET_KEYS = [
  'new_intake_submissions',
  'awaiting_principal_approval',
  'payment_confirmed_access_not_granted',
  'no_candidates_presented',
  'awaiting_client_feedback',
  'interview_without_outcome',
  'incomplete_webhook_candidates',
] as const;
export const AttentionQueueBucketKeySchema = z.enum(ATTENTION_QUEUE_BUCKET_KEYS);
export type AttentionQueueBucketKey = z.infer<
  typeof AttentionQueueBucketKeySchema
>;

/** What a queue item links to — each item links directly to the object. */
export const AttentionQueueEntityTypeSchema = z.enum([
  'requisition',
  'client',
  'assignment',
  'interview',
  'candidate',
]);
export type AttentionQueueEntityType = z.infer<
  typeof AttentionQueueEntityTypeSchema
>;

export const AttentionQueueItemSchema = z.object({
  entityType: AttentionQueueEntityTypeSchema,
  entityId: z.string().uuid(),
  /** Human reference of the linked object (REQ-…, CAN-…, company name). */
  reference: z.string(),
  /** One-line display label for the queue row. */
  label: z.string(),
  /** When the item entered the state that put it in the queue. */
  since: isoTimestamp,
});
export type AttentionQueueItem = z.infer<typeof AttentionQueueItemSchema>;

export const AttentionQueueBucketSchema = z.object({
  key: AttentionQueueBucketKeySchema,
  label: z.string(),
  /** Full count — `items` is capped, `count` is not. */
  count,
  /** Oldest first (most urgent), capped at 50 per bucket. */
  items: z.array(AttentionQueueItemSchema),
});
export type AttentionQueueBucket = z.infer<typeof AttentionQueueBucketSchema>;

export const AttentionQueueSchema = z.object({
  /** When these buckets were computed (5-minute refresh job, 06 §5). */
  computedAt: isoTimestamp,
  /** Always exactly seven, in ATTENTION_QUEUE_BUCKET_KEYS order. */
  buckets: z.array(AttentionQueueBucketSchema).length(7),
});
export type AttentionQueue = z.infer<typeof AttentionQueueSchema>;

/** Query-string booleans arrive as 'true'/'false' strings. */
const QueryBooleanSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

/** `?refresh=true` bypasses the cache and recomputes (tests, manual reload). */
export const AttentionQueueQuerySchema = z.object({
  refresh: QueryBooleanSchema.optional(),
});
export type AttentionQueueQuery = z.infer<typeof AttentionQueueQuerySchema>;

// ---------------------------------------------------------------------------
// Admin stats (04 §12)
// ---------------------------------------------------------------------------

export const AdminStatsSchema = z.object({
  /** Requisitions not at `placed` or `closed_unfilled`. */
  openRequisitions: count,
  /**
   * Assignment counts by stage across active (non-terminal) requisitions.
   * Keys absent for stages with no assignments.
   */
  candidatesByStage: z.record(AssignmentStageSchema, count),
  /**
   * Mean of (presented_at − assignment created_at) in days, over assignments
   * presented in the last 90 days. Null when nothing was presented.
   */
  averageDaysToPresent: z.number().nonnegative().nullable(),
  /** Placements with status = 'active'. */
  activePlacements: count,
});
export type AdminStats = z.infer<typeof AdminStatsSchema>;

// ---------------------------------------------------------------------------
// Rejection-reasons report (04 §12, AC-PL-15)
// ---------------------------------------------------------------------------

export const RejectionReasonsQuerySchema = z.object({
  from: isoTimestamp,
  to: isoTimestamp,
  actor: RejectionActorSchema.optional(),
  roleCategoryId: z.string().uuid().optional(),
});
export type RejectionReasonsQuery = z.infer<typeof RejectionReasonsQuerySchema>;

export const RejectionReasonRowSchema = z.object({
  actor: RejectionActorSchema,
  /** Null for free-text (`reasonOther`) rejections. */
  reasonId: z.string().uuid().nullable(),
  /** The reason's key, or 'other' for free-text rejections. */
  reasonKey: z.string(),
  label: z.string(),
  count,
  /** Free-text reasons, present on the 'other' row; empty elsewhere. */
  otherTexts: z.array(z.string()),
});
export type RejectionReasonRow = z.infer<typeof RejectionReasonRowSchema>;

export const RejectionReasonsReportSchema = z.object({
  from: isoTimestamp,
  to: isoTimestamp,
  actor: RejectionActorSchema.nullable(),
  roleCategoryId: z.string().uuid().nullable(),
  totalCount: count,
  /** Ordered actor asc, count desc, label asc. */
  rows: z.array(RejectionReasonRowSchema),
});
export type RejectionReasonsReport = z.infer<
  typeof RejectionReasonsReportSchema
>;

// ---------------------------------------------------------------------------
// Global event log (04 §12 GET /events)
// ---------------------------------------------------------------------------

export const ListEventsQuerySchema = z.object({
  entityType: z.string().min(1).max(64).optional(),
  entityId: z.string().uuid().optional(),
  eventType: z.string().min(1).max(64).optional(),
  actorId: z.string().uuid().optional(),
  from: isoTimestamp.optional(),
  to: isoTimestamp.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});
export type ListEventsQuery = z.infer<typeof ListEventsQuerySchema>;
