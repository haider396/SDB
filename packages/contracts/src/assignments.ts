/**
 * Assignment, pipeline, and placement contracts (docs/04-API.md §9 and §11,
 * docs/02-DATABASE.md §9 and §11, docs/01-PRODUCT-OVERVIEW.md §3 J4–J8 / §5).
 *
 * Two candidate-bearing shapes exist ON PURPOSE and must never be merged:
 *
 * - `AdminAssignmentRowSchema` — the internal row: full assignment columns
 *   plus an internal candidate summary. Admin surface only.
 * - `ClientVisibleAssignmentSchema` — THE contract for the P5 client UI,
 *   built column-for-column from the `client_visible_assignments` view
 *   (02 §11). It is the only candidate shape a client-scoped endpoint may
 *   return (CLAUDE.md rules 3–4). Gated PII fields are explicitly nullable:
 *   the view emits SQL NULL for them until the assignment stage reaches
 *   `interview_scheduled` (or later: `interviewed`, `offer`, `placed` —
 *   PII_UNLOCKED_STAGES). Gated fields: `lastName`, `email`, `phone`,
 *   `whatsapp`, `linkedinUrl`, `currentEmployer` (GATED_PII_FIELDS), plus
 *   `firstName`, which the view also gates — clients identify candidates by
 *   `displayName` until PII unlocks.
 *
 * Rejection bodies deliberately carry NO actor field: the rejection actor is
 * derived from the caller's role server-side, never from the request
 * (AC-PL-09/10). Unknown keys are stripped by Zod, so a spoofed `actor` in
 * the body is discarded before it reaches any handler.
 */
import { z } from 'zod';
import {
  AccentStrengthSchema,
  AssignmentStageSchema,
  AutonomyLevelSchema,
  CandidateFileTypeSchema,
  DataCompletenessSchema,
  EngagementTypeSchema,
  LanguageLevelSchema,
  PlacementStatusSchema,
  PoolStatusSchema,
  RateUnitSchema,
  SeniorityLevelSchema,
  ServiceTierSchema,
  VettingStatusSchema,
} from './enums.js';
import { CLIENT_VISIBLE_STAGES } from './stages.js';

const isoTimestamp = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** `time` columns (overlap_start/_end) — 'HH:MM' or 'HH:MM:SS'. */
const timeOfDay = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);

// ---------------------------------------------------------------------------
// Assignment core row (02 §9)
// ---------------------------------------------------------------------------

export const AssignmentSchema = z.object({
  id: z.string().uuid(),
  requisitionId: z.string().uuid(),
  candidateId: z.string().uuid(),
  stage: AssignmentStageSchema,
  presentedAt: isoTimestamp.nullable(),
  clientDecisionAt: isoTimestamp.nullable(),
  assignedBy: z.string().uuid(),
  presentedBy: z.string().uuid().nullable(),
  /** Internal — never serialised to a client-scoped caller. */
  adminNote: z.string().nullable(),
  /** Shown to the client alongside the candidate. */
  clientNote: z.string().nullable(),
  sortOrder: z.number().int(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});
export type Assignment = z.infer<typeof AssignmentSchema>;

/**
 * Admin listing/detail row: the assignment plus an internal candidate summary
 * (internal fields allowed — this shape never crosses the client boundary)
 * and the requisition/client context needed by the pipeline board.
 */
export const AdminAssignmentRowSchema = AssignmentSchema.extend({
  requisitionReference: z.string(),
  clientId: z.string().uuid(),
  candidate: z.object({
    id: z.string().uuid(),
    reference: z.string(),
    firstName: z.string(),
    lastName: z.string(),
    displayName: z.string(),
    /** Raw storage path (admin-only shape). */
    photoPath: z.string().nullable(),
    /** Short-lived (300 s) signed URL for photoPath, computed at read time. */
    photoUrl: z.string().nullable(),
    email: z.string().nullable(),
    currentTitle: z.string().nullable(),
    country: z.string().nullable(),
    seniorityLevel: SeniorityLevelSchema.nullable(),
    vettingStatus: VettingStatusSchema.nullable(),
    recruiterRating: z.number().int().nullable(),
    poolStatus: PoolStatusSchema,
    dataCompleteness: DataCompletenessSchema,
    hasConsentToShareProfile: z.boolean(),
  }),
});
export type AdminAssignmentRow = z.infer<typeof AdminAssignmentRowSchema>;

// ---------------------------------------------------------------------------
// Client-visible shape (02 §11 — the view, column for column)
// ---------------------------------------------------------------------------

/** Stages a client may ever observe (01 §5). */
export const ClientVisibleStageSchema = z.enum(CLIENT_VISIBLE_STAGES);

/** A client-visible file reference (`candidate_files.is_client_visible`). */
export const ClientVisibleFileRefSchema = z.object({
  id: z.string().uuid(),
  fileType: CandidateFileTypeSchema,
  originalFilename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
});
export type ClientVisibleFileRef = z.infer<typeof ClientVisibleFileRefSchema>;

/**
 * One row of `client_visible_assignments` (02 §11) plus the candidate's
 * client-visible file references. This schema is the P5 client-UI contract.
 *
 * Gated fields — `firstName`, `lastName`, `email`, `phone`, `whatsapp`,
 * `linkedinUrl`, `currentEmployer` — are null until the stage reaches
 * `interview_scheduled` / `interviewed` / `offer` / `placed`
 * (PII_UNLOCKED_STAGES). The nulling happens in SQL, inside the view; this
 * schema only mirrors it.
 */
export const ClientVisibleAssignmentSchema = z.object({
  assignmentId: z.string().uuid(),
  requisitionId: z.string().uuid(),
  stage: ClientVisibleStageSchema,
  presentedAt: isoTimestamp.nullable(),
  clientNote: z.string().nullable(),
  clientId: z.string().uuid(),
  candidateId: z.string().uuid(),
  reference: z.string(),

  // always visible
  displayName: z.string(),
  photoPath: z.string().nullable(),
  /**
   * Short-lived (300 s) signed URL for photoPath, computed at read time via
   * the storage port (UX 1.4). Null when there is no photo or signing failed.
   */
  photoUrl: z.string().nullable(),
  country: z.string().nullable(),
  regionState: z.string().nullable(),
  city: z.string().nullable(),
  timezone: z.string().nullable(),
  englishSpokenLevel: LanguageLevelSchema.nullable(),
  englishWrittenLevel: LanguageLevelSchema.nullable(),
  accentStrength: AccentStrengthSchema.nullable(),
  yearsExperienceTotal: z.number().nullable(),
  yearsExperienceRelevant: z.number().nullable(),
  currentTitle: z.string().nullable(),
  seniorityLevel: SeniorityLevelSchema.nullable(),
  hasManagementExperience: z.boolean().nullable(),
  teamSizeManaged: z.number().int().nullable(),
  hasClientFacingExperience: z.boolean().nullable(),
  hasUsClientExperience: z.boolean().nullable(),
  remoteExperienceYears: z.number().nullable(),
  availableFrom: isoDate.nullable(),
  engagementTypes: z.array(EngagementTypeSchema).nullable(),
  hoursAvailablePerWeek: z.number().int().nullable(),
  overlapStart: timeOfDay.nullable(),
  overlapEnd: timeOfDay.nullable(),
  overlapTimezone: z.string().nullable(),
  autonomy: AutonomyLevelSchema.nullable(),
  canManageUp: z.boolean().nullable(),
  recruiterRecommendation: z.string().nullable(),
  strengths: z.string().nullable(),

  // decision state (UX 3.2)
  /**
   * When the client last requested an interview for this assignment — the
   * latest `interview_requested` event, or null if never requested.
   */
  interviewRequestedAt: isoTimestamp.nullable(),
  /**
   * For stage `rejected_by_client` ONLY: the client-side rejection's reason
   * label (rejection_reasons.label, or the free-text reason). Always null at
   * any other stage, and NEVER populated from an admin rejection.
   */
  rejectionReasonLabel: z.string().nullable(),
  /** For stage `rejected_by_client` ONLY: the rejection's free-text detail. */
  rejectionDetail: z.string().nullable(),

  // gated: SQL NULL until interview_scheduled or later (view CASE exprs)
  firstName: z.string().nullable(),
  lastName: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  currentEmployer: z.string().nullable(),

  /** Files flagged `is_client_visible`, download via signed URL (04 §8.1). */
  files: z.array(ClientVisibleFileRefSchema),
});
export type ClientVisibleAssignment = z.infer<
  typeof ClientVisibleAssignmentSchema
>;

// ---------------------------------------------------------------------------
// Bodies (04 §9)
// ---------------------------------------------------------------------------

/** `POST /requisitions/:id/assignments` — creates assignments at `sourced`. */
export const CreateAssignmentsBodySchema = z.object({
  candidateIds: z.array(z.string().uuid()).min(1).max(50),
  adminNote: z.string().max(5000).optional(),
});
export type CreateAssignmentsBody = z.infer<typeof CreateAssignmentsBodySchema>;

/** `PATCH /assignments/:id` — adminNote, clientNote, sortOrder only. */
export const UpdateAssignmentBodySchema = z
  .object({
    adminNote: z.string().max(5000).nullable().optional(),
    clientNote: z.string().max(5000).nullable().optional(),
    sortOrder: z.number().int().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateAssignmentBody = z.infer<typeof UpdateAssignmentBodySchema>;

/** `POST /assignments/:id/advance` — validated against the 01 §5 machine. */
export const AdvanceBodySchema = z.object({
  toStage: AssignmentStageSchema,
  note: z.string().max(5000).optional(),
});
export type AdvanceBody = z.infer<typeof AdvanceBodySchema>;

/** `POST /assignments/present` — bulk, all-or-nothing (J5, AC-PL-05). */
export const PresentBodySchema = z.object({
  assignmentIds: z.array(z.string().uuid()).min(1).max(50),
  clientNote: z.string().max(5000).optional(),
});
export type PresentBody = z.infer<typeof PresentBodySchema>;

/**
 * `POST /assignments/:id/reject`. The DB constraint `chk_reason_present`
 * requires reasonId OR reasonOther; the API surfaces the same rule as a 422
 * before the insert (AC-PL-11). NO actor field — see the module docblock.
 */
export const RejectBodySchema = z.object({
  reasonId: z.string().uuid().optional(),
  reasonOther: z.string().min(1).max(1000).optional(),
  detail: z.string().max(5000).optional(),
});
export type RejectBody = z.infer<typeof RejectBodySchema>;

/** `POST /assignments/:id/place` — the 04 §11 placement transaction. */
export const PlaceBodySchema = z.object({
  startDate: isoDate,
  endDate: isoDate.nullable().optional(),
  rateAmount: z.number().nonnegative().nullable().optional(),
  rateUnit: RateUnitSchema.nullable().optional(),
  rateCurrency: z.string().length(3).optional(),
  hoursPerWeek: z.number().int().min(1).max(168).nullable().optional(),
  serviceTier: ServiceTierSchema.nullable().optional(),
  guaranteeEndDate: isoDate.nullable().optional(),
});
export type PlaceBody = z.infer<typeof PlaceBodySchema>;

// ---------------------------------------------------------------------------
// Placements (04 §11, 02 §9)
// ---------------------------------------------------------------------------

export const PlacementSchema = z.object({
  id: z.string().uuid(),
  assignmentId: z.string().uuid(),
  candidateId: z.string().uuid(),
  clientId: z.string().uuid(),
  requisitionId: z.string().uuid(),
  startDate: isoDate,
  endDate: isoDate.nullable(),
  rateAmount: z.number().nullable(),
  rateUnit: RateUnitSchema.nullable(),
  rateCurrency: z.string().length(3).nullable(),
  hoursPerWeek: z.number().int().nullable(),
  serviceTier: ServiceTierSchema.nullable(),
  guaranteeEndDate: isoDate.nullable(),
  status: PlacementStatusSchema,
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});
export type Placement = z.infer<typeof PlacementSchema>;

/** `PATCH /placements/:id` (client.update — admin surface). */
export const UpdatePlacementBodySchema = z
  .object({
    startDate: isoDate.optional(),
    endDate: isoDate.nullable().optional(),
    rateAmount: z.number().nonnegative().nullable().optional(),
    rateUnit: RateUnitSchema.nullable().optional(),
    rateCurrency: z.string().length(3).nullable().optional(),
    hoursPerWeek: z.number().int().min(1).max(168).nullable().optional(),
    serviceTier: ServiceTierSchema.nullable().optional(),
    guaranteeEndDate: isoDate.nullable().optional(),
    status: PlacementStatusSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdatePlacementBody = z.infer<typeof UpdatePlacementBodySchema>;

export const ListPlacementsQuerySchema = z.object({
  /** Admin only — client callers are implicitly scoped and may not filter. */
  clientId: z.string().uuid().optional(),
  status: PlacementStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});
export type ListPlacementsQuery = z.infer<typeof ListPlacementsQuerySchema>;
