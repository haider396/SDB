/**
 * Interview contracts (docs/04-API.md §10, docs/02-DATABASE.md §9,
 * docs/01-PRODUCT-OVERVIEW.md §3 J7).
 *
 * Creating an interview is the PII gate action: the assignment moves to
 * `interview_scheduled` through the stage machine, at which point the
 * `client_visible_assignments` view starts emitting the gated PII columns.
 * There is NO calendar provider integration — `meetingUrl` is pasted text.
 *
 * Rounds: `(assignmentId, roundNumber)` is unique in the database. When
 * `roundNumber` is omitted on create, the API assigns the next round
 * (max existing + 1, or 1).
 */
import { z } from 'zod';
import { InterviewOutcomeSchema } from './enums.js';

const isoTimestamp = z.string().datetime({ offset: true });

// ---------------------------------------------------------------------------
// Resource shape (02 §9 `interviews`, column for column)
// ---------------------------------------------------------------------------

export const InterviewSchema = z.object({
  id: z.string().uuid(),
  assignmentId: z.string().uuid(),
  roundNumber: z.number().int().min(1),
  scheduledAt: isoTimestamp.nullable(),
  timezone: z.string().nullable(),
  durationMinutes: z.number().int().nullable(),
  meetingUrl: z.string().nullable(),
  interviewerNames: z.string().nullable(),
  requestedBy: z.string().uuid().nullable(),
  createdBy: z.string().uuid(),
  outcome: InterviewOutcomeSchema,
  outcomeNotes: z.string().nullable(),
  outcomeRecordedBy: z.string().uuid().nullable(),
  outcomeRecordedAt: isoTimestamp.nullable(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
});
export type Interview = z.infer<typeof InterviewSchema>;

// ---------------------------------------------------------------------------
// Bodies (04 §10)
// ---------------------------------------------------------------------------

/**
 * `POST /assignments/:id/interviews`. `scheduledAt` and `timezone` are
 * required — an interview without a time is a request, and requests go
 * through `POST /assignments/:id/request-interview` instead.
 */
export const CreateInterviewBodySchema = z.object({
  scheduledAt: isoTimestamp,
  /** IANA zone name or offset label; stored verbatim (NFR-11 display aid). */
  timezone: z.string().min(1).max(64),
  durationMinutes: z.number().int().min(5).max(600).optional(),
  /** Pasted text — no calendar integration (04 §10). */
  meetingUrl: z.string().min(1).max(2000).optional(),
  interviewerNames: z.string().min(1).max(1000).optional(),
  /** Defaults to the next round for the assignment. */
  roundNumber: z.number().int().min(1).max(50).optional(),
});
export type CreateInterviewBody = z.infer<typeof CreateInterviewBodySchema>;

/** `PATCH /interviews/:id` — schedule fields only, while outcome is pending. */
export const UpdateInterviewBodySchema = z
  .object({
    scheduledAt: isoTimestamp.optional(),
    timezone: z.string().min(1).max(64).optional(),
    durationMinutes: z.number().int().min(5).max(600).nullable().optional(),
    meetingUrl: z.string().min(1).max(2000).nullable().optional(),
    interviewerNames: z.string().min(1).max(1000).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateInterviewBody = z.infer<typeof UpdateInterviewBodySchema>;

/**
 * `POST /interviews/:id/outcome`. `pending` is the initial state, not an
 * outcome; `cancelled` goes through `POST /interviews/:id/cancel` so the
 * cancellation rule (no stage change) cannot be bypassed.
 */
export const RecordableOutcomeSchema = InterviewOutcomeSchema.exclude([
  'pending',
  'cancelled',
]);
export type RecordableOutcome = z.infer<typeof RecordableOutcomeSchema>;

export const OutcomeBodySchema = z.object({
  outcome: RecordableOutcomeSchema,
  outcomeNotes: z.string().min(1).max(5000).optional(),
});
export type OutcomeBody = z.infer<typeof OutcomeBodySchema>;
