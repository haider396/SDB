/**
 * Interview business rules (docs/04-API.md §10, docs/01-PRODUCT-OVERVIEW.md
 * §3 J7, docs/06-BACKEND.md §4.4). No HTTP types, no SQL strings.
 *
 * Stage rules — the assignment stage machine is the single authority
 * (services/state-machines.ts):
 *
 * - CREATE: the machine's only edge into `interview_scheduled` is from
 *   `client_reviewing`, so creating a first interview transitions
 *   client_reviewing → interview_scheduled (one transaction: interview row +
 *   stage CAS + events + notifications) — this is the moment gated PII
 *   unlocks (AC-PL-12). When the assignment is already at a PII-unlocked
 *   stage (`interview_scheduled`, `interviewed`, `offer`, `placed`) a
 *   later-round interview is created with NO stage change. Any other stage —
 *   including `presented`, which must go through the client's
 *   approve-for-interview first — is 409 INVALID_TRANSITION.
 * - OUTCOME: recording passed/failed/no_show advances
 *   interview_scheduled → interviewed IF the assignment is still at
 *   `interview_scheduled` and no other interview of the assignment is
 *   pending (a later scheduled round keeps the stage until it too is
 *   resolved). `rescheduled` records the fact and keeps the stage — the
 *   interview did not happen. Outcomes recorded while the assignment is
 *   beyond `interview_scheduled` (later rounds) never touch the stage.
 * - CANCEL: outcome = 'cancelled', no stage change even when no pending
 *   interview remains — the stage machine has no backward edge out of
 *   `interview_scheduled` (01 §5), and un-revealing already-unlocked PII
 *   would be a lie; the admin advances or rejects explicitly instead.
 *
 * Round uniqueness: `unique (assignment_id, round_number)` — a collision
 * (explicit roundNumber already taken, or an insert race) is SQLSTATE 23505
 * and maps to 422 VALIDATION_FAILED.
 *
 * Notifications (06 §4.4): `interview_scheduled` goes to every active client
 * user of the requisition's client AND the creating admin.
 */
import type {
  CreateInterviewBody,
  Interview,
  OutcomeBody,
  UpdateInterviewBody,
  UserRoleKey,
} from '@sdb/contracts';
import { PII_UNLOCKED_STAGES } from '@sdb/contracts';
import { withTransaction, type Db, type Tx } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import {
  findAdminAssignmentById,
  writeAssignmentStage,
} from '../repositories/assignments.repo.js';
import { findClientVisibleAssignment } from '../repositories/client-visible.repo.js';
import { getActiveClientUsers } from '../repositories/clients.repo.js';
import {
  findInterviewById,
  getNextRoundNumber,
  hasOtherPendingInterview,
  insertInterview,
  listInterviewsForAssignment,
  updateInterviewSchedule,
  writeInterviewOutcome,
} from '../repositories/interviews.repo.js';
import { findRequisitionById } from '../repositories/requisitions.repo.js';
import { findUserById } from '../repositories/users.repo.js';
import { emitEvent } from './events.js';
import { safeEnqueue, type EnqueueLogger } from './notifications.js';
import { ASSIGNMENT_TRANSITIONS, canTransition } from './state-machines.js';

export interface InterviewActor {
  userId: string;
  role: UserRoleKey | null;
  /** Resolved membership scope — null for admin callers (04 §1.3). */
  ownClientId: string | null;
}

export interface InterviewsServiceDeps {
  db: Db;
  logger?: EnqueueLogger;
}

export interface InterviewsService {
  create(
    assignmentId: string,
    body: CreateInterviewBody,
    actor: InterviewActor,
  ): Promise<Interview>;
  listForAssignment(
    assignmentId: string,
    actor: InterviewActor,
  ): Promise<Interview[]>;
  update(
    interviewId: string,
    body: UpdateInterviewBody,
    actor: InterviewActor,
  ): Promise<Interview>;
  recordOutcome(
    interviewId: string,
    body: OutcomeBody,
    actor: InterviewActor,
  ): Promise<Interview>;
  cancel(interviewId: string, actor: InterviewActor): Promise<Interview>;
}

const PG_UNIQUE_VIOLATION = '23505';

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    String((error as { code: unknown }).code) === PG_UNIQUE_VIOLATION
  );
}

export function createInterviewsService(
  deps: InterviewsServiceDeps,
): InterviewsService {
  const { db } = deps;

  /** The interview write surface does not exist for client-scoped callers. */
  function assertAdminSurface(actor: InterviewActor): void {
    if (actor.ownClientId !== null) {
      throw new ApiError('NOT_FOUND', 'Resource not found.');
    }
  }

  async function requireAdminAssignment(assignmentId: string) {
    const row = await findAdminAssignmentById(db, assignmentId);
    if (row === null) {
      throw new ApiError('NOT_FOUND', 'Assignment not found.');
    }
    return row;
  }

  async function requireInterviewWithAssignment(interviewId: string) {
    const interview = await findInterviewById(db, interviewId);
    if (interview === null) {
      throw new ApiError('NOT_FOUND', 'Interview not found.');
    }
    const assignment = await requireAdminAssignment(interview.assignmentId);
    return { interview, assignment };
  }

  function roundConflict(roundNumber: number | undefined): ApiError {
    return new ApiError(
      'VALIDATION_FAILED',
      roundNumber === undefined
        ? 'This interview round already exists for the assignment.'
        : `Round ${roundNumber} already exists for this assignment.`,
      { fields: { roundNumber: 'This round already exists.' } },
    );
  }

  return {
    // -----------------------------------------------------------------------
    // POST /assignments/:id/interviews (interview.create, J7, AC-PL-12)
    // -----------------------------------------------------------------------
    async create(assignmentId, body, actor) {
      assertAdminSurface(actor);
      const assignment = await requireAdminAssignment(assignmentId);
      const from = assignment.stage;

      // Stage rule (module docblock): transition from client_reviewing;
      // later rounds at PII-unlocked stages create without a stage change;
      // everything else is the machine's answer — 409.
      const alreadyUnlocked = (
        PII_UNLOCKED_STAGES as readonly string[]
      ).includes(from);
      const mustTransition = !alreadyUnlocked;
      if (
        mustTransition &&
        !canTransition(ASSIGNMENT_TRANSITIONS, from, 'interview_scheduled')
      ) {
        throw new ApiError(
          'INVALID_TRANSITION',
          `Cannot move an assignment from '${from}' to 'interview_scheduled'.`,
          { from, to: 'interview_scheduled' },
        );
      }

      const requisition = await findRequisitionById(db, assignment.requisitionId);
      if (requisition === null) {
        throw new ApiError('NOT_FOUND', 'Requisition not found.');
      }
      const creator = await findUserById(db, actor.userId);

      let created: Interview | null = null;
      try {
        await withTransaction(db, async (tx: Tx) => {
          const roundNumber =
            body.roundNumber ?? (await getNextRoundNumber(tx, assignmentId));
          created = await insertInterview(tx, {
            assignmentId,
            roundNumber,
            scheduledAt: body.scheduledAt,
            timezone: body.timezone,
            durationMinutes: body.durationMinutes ?? null,
            meetingUrl: body.meetingUrl ?? null,
            interviewerNames: body.interviewerNames ?? null,
            createdBy: actor.userId,
          });

          if (mustTransition) {
            const written = await writeAssignmentStage(
              tx,
              assignmentId,
              from,
              'interview_scheduled',
            );
            if (!written) {
              // Concurrent transition won the CAS.
              throw new ApiError(
                'INVALID_TRANSITION',
                `Cannot move an assignment from '${from}' to 'interview_scheduled'.`,
                { from, to: 'interview_scheduled' },
              );
            }
            await emitEvent(tx, {
              entityType: 'assignment',
              entityId: assignmentId,
              eventType: 'stage_changed',
              actorId: actor.userId,
              actorRole: actor.role,
              fromValue: from,
              toValue: 'interview_scheduled',
              metadata: {
                requisitionId: assignment.requisitionId,
                candidateId: assignment.candidateId,
                interviewId: created.id,
              },
            });
          }

          await emitEvent(tx, {
            entityType: 'assignment',
            entityId: assignmentId,
            eventType: 'interview_created',
            actorId: actor.userId,
            actorRole: actor.role,
            metadata: {
              interviewId: created.id,
              roundNumber: created.roundNumber,
              scheduledAt: created.scheduledAt,
              requisitionId: assignment.requisitionId,
              candidateId: assignment.candidateId,
            },
          });

          // 06 §4.4: client users of that requisition's client + the creating
          // admin. De-duplicated by user id.
          const recipients = await getActiveClientUsers(tx, requisition.clientId);
          const seen = new Set(recipients.map((recipient) => recipient.userId));
          if (creator !== null && !seen.has(creator.id)) {
            recipients.push({
              userId: creator.id,
              email: creator.email,
              fullName: creator.fullName,
            });
          }
          for (const recipient of recipients) {
            await safeEnqueue(tx, deps.logger, {
              event: 'interview_scheduled',
              recipient,
              entityType: 'assignment',
              entityId: assignmentId,
              context: {
                clientName: requisition.clientName,
                requisitionReference: requisition.reference,
                roleTitle: requisition.advertisedTitle,
                interviewId: created.id,
                roundNumber: created.roundNumber,
                scheduledAt: created.scheduledAt,
                timezone: created.timezone,
                actorUserId: actor.userId,
              },
            });
          }
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw roundConflict(body.roundNumber);
        }
        throw error;
      }

      if (created === null) {
        throw new ApiError('INTERNAL_ERROR', 'Interview was not created.');
      }
      return created;
    },

    // -----------------------------------------------------------------------
    // GET /assignments/:id/interviews (interview.view)
    // -----------------------------------------------------------------------
    async listForAssignment(assignmentId, actor) {
      if (actor.ownClientId !== null) {
        // Tenant + visibility gate: interviews only exist for the client when
        // the assignment itself is client-visible — a foreign, internal-stage,
        // or nonexistent assignment is indistinguishably 404 (CLAUDE.md rule 3).
        const visible = await findClientVisibleAssignment(
          db,
          actor.ownClientId,
          assignmentId,
        );
        if (visible === null) {
          throw new ApiError('NOT_FOUND', 'Assignment not found.');
        }
        return listInterviewsForAssignment(db, assignmentId);
      }
      await requireAdminAssignment(assignmentId);
      return listInterviewsForAssignment(db, assignmentId);
    },

    // -----------------------------------------------------------------------
    // PATCH /interviews/:id (interview.update — schedule fields)
    // -----------------------------------------------------------------------
    async update(interviewId, body, actor) {
      assertAdminSurface(actor);
      const { interview, assignment } =
        await requireInterviewWithAssignment(interviewId);
      if (interview.outcome !== 'pending') {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Cannot reschedule an interview whose outcome is '${interview.outcome}'.`,
          { fields: { outcome: 'Outcome already recorded.' } },
        );
      }
      let updated: Interview | null = null;
      await withTransaction(db, async (tx) => {
        updated = await updateInterviewSchedule(tx, interviewId, {
          ...(body.scheduledAt !== undefined ? { scheduledAt: body.scheduledAt } : {}),
          ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
          ...(body.durationMinutes !== undefined
            ? { durationMinutes: body.durationMinutes }
            : {}),
          ...(body.meetingUrl !== undefined ? { meetingUrl: body.meetingUrl } : {}),
          ...(body.interviewerNames !== undefined
            ? { interviewerNames: body.interviewerNames }
            : {}),
        });
        if (updated === null) {
          // Outcome recorded between the read and the guarded UPDATE.
          throw new ApiError(
            'VALIDATION_FAILED',
            'Cannot reschedule an interview whose outcome is recorded.',
            { fields: { outcome: 'Outcome already recorded.' } },
          );
        }
        await emitEvent(tx, {
          entityType: 'assignment',
          entityId: interview.assignmentId,
          eventType: 'interview_updated',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: {
            interviewId,
            roundNumber: interview.roundNumber,
            requisitionId: assignment.requisitionId,
            candidateId: assignment.candidateId,
            changedFields: Object.keys(body),
          },
        });
      });
      if (updated === null) {
        throw new ApiError('INTERNAL_ERROR', 'Interview was not updated.');
      }
      return updated;
    },

    // -----------------------------------------------------------------------
    // POST /interviews/:id/outcome (interview.update, J7 step 4)
    // -----------------------------------------------------------------------
    async recordOutcome(interviewId, body, actor) {
      assertAdminSurface(actor);
      const { interview, assignment } =
        await requireInterviewWithAssignment(interviewId);
      if (interview.outcome !== 'pending') {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Outcome already recorded as '${interview.outcome}'.`,
          { fields: { outcome: 'Outcome already recorded.' } },
        );
      }

      let recorded: Interview | null = null;
      await withTransaction(db, async (tx) => {
        recorded = await writeInterviewOutcome(
          tx,
          interviewId,
          body.outcome,
          body.outcomeNotes ?? null,
          actor.userId,
        );
        if (recorded === null) {
          throw new ApiError(
            'VALIDATION_FAILED',
            'Outcome already recorded.',
            { fields: { outcome: 'Outcome already recorded.' } },
          );
        }
        await emitEvent(tx, {
          entityType: 'assignment',
          entityId: interview.assignmentId,
          eventType: 'interview_outcome_recorded',
          actorId: actor.userId,
          actorRole: actor.role,
          fromValue: 'pending',
          toValue: body.outcome,
          metadata: {
            interviewId,
            roundNumber: interview.roundNumber,
            requisitionId: assignment.requisitionId,
            candidateId: assignment.candidateId,
            ...(body.outcomeNotes !== undefined
              ? { outcomeNotes: body.outcomeNotes }
              : {}),
          },
        });

        // Stage rule (module docblock): the interview happened, the round is
        // resolved, and nothing else is pending → interviewed. `rescheduled`
        // means it did NOT happen, so the stage waits.
        const advance =
          body.outcome !== 'rescheduled' &&
          assignment.stage === 'interview_scheduled' &&
          !(await hasOtherPendingInterview(tx, interview.assignmentId, interviewId));
        if (advance) {
          const written = await writeAssignmentStage(
            tx,
            interview.assignmentId,
            'interview_scheduled',
            'interviewed',
          );
          if (written) {
            await emitEvent(tx, {
              entityType: 'assignment',
              entityId: interview.assignmentId,
              eventType: 'stage_changed',
              actorId: actor.userId,
              actorRole: actor.role,
              fromValue: 'interview_scheduled',
              toValue: 'interviewed',
              metadata: {
                requisitionId: assignment.requisitionId,
                candidateId: assignment.candidateId,
                interviewId,
                outcome: body.outcome,
              },
            });
          }
          // A lost CAS means a concurrent transition moved the assignment
          // first; the outcome itself stands — no error.
        }
      });
      if (recorded === null) {
        throw new ApiError('INTERNAL_ERROR', 'Outcome was not recorded.');
      }
      return recorded;
    },

    // -----------------------------------------------------------------------
    // POST /interviews/:id/cancel (interview.update)
    // -----------------------------------------------------------------------
    async cancel(interviewId, actor) {
      assertAdminSurface(actor);
      const { interview, assignment } =
        await requireInterviewWithAssignment(interviewId);
      if (interview.outcome !== 'pending') {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Cannot cancel an interview whose outcome is '${interview.outcome}'.`,
          { fields: { outcome: 'Outcome already recorded.' } },
        );
      }
      let cancelled: Interview | null = null;
      await withTransaction(db, async (tx) => {
        cancelled = await writeInterviewOutcome(
          tx,
          interviewId,
          'cancelled',
          null,
          actor.userId,
        );
        if (cancelled === null) {
          throw new ApiError(
            'VALIDATION_FAILED',
            'Outcome already recorded.',
            { fields: { outcome: 'Outcome already recorded.' } },
          );
        }
        // Deliberately NO stage change (module docblock): the machine has no
        // backward edge out of interview_scheduled, and PII once unlocked
        // stays unlocked. The admin advances or rejects explicitly.
        await emitEvent(tx, {
          entityType: 'assignment',
          entityId: interview.assignmentId,
          eventType: 'interview_cancelled',
          actorId: actor.userId,
          actorRole: actor.role,
          fromValue: 'pending',
          toValue: 'cancelled',
          metadata: {
            interviewId,
            roundNumber: interview.roundNumber,
            requisitionId: assignment.requisitionId,
            candidateId: assignment.candidateId,
          },
        });
      });
      if (cancelled === null) {
        throw new ApiError('INTERNAL_ERROR', 'Interview was not cancelled.');
      }
      return cancelled;
    },
  };
}
