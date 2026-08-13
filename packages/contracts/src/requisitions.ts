/**
 * Requisition lifecycle contracts (admin + client portal).
 * Source: docs/04-API.md §7 (endpoint table), docs/02-DATABASE.md §7
 * (requisitions), docs/01-PRODUCT-OVERVIEW.md §3 J3 / §4 (state machine).
 *
 * Commercial fields (budget* and serviceTier) are OPTIONAL on purpose: for a
 * caller without `requisition.view_commercials` the keys are ABSENT from the
 * payload — not null (AC-RQ-06). The API builds the object conditionally.
 */
import { z } from 'zod';
import {
  EngagementTypeSchema,
  RateUnitSchema,
  RequisitionStatusSchema,
  SeniorityLevelSchema,
  ServiceTierSchema,
  UserRoleKeySchema,
} from './enums.js';
import { IntakeAnswerSchema, JsonValueSchema } from './intake.js';

/** `time` columns (overlap_start/_end) — 'HH:MM' or 'HH:MM:SS'. */
const timeOfDay = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);

// ---------------------------------------------------------------------------
// Commercial fields (gated by requisition.view_commercials — AC-RQ-06)
// ---------------------------------------------------------------------------

export const RequisitionCommercialFieldsSchema = z.object({
  budgetMin: z.number().nullable(),
  budgetMax: z.number().nullable(),
  budgetUnit: RateUnitSchema.nullable(),
  budgetCurrency: z.string().length(3).nullable(),
  budgetIsFlexible: z.boolean().nullable(),
  serviceTier: ServiceTierSchema.nullable(),
});
export type RequisitionCommercialFields = z.infer<
  typeof RequisitionCommercialFieldsSchema
>;

/** The camelCase keys stripped for callers without the permission. */
export const REQUISITION_COMMERCIAL_KEYS = [
  'budgetMin',
  'budgetMax',
  'budgetUnit',
  'budgetCurrency',
  'budgetIsFlexible',
  'serviceTier',
] as const;
export type RequisitionCommercialKey =
  (typeof REQUISITION_COMMERCIAL_KEYS)[number];

// ---------------------------------------------------------------------------
// Resource shapes
// ---------------------------------------------------------------------------

/** List item for `GET /requisitions`. */
export const RequisitionSchema = z
  .object({
    id: z.string().uuid(),
    reference: z.string(),
    clientId: z.string().uuid(),
    clientName: z.string(),
    engineId: z.string().uuid().nullable(),
    departmentId: z.string().uuid().nullable(),
    roleCategoryId: z.string().uuid().nullable(),
    advertisedTitle: z.string().nullable(),
    headcount: z.number().int(),
    status: RequisitionStatusSchema,
    seniorityLevel: SeniorityLevelSchema.nullable(),
    engagementType: EngagementTypeSchema.nullable(),
    hoursPerWeek: z.number().int().nullable(),
    /** Required working-hours overlap window (02 §7), e.g. 09:00–14:00. */
    overlapStart: timeOfDay.nullable(),
    overlapEnd: timeOfDay.nullable(),
    overlapTimezone: z.string().nullable(),
    targetStartDate: z.string().nullable(),
    urgency: z.string().nullable(),
    principalUserId: z.string().uuid().nullable(),
    principalApprovedAt: z.string().datetime({ offset: true }).nullable(),
    submittedAt: z.string().datetime({ offset: true }),
    sourcingStartedAt: z.string().datetime({ offset: true }).nullable(),
    closedAt: z.string().datetime({ offset: true }).nullable(),
    createdAt: z.string().datetime({ offset: true }),
    updatedAt: z.string().datetime({ offset: true }),
  })
  .merge(RequisitionCommercialFieldsSchema.partial());
export type Requisition = z.infer<typeof RequisitionSchema>;

const TaxonomyLabelSchema = z.object({
  id: z.string().uuid(),
  key: z.string(),
  label: z.string(),
});

/** One stored answer with its immutable snapshot (03 §1.4). */
export const RequisitionAnswerSchema = z.object({
  id: z.string().uuid(),
  questionId: z.string().uuid(),
  questionKey: z.string(),
  /** Label/type as at answer time, lifted from the snapshot for rendering. */
  label: z.string(),
  questionType: z.string(),
  valueText: z.string().nullable(),
  valueNumber: z.number().nullable(),
  valueBoolean: z.boolean().nullable(),
  valueDate: z.string().nullable(),
  valueJson: JsonValueSchema.nullable(),
  selectedOptions: z.array(z.object({ value: z.string(), label: z.string() })),
  questionSnapshot: z.record(z.unknown()),
  answeredBy: z.string().uuid().nullable(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
});
export type RequisitionAnswer = z.infer<typeof RequisitionAnswerSchema>;

/**
 * Detail for `GET /requisitions/:id`: answers with snapshots, taxonomy
 * labels, counts by stage. Commercial keys absent without the permission.
 */
export const RequisitionDetailSchema = RequisitionSchema.extend({
  regionPreference: z.string().nullable(),
  briefMarkdown: z.string().nullable(),
  principalChangeRequest: z.string().nullable(),
  intakeContactName: z.string().nullable(),
  intakeContactEmail: z.string().nullable(),
  taxonomy: z.object({
    engine: TaxonomyLabelSchema.nullable(),
    department: TaxonomyLabelSchema.nullable(),
    roleCategory: TaxonomyLabelSchema.nullable(),
  }),
  answers: z.array(RequisitionAnswerSchema),
  /** Assignment counts by stage; client callers see client-visible stages only. */
  countsByStage: z.record(z.number().int().nonnegative()),
});
export type RequisitionDetail = z.infer<typeof RequisitionDetailSchema>;

// ---------------------------------------------------------------------------
// Queries and bodies (04 §7)
// ---------------------------------------------------------------------------

export const ListRequisitionsQuerySchema = z.object({
  status: RequisitionStatusSchema.optional(),
  /** Admin only — client callers are implicitly scoped and may not filter. */
  clientId: z.string().uuid().optional(),
  engineId: z.string().uuid().optional(),
  roleCategoryId: z.string().uuid().optional(),
  search: z.string().min(1).max(200).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});
export type ListRequisitionsQuery = z.infer<typeof ListRequisitionsQuerySchema>;

/**
 * `PATCH /requisitions/:id` — admin fields including briefMarkdown, budget,
 * headcount, principalUserId. `budgetUnit` is mandatory whenever a budget
 * amount is present (02 §7) — enforced by the API, not the schema, so the
 * check can consider the stored row on partial updates.
 */
export const UpdateRequisitionBodySchema = z
  .object({
    advertisedTitle: z.string().max(500).nullable().optional(),
    briefMarkdown: z.string().max(100_000).nullable().optional(),
    headcount: z.number().int().min(1).optional(),
    budgetMin: z.number().nonnegative().nullable().optional(),
    budgetMax: z.number().nonnegative().nullable().optional(),
    budgetUnit: RateUnitSchema.nullable().optional(),
    budgetCurrency: z.string().length(3).nullable().optional(),
    budgetIsFlexible: z.boolean().nullable().optional(),
    serviceTier: ServiceTierSchema.nullable().optional(),
    seniorityLevel: SeniorityLevelSchema.nullable().optional(),
    engagementType: EngagementTypeSchema.nullable().optional(),
    hoursPerWeek: z.number().int().min(1).max(168).nullable().optional(),
    overlapStart: timeOfDay.nullable().optional(),
    overlapEnd: timeOfDay.nullable().optional(),
    overlapTimezone: z.string().max(100).nullable().optional(),
    targetStartDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .nullable()
      .optional(),
    urgency: z.string().max(200).nullable().optional(),
    regionPreference: z.string().max(500).nullable().optional(),
    principalUserId: z.string().uuid().nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateRequisitionBody = z.infer<typeof UpdateRequisitionBodySchema>;

/** `PATCH /requisitions/:id/answers` — upsert via the intake pipeline. */
export const UpdateRequisitionAnswersBodySchema = z.object({
  answers: z.array(IntakeAnswerSchema).min(1),
});
export type UpdateRequisitionAnswersBody = z.infer<
  typeof UpdateRequisitionAnswersBodySchema
>;

/** `POST /requisitions/:id/transition` — validated against 01 §4. */
export const TransitionRequisitionBodySchema = z.object({
  toStatus: RequisitionStatusSchema,
  note: z.string().max(5000).optional(),
});
export type TransitionRequisitionBody = z.infer<
  typeof TransitionRequisitionBodySchema
>;

/** `POST /requisitions/:id/principal-request-changes` — comment required. */
export const PrincipalRequestChangesBodySchema = z.object({
  comment: z.string().min(1).max(5000),
});
export type PrincipalRequestChangesBody = z.infer<
  typeof PrincipalRequestChangesBodySchema
>;

// ---------------------------------------------------------------------------
// Events (04 §7 GET /requisitions/:id/events, 06 §2.3)
// ---------------------------------------------------------------------------

export const EntityEventSchema = z.object({
  id: z.string().uuid(),
  entityType: z.string(),
  entityId: z.string().uuid(),
  eventType: z.string(),
  actorId: z.string().uuid().nullable(),
  /**
   * The acting user's full_name, joined from `users` at read time (UX 2.10 —
   * "named humans build trust"). Null for system/trigger-sourced events or
   * when the user row is gone. On client-facing surfaces these are
   * requisition-level events already visible to the client; exposing the
   * name is approved product behaviour.
   */
  actorName: z.string().nullable(),
  actorRole: UserRoleKeySchema.nullable(),
  fromValue: z.string().nullable(),
  toValue: z.string().nullable(),
  metadata: z.record(z.unknown()),
  occurredAt: z.string().datetime({ offset: true }),
});
export type EntityEvent = z.infer<typeof EntityEventSchema>;
