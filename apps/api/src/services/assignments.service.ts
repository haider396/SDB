/**
 * Assignment pipeline business rules (docs/04-API.md §9 and §11,
 * docs/01-PRODUCT-OVERVIEW.md §3 J4–J8 / §5, docs/06-BACKEND.md §2.1–2.3).
 * No HTTP types, no SQL strings.
 *
 * Rules enforced here:
 * - all stage writes go through the ASSIGNMENT_TRANSITIONS adjacency map with
 *   a compare-and-set on the current stage; an illegal move is
 *   409 INVALID_TRANSITION with { from, to } (AC-PL-01)
 * - assignment creation rejects candidates whose do_not_present_to_client_ids
 *   contains the requisition's client (AC-PL-04), and a repeat assignment is
 *   409 DUPLICATE_ASSIGNMENT via the unique constraint (AC-PL-03)
 * - PRESENT is bulk and all-or-nothing: any candidate without
 *   has_consent_to_share_profile → 422 CONSENT_MISSING and nothing moves
 *   (AC-PL-05); one transaction updates every assignment, moves the
 *   requisition to candidates_presented through its own state machine, writes
 *   one event per assignment, and queues `candidates_presented` once per
 *   client user (AC-PL-06)
 * - the rejection actor derives from the caller's context, NEVER from the
 *   body (AC-PL-09/10); a rejection without reasonId or reasonOther is 422
 *   before it can hit the DB constraint (AC-PL-11)
 * - PLACE runs in one transaction: placement row, assignment → placed,
 *   requisition → placed, non-terminal siblings → closed_not_selected, and
 *   candidate pool_status = 'placed' (AC-PL-13)
 * - client-scoped reads are served EXCLUSIVELY from the
 *   client_visible_assignments view via repositories/client-visible.repo.ts;
 *   this service never returns admin candidate data to a scoped caller
 *   (CLAUDE.md rules 3–4)
 * - client-only actions (approve-for-interview, request-interview) are 404
 *   for unscoped callers — the client surface simply does not exist for them
 */
import {
  type AdminAssignmentRow,
  type Assignment,
  type AssignmentStage,
  type ClientVisibleAssignment,
  type CreateAssignmentsBody,
  type EntityEvent,
  type PlaceBody,
  type Placement,
  type PresentBody,
  type RejectBody,
  type RejectionActor,
  type UpdateAssignmentBody,
  type UserRoleKey,
} from '@sdb/contracts';
import { withTransaction, type Db, type Tx } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import { signPhotoPaths } from '../lib/photo-urls.js';
import type { SupabaseStoragePort } from '../lib/supabase-storage.js';
import {
  findAdminAssignmentById,
  findExistingAssignmentCandidateIds,
  findRejectionReasonById,
  getCandidatePresentability,
  insertAssignment,
  insertRejection,
  listAdminAssignmentsForRequisition,
  listSiblingsForPlacement,
  setCandidatePoolStatus,
  updateAssignment,
  writeAssignmentStage,
} from '../repositories/assignments.repo.js';
import {
  findClientVisibleAssignment,
  listClientVisibleAssignments,
} from '../repositories/client-visible.repo.js';
import { getActiveClientUsers } from '../repositories/clients.repo.js';
import { getActiveAdmins } from '../repositories/intake.repo.js';
import { insertPlacement } from '../repositories/placements.repo.js';
import {
  findRequisitionById,
  listEventsForEntity,
  writeRequisitionStatus,
  type RequisitionRecord,
} from '../repositories/requisitions.repo.js';
import { emitEvent } from './events.js';
import { safeEnqueue, type EnqueueLogger } from './notifications.js';
import {
  ASSIGNMENT_TRANSITIONS,
  canTransition,
  REQUISITION_TRANSITIONS,
} from './state-machines.js';
import { dedupeEvents } from './requisitions.service.js';

export interface AssignmentActor {
  userId: string;
  role: UserRoleKey | null;
  /** Resolved membership scope — null for admin callers (04 §1.3). */
  ownClientId: string | null;
}

export interface AssignmentsServiceDeps {
  db: Db;
  /** Storage port for read-time photoUrl signing (UX 1.4). */
  storage: SupabaseStoragePort;
  logger?: EnqueueLogger;
  /**
   * Attention-queue clear-on-write hook (UX 1.7): called after any
   * successful assignment stage change (advance/present/approve/reject/
   * place). Coarse by design.
   */
  invalidateAttentionQueue?: () => void;
}

/** Stages with outbound transitions — everything a placement must close. */
const NON_TERMINAL_STAGES = (
  Object.keys(ASSIGNMENT_TRANSITIONS) as AssignmentStage[]
).filter((stage) => ASSIGNMENT_TRANSITIONS[stage].length > 0);

const PG_UNIQUE_VIOLATION = '23505';

export interface AssignmentsService {
  assign(
    requisitionId: string,
    body: CreateAssignmentsBody,
    actor: AssignmentActor,
  ): Promise<AdminAssignmentRow[]>;
  listForRequisition(
    requisitionId: string,
    actor: AssignmentActor,
  ): Promise<AdminAssignmentRow[] | ClientVisibleAssignment[]>;
  get(
    assignmentId: string,
    actor: AssignmentActor,
  ): Promise<AdminAssignmentRow | ClientVisibleAssignment>;
  update(
    assignmentId: string,
    body: UpdateAssignmentBody,
    actor: AssignmentActor,
  ): Promise<AdminAssignmentRow>;
  advance(
    assignmentId: string,
    toStage: AssignmentStage,
    note: string | null,
    actor: AssignmentActor,
  ): Promise<AdminAssignmentRow>;
  present(body: PresentBody, actor: AssignmentActor): Promise<AdminAssignmentRow[]>;
  approveForInterview(
    assignmentId: string,
    actor: AssignmentActor,
  ): Promise<ClientVisibleAssignment>;
  reject(
    assignmentId: string,
    body: RejectBody,
    actor: AssignmentActor,
  ): Promise<AdminAssignmentRow | ClientVisibleAssignment>;
  requestInterview(
    assignmentId: string,
    actor: AssignmentActor,
  ): Promise<ClientVisibleAssignment>;
  place(
    assignmentId: string,
    body: PlaceBody,
    actor: AssignmentActor,
  ): Promise<Placement>;
  listEvents(assignmentId: string, actor: AssignmentActor): Promise<EntityEvent[]>;
}

export function createAssignmentsService(
  deps: AssignmentsServiceDeps,
): AssignmentsService {
  const { db, storage } = deps;

  /** photoUrl decoration (UX 1.4): one batched port call per distinct path. */
  async function withAdminPhotoUrls(
    rows: AdminAssignmentRow[],
  ): Promise<AdminAssignmentRow[]> {
    const urls = await signPhotoPaths(
      storage,
      rows.map((row) => row.candidate.photoPath),
    );
    return rows.map((row) =>
      row.candidate.photoPath === null
        ? row
        : {
            ...row,
            candidate: {
              ...row.candidate,
              photoUrl: urls.get(row.candidate.photoPath) ?? null,
            },
          },
    );
  }

  async function withClientPhotoUrls(
    rows: ClientVisibleAssignment[],
  ): Promise<ClientVisibleAssignment[]> {
    const urls = await signPhotoPaths(
      storage,
      rows.map((row) => row.photoPath),
    );
    return rows.map((row) =>
      row.photoPath === null
        ? row
        : { ...row, photoUrl: urls.get(row.photoPath) ?? null },
    );
  }

  async function adminRowWithPhotoUrl(
    row: AdminAssignmentRow,
  ): Promise<AdminAssignmentRow> {
    const [decorated] = await withAdminPhotoUrls([row]);
    return decorated ?? row;
  }

  async function clientRowWithPhotoUrl(
    row: ClientVisibleAssignment,
  ): Promise<ClientVisibleAssignment> {
    const [decorated] = await withClientPhotoUrls([row]);
    return decorated ?? row;
  }

  /** The admin pipeline surface does not exist for client-scoped callers. */
  function assertAdminSurface(actor: AssignmentActor): void {
    if (actor.ownClientId !== null) {
      throw new ApiError('NOT_FOUND', 'Resource not found.');
    }
  }

  /** Client-only actions do not exist for unscoped (admin) callers. */
  function requireClientScope(actor: AssignmentActor): string {
    if (actor.ownClientId === null) {
      throw new ApiError('NOT_FOUND', 'Resource not found.');
    }
    return actor.ownClientId;
  }

  function invalidTransition(
    from: AssignmentStage | string,
    to: AssignmentStage | string,
  ): ApiError {
    return new ApiError(
      'INVALID_TRANSITION',
      `Cannot move an assignment from '${from}' to '${to}'.`,
      { from, to },
    );
  }

  async function requireAdminRow(
    sql: Db | Tx,
    assignmentId: string,
  ): Promise<AdminAssignmentRow> {
    const row = await findAdminAssignmentById(sql, assignmentId);
    if (row === null) {
      throw new ApiError('NOT_FOUND', 'Assignment not found.');
    }
    return row;
  }

  async function requireRequisition(
    sql: Db | Tx,
    requisitionId: string,
    clientId?: string,
  ): Promise<RequisitionRecord> {
    const record =
      clientId === undefined
        ? await findRequisitionById(sql, requisitionId)
        : await findRequisitionById(sql, requisitionId, clientId);
    if (record === null) {
      throw new ApiError('NOT_FOUND', 'Requisition not found.');
    }
    return record;
  }

  /** One stage-change event, shaped to de-duplicate with the DB trigger. */
  async function emitStageEvent(
    tx: Tx,
    assignment: { id: string; requisitionId: string; candidateId: string },
    actor: AssignmentActor,
    from: AssignmentStage,
    to: AssignmentStage,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await emitEvent(tx, {
      entityType: 'assignment',
      entityId: assignment.id,
      eventType: 'stage_changed',
      actorId: actor.userId,
      actorRole: actor.role,
      fromValue: from,
      toValue: to,
      metadata: {
        requisitionId: assignment.requisitionId,
        candidateId: assignment.candidateId,
        ...metadata,
      },
    });
  }

  /** `client_decision_recorded` to every active admin (06 §4.4). */
  async function notifyAdminsOfClientDecision(
    tx: Tx,
    requisition: RequisitionRecord,
    assignmentId: string,
    decision: 'approved_for_interview' | 'rejected' | 'interview_requested',
    actorUserId: string,
  ): Promise<void> {
    const admins = await getActiveAdmins(tx);
    for (const admin of admins) {
      await safeEnqueue(tx, deps.logger, {
        event: 'client_decision_recorded',
        recipient: {
          userId: admin.id,
          email: admin.email,
          fullName: admin.fullName,
        },
        entityType: 'assignment',
        entityId: assignmentId,
        context: {
          clientName: requisition.clientName,
          requisitionReference: requisition.reference,
          roleTitle: requisition.advertisedTitle,
          decision,
          actorUserId,
        },
      });
    }
  }

  /**
   * Consent gate (J5, AC-PL-05): every candidate must have
   * has_consent_to_share_profile, or NONE may be presented.
   */
  async function assertConsent(
    sql: Db | Tx,
    candidateIds: string[],
  ): Promise<void> {
    const records = await getCandidatePresentability(sql, candidateIds);
    const byId = new Map(records.map((record) => [record.id, record]));
    const missingConsent = candidateIds.filter(
      (id) => byId.get(id)?.hasConsentToShareProfile !== true,
    );
    if (missingConsent.length > 0) {
      throw new ApiError(
        'CONSENT_MISSING',
        'One or more candidates have not consented to profile sharing. No candidates were presented.',
        { candidateIds: missingConsent },
      );
    }
  }

  return {
    // -----------------------------------------------------------------------
    // POST /requisitions/:id/assignments (candidate.assign, J4)
    // -----------------------------------------------------------------------
    async assign(requisitionId, body, actor) {
      assertAdminSurface(actor);
      // requireRequisition accepts a uuid or a public_id (0015); everything
      // below works with the internal uuid.
      const requisition = await requireRequisition(db, requisitionId);
      requisitionId = requisition.id;
      const candidateIds = [...new Set(body.candidateIds)];

      const records = await getCandidatePresentability(db, candidateIds);
      const byId = new Map(records.map((record) => [record.id, record]));

      const missing = candidateIds.filter(
        (id) => !byId.has(id) || byId.get(id)?.archivedAt !== null,
      );
      if (missing.length > 0) {
        throw new ApiError('NOT_FOUND', 'One or more candidates were not found.', {
          candidateIds: missing,
        });
      }

      // AC-PL-04: do-not-present list beats the admin's intent, per candidate.
      const blocked = candidateIds.filter((id) =>
        (byId.get(id)?.doNotPresentToClientIds ?? []).includes(
          requisition.clientId,
        ),
      );
      if (blocked.length > 0) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'One or more candidates must not be presented to this client.',
          {
            blockedCandidates: blocked.map((candidateId) => ({
              candidateId,
              reason: 'do_not_present_to_client',
            })),
          },
        );
      }

      // AC-PL-03: friendly duplicate detection with candidate ids; the unique
      // constraint stays authoritative for races.
      const duplicates = await findExistingAssignmentCandidateIds(
        db,
        requisitionId,
        candidateIds,
      );
      if (duplicates.length > 0) {
        throw new ApiError(
          'DUPLICATE_ASSIGNMENT',
          'One or more candidates are already assigned to this requisition.',
          { candidateIds: duplicates },
        );
      }

      const created: Assignment[] = [];
      try {
        await withTransaction(db, async (tx) => {
          for (const candidateId of candidateIds) {
            const assignment = await insertAssignment(tx, {
              requisitionId,
              candidateId,
              assignedBy: actor.userId,
              adminNote: body.adminNote ?? null,
            });
            created.push(assignment);
            await emitEvent(tx, {
              entityType: 'assignment',
              entityId: assignment.id,
              eventType: 'assigned',
              actorId: actor.userId,
              actorRole: actor.role,
              fromValue: null,
              toValue: 'sourced',
              metadata: { requisitionId, candidateId },
            });
          }
        });
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code: unknown }).code)
            : undefined;
        if (code === PG_UNIQUE_VIOLATION) {
          throw new ApiError(
            'DUPLICATE_ASSIGNMENT',
            'One or more candidates are already assigned to this requisition.',
          );
        }
        throw error;
      }

      const rows: AdminAssignmentRow[] = [];
      for (const assignment of created) {
        rows.push(await requireAdminRow(db, assignment.id));
      }
      return withAdminPhotoUrls(rows);
    },

    // -----------------------------------------------------------------------
    // GET /requisitions/:id/assignments (assignment.view)
    // -----------------------------------------------------------------------
    async listForRequisition(requisitionId, actor) {
      if (actor.ownClientId !== null) {
        // Tenant-filtered existence check, then the VIEW — never candidates
        // (CLAUDE.md rule 3; the repository queries client_visible_assignments
        // exclusively, so internal stages are structurally absent, AC-PL-07).
        const scoped = await requireRequisition(db, requisitionId, actor.ownClientId);
        return withClientPhotoUrls(
          await listClientVisibleAssignments(db, actor.ownClientId, scoped.id),
        );
      }
      const requisition = await requireRequisition(db, requisitionId);
      return withAdminPhotoUrls(
        await listAdminAssignmentsForRequisition(db, requisition.id),
      );
    },

    // -----------------------------------------------------------------------
    // GET /assignments/:id (assignment.view)
    // -----------------------------------------------------------------------
    async get(assignmentId, actor) {
      if (actor.ownClientId !== null) {
        // View-backed and stage-gated: a foreign, internal-stage, or
        // nonexistent assignment is indistinguishably 404.
        const row = await findClientVisibleAssignment(
          db,
          actor.ownClientId,
          assignmentId,
        );
        if (row === null) {
          throw new ApiError('NOT_FOUND', 'Assignment not found.');
        }
        return clientRowWithPhotoUrl(row);
      }
      return adminRowWithPhotoUrl(await requireAdminRow(db, assignmentId));
    },

    // -----------------------------------------------------------------------
    // PATCH /assignments/:id (assignment.advance)
    // -----------------------------------------------------------------------
    async update(assignmentId, body, actor) {
      assertAdminSurface(actor);
      const existing = await requireAdminRow(db, assignmentId);
      await withTransaction(db, async (tx) => {
        const written = await updateAssignment(tx, assignmentId, {
          ...(body.adminNote !== undefined ? { adminNote: body.adminNote } : {}),
          ...(body.clientNote !== undefined ? { clientNote: body.clientNote } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        });
        if (!written) throw new ApiError('NOT_FOUND', 'Assignment not found.');
        await emitEvent(tx, {
          entityType: 'assignment',
          entityId: assignmentId,
          eventType: 'assignment_updated',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: {
            requisitionId: existing.requisitionId,
            candidateId: existing.candidateId,
            changedFields: Object.keys(body),
          },
        });
      });
      return adminRowWithPhotoUrl(await requireAdminRow(db, assignmentId));
    },

    // -----------------------------------------------------------------------
    // POST /assignments/:id/advance (assignment.advance, AC-PL-01)
    // -----------------------------------------------------------------------
    async advance(assignmentId, toStage, note, actor) {
      assertAdminSurface(actor);
      const existing = await requireAdminRow(db, assignmentId);
      const from = existing.stage;
      if (!canTransition(ASSIGNMENT_TRANSITIONS, from, toStage)) {
        throw invalidTransition(from, toStage);
      }
      // The consent gate holds on EVERY path into `presented`, not only the
      // bulk present action — otherwise advance would be a bypass (J5).
      if (toStage === 'presented') {
        await assertConsent(db, [existing.candidateId]);
      }
      await withTransaction(db, async (tx) => {
        const written = await writeAssignmentStage(tx, assignmentId, from, toStage, {
          ...(toStage === 'presented' ? { presentedBy: actor.userId } : {}),
        });
        if (!written) {
          // Concurrent transition won the CAS.
          throw invalidTransition(from, toStage);
        }
        await emitStageEvent(tx, existing, actor, from, toStage, {
          ...(note !== null ? { note } : {}),
        });
      });
      deps.invalidateAttentionQueue?.();
      return adminRowWithPhotoUrl(await requireAdminRow(db, assignmentId));
    },

    // -----------------------------------------------------------------------
    // POST /assignments/present (candidate.present, J5, 06 §2.1)
    // -----------------------------------------------------------------------
    async present(body, actor) {
      assertAdminSurface(actor);
      const assignmentIds = [...new Set(body.assignmentIds)];

      const rows: AdminAssignmentRow[] = [];
      for (const id of assignmentIds) {
        rows.push(await requireAdminRow(db, id));
      }

      // One requisition per present action — the requisition transition and
      // the per-client notification are singular by design (J5 steps 3–4).
      const requisitionIds = [...new Set(rows.map((row) => row.requisitionId))];
      const requisitionId = requisitionIds[0];
      if (requisitionIds.length !== 1 || requisitionId === undefined) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'All assignments in one present action must belong to the same requisition.',
          { requisitionIds },
        );
      }
      const requisition = await requireRequisition(db, requisitionId);

      // Stage machine: only `vetted` may move to `presented` (01 §5).
      const notPresentable = rows.filter(
        (row) => !canTransition(ASSIGNMENT_TRANSITIONS, row.stage, 'presented'),
      );
      const first = notPresentable[0];
      if (first !== undefined) {
        throw new ApiError(
          'INVALID_TRANSITION',
          `Cannot move an assignment from '${first.stage}' to 'presented'.`,
          {
            from: first.stage,
            to: 'presented',
            assignmentIds: notPresentable.map((row) => row.id),
          },
        );
      }

      // Requisition machine: sourcing → candidates_presented, or a no-op when
      // candidates were already presented; anything else is illegal here.
      const moveRequisition = requisition.status === 'sourcing';
      if (!moveRequisition && requisition.status !== 'candidates_presented') {
        throw new ApiError(
          'INVALID_TRANSITION',
          `Cannot present candidates while the requisition is '${requisition.status}'.`,
          { from: requisition.status, to: 'candidates_presented' },
        );
      }

      // AC-PL-05: all-or-nothing consent check BEFORE any write.
      await assertConsent(db, rows.map((row) => row.candidateId));

      await withTransaction(db, async (tx) => {
        for (const row of rows) {
          const written = await writeAssignmentStage(tx, row.id, row.stage, 'presented', {
            presentedBy: actor.userId,
            ...(body.clientNote !== undefined ? { clientNote: body.clientNote } : {}),
          });
          if (!written) throw invalidTransition(row.stage, 'presented');
          await emitStageEvent(tx, row, actor, row.stage, 'presented', {
            ...(body.clientNote !== undefined ? { clientNote: body.clientNote } : {}),
          });
        }

        if (moveRequisition) {
          const written = await writeRequisitionStatus(
            tx,
            requisition.id,
            'sourcing',
            'candidates_presented',
          );
          if (!written) {
            throw new ApiError(
              'INVALID_TRANSITION',
              `Cannot present candidates while the requisition is '${requisition.status}'.`,
              { from: requisition.status, to: 'candidates_presented' },
            );
          }
          await emitEvent(tx, {
            entityType: 'requisition',
            entityId: requisition.id,
            eventType: 'status_changed',
            actorId: actor.userId,
            actorRole: actor.role,
            fromValue: 'sourcing',
            toValue: 'candidates_presented',
            metadata: {
              clientId: requisition.clientId,
              reference: requisition.reference,
            },
          });
        }

        // AC-PL-06: `candidates_presented` once per client user.
        const recipients = await getActiveClientUsers(tx, requisition.clientId);
        for (const recipient of recipients) {
          await safeEnqueue(tx, deps.logger, {
            event: 'candidates_presented',
            recipient,
            entityType: 'requisition',
            entityId: requisition.id,
            context: {
              clientName: requisition.clientName,
              requisitionReference: requisition.reference,
              roleTitle: requisition.advertisedTitle,
              candidateCount: rows.length,
              actorUserId: actor.userId,
            },
          });
        }
      });

      deps.invalidateAttentionQueue?.();
      const fresh: AdminAssignmentRow[] = [];
      for (const row of rows) {
        fresh.push(await requireAdminRow(db, row.id));
      }
      return withAdminPhotoUrls(fresh);
    },

    // -----------------------------------------------------------------------
    // POST /assignments/:id/approve-for-interview (client action, J6)
    // -----------------------------------------------------------------------
    async approveForInterview(assignmentId, actor) {
      const clientId = requireClientScope(actor);
      const existing = await findAdminAssignmentById(db, assignmentId);
      // Tenant + visibility gate first: anything the client may not see —
      // wrong tenant, internal stage — is a plain 404 (04 §1.3).
      if (
        existing === null ||
        existing.clientId !== clientId ||
        (await findClientVisibleAssignment(db, clientId, assignmentId)) === null
      ) {
        throw new ApiError('NOT_FOUND', 'Assignment not found.');
      }
      const from = existing.stage;
      if (!canTransition(ASSIGNMENT_TRANSITIONS, from, 'client_reviewing')) {
        throw invalidTransition(from, 'client_reviewing');
      }
      const requisition = await requireRequisition(db, existing.requisitionId);
      await withTransaction(db, async (tx) => {
        const written = await writeAssignmentStage(
          tx,
          assignmentId,
          from,
          'client_reviewing',
          { clientDecisionAt: true },
        );
        if (!written) throw invalidTransition(from, 'client_reviewing');
        await emitStageEvent(tx, existing, actor, from, 'client_reviewing', {
          decision: 'approved_for_interview',
        });
        await notifyAdminsOfClientDecision(
          tx,
          requisition,
          assignmentId,
          'approved_for_interview',
          actor.userId,
        );
      });
      deps.invalidateAttentionQueue?.();
      const fresh = await findClientVisibleAssignment(db, clientId, assignmentId);
      if (fresh === null) {
        throw new ApiError('INTERNAL_ERROR', 'Assignment disappeared mid-write.');
      }
      return clientRowWithPhotoUrl(fresh);
    },

    // -----------------------------------------------------------------------
    // POST /assignments/:id/reject (assignment.reject, AC-PL-09/10/11)
    // -----------------------------------------------------------------------
    async reject(assignmentId, body, actor) {
      // Actor derives from the caller's resolved context — a client-scoped
      // caller rejects as 'client', an unscoped caller as 'admin'. The body
      // schema has no actor field; a spoofed one was stripped at validation.
      const actorKind: RejectionActor =
        actor.ownClientId === null ? 'admin' : 'client';

      const existing = await findAdminAssignmentById(db, assignmentId);
      if (existing === null) {
        throw new ApiError('NOT_FOUND', 'Assignment not found.');
      }
      if (actorKind === 'client') {
        // Own client only, and only what the view exposes (rule 3).
        if (
          existing.clientId !== actor.ownClientId ||
          (await findClientVisibleAssignment(
            db,
            existing.clientId,
            assignmentId,
          )) === null
        ) {
          throw new ApiError('NOT_FOUND', 'Assignment not found.');
        }
      }

      const toStage: AssignmentStage =
        actorKind === 'admin' ? 'rejected_by_admin' : 'rejected_by_client';
      const from = existing.stage;
      if (!canTransition(ASSIGNMENT_TRANSITIONS, from, toStage)) {
        throw invalidTransition(from, toStage);
      }

      // AC-PL-11: same rule as chk_reason_present, surfaced as a 422.
      const reasonId = body.reasonId ?? null;
      const reasonOther = body.reasonOther ?? null;
      if (reasonId === null && reasonOther === null) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'A rejection requires reasonId or reasonOther.',
          { fields: { reasonId: 'Provide reasonId or reasonOther.' } },
        );
      }
      if (reasonId !== null) {
        const reason = await findRejectionReasonById(db, reasonId);
        if (reason === null || !reason.isActive) {
          throw new ApiError('VALIDATION_FAILED', 'Unknown rejection reason.', {
            fields: { reasonId: 'Not an active rejection reason.' },
          });
        }
        if (reason.actor !== actorKind) {
          throw new ApiError(
            'VALIDATION_FAILED',
            `Rejection reason '${reason.key}' is not a ${actorKind}-side reason.`,
            { fields: { reasonId: `Not a ${actorKind}-side reason.` } },
          );
        }
      }

      const requisition = await requireRequisition(db, existing.requisitionId);
      await withTransaction(db, async (tx) => {
        const written = await writeAssignmentStage(tx, assignmentId, from, toStage, {
          ...(actorKind === 'client' ? { clientDecisionAt: true } : {}),
        });
        if (!written) throw invalidTransition(from, toStage);
        const rejectionId = await insertRejection(tx, {
          assignmentId,
          actor: actorKind,
          rejectedBy: actor.userId,
          reasonId,
          reasonOther,
          detail: body.detail ?? null,
        });
        await emitStageEvent(tx, existing, actor, from, toStage, {
          rejectionId,
          rejectionActor: actorKind,
          ...(reasonId !== null ? { reasonId } : {}),
          ...(reasonOther !== null ? { reasonOther } : {}),
        });
        if (actorKind === 'client') {
          await notifyAdminsOfClientDecision(
            tx,
            requisition,
            assignmentId,
            'rejected',
            actor.userId,
          );
        }
      });

      deps.invalidateAttentionQueue?.();
      if (actorKind === 'client') {
        // rejected_by_client is a client-visible stage; serve the view row.
        const fresh = await findClientVisibleAssignment(
          db,
          existing.clientId,
          assignmentId,
        );
        if (fresh === null) {
          throw new ApiError('INTERNAL_ERROR', 'Assignment disappeared mid-write.');
        }
        return clientRowWithPhotoUrl(fresh);
      }
      return adminRowWithPhotoUrl(await requireAdminRow(db, assignmentId));
    },

    // -----------------------------------------------------------------------
    // POST /assignments/:id/request-interview (client action, 04 §9)
    // -----------------------------------------------------------------------
    async requestInterview(assignmentId, actor) {
      const clientId = requireClientScope(actor);
      const visible = await findClientVisibleAssignment(db, clientId, assignmentId);
      if (visible === null) {
        throw new ApiError('NOT_FOUND', 'Assignment not found.');
      }
      const requisition = await requireRequisition(db, visible.requisitionId);
      // No stage change and no interview record (04 §9) — an audit event and
      // the admin notification only.
      await withTransaction(db, async (tx) => {
        await emitEvent(tx, {
          entityType: 'assignment',
          entityId: assignmentId,
          eventType: 'interview_requested',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: {
            requisitionId: visible.requisitionId,
            candidateId: visible.candidateId,
          },
        });
        await notifyAdminsOfClientDecision(
          tx,
          requisition,
          assignmentId,
          'interview_requested',
          actor.userId,
        );
      });
      // Re-read so the response reflects the just-written event in
      // `interviewRequestedAt` (UX 3.2).
      const fresh = await findClientVisibleAssignment(db, clientId, assignmentId);
      if (fresh === null) {
        throw new ApiError('INTERNAL_ERROR', 'Assignment disappeared mid-write.');
      }
      return clientRowWithPhotoUrl(fresh);
    },

    // -----------------------------------------------------------------------
    // POST /assignments/:id/place (assignment.advance, J8, AC-PL-13)
    // -----------------------------------------------------------------------
    async place(assignmentId, body, actor) {
      assertAdminSurface(actor);
      const existing = await requireAdminRow(db, assignmentId);
      const requisition = await requireRequisition(db, existing.requisitionId);

      if (!canTransition(ASSIGNMENT_TRANSITIONS, existing.stage, 'placed')) {
        throw invalidTransition(existing.stage, 'placed');
      }
      // Requisition path: offer_extended → placed (01 §4).
      if (!canTransition(REQUISITION_TRANSITIONS, requisition.status, 'placed')) {
        throw new ApiError(
          'INVALID_TRANSITION',
          `Cannot move a requisition from '${requisition.status}' to 'placed'.`,
          { from: requisition.status, to: 'placed' },
        );
      }

      let placement: Placement | null = null;
      await withTransaction(db, async (tx) => {
        // 1. assignment → placed
        const stageWritten = await writeAssignmentStage(
          tx,
          assignmentId,
          existing.stage,
          'placed',
        );
        if (!stageWritten) throw invalidTransition(existing.stage, 'placed');
        await emitStageEvent(tx, existing, actor, existing.stage, 'placed');

        // 2. placements row
        placement = await insertPlacement(tx, {
          assignmentId,
          candidateId: existing.candidateId,
          clientId: requisition.clientId,
          requisitionId: requisition.id,
          startDate: body.startDate,
          endDate: body.endDate ?? null,
          rateAmount: body.rateAmount ?? null,
          rateUnit: body.rateUnit ?? null,
          rateCurrency: body.rateCurrency ?? null,
          hoursPerWeek: body.hoursPerWeek ?? null,
          serviceTier: body.serviceTier ?? null,
          guaranteeEndDate: body.guaranteeEndDate ?? null,
        });
        await emitEvent(tx, {
          entityType: 'assignment',
          entityId: assignmentId,
          eventType: 'placement_created',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: {
            placementId: placement.id,
            requisitionId: requisition.id,
            candidateId: existing.candidateId,
          },
        });

        // 3. requisition → placed
        const statusWritten = await writeRequisitionStatus(
          tx,
          requisition.id,
          requisition.status,
          'placed',
          { closedAt: true },
        );
        if (!statusWritten) {
          throw new ApiError(
            'INVALID_TRANSITION',
            `Cannot move a requisition from '${requisition.status}' to 'placed'.`,
            { from: requisition.status, to: 'placed' },
          );
        }
        await emitEvent(tx, {
          entityType: 'requisition',
          entityId: requisition.id,
          eventType: 'status_changed',
          actorId: actor.userId,
          actorRole: actor.role,
          fromValue: requisition.status,
          toValue: 'placed',
          metadata: {
            clientId: requisition.clientId,
            reference: requisition.reference,
          },
        });

        // 4. non-terminal siblings → closed_not_selected, one event each
        const siblings = await listSiblingsForPlacement(
          tx,
          requisition.id,
          assignmentId,
          NON_TERMINAL_STAGES,
        );
        for (const sibling of siblings) {
          const closed = await writeAssignmentStage(
            tx,
            sibling.id,
            sibling.stage,
            'closed_not_selected',
          );
          if (!closed) {
            throw invalidTransition(sibling.stage, 'closed_not_selected');
          }
          await emitStageEvent(
            tx,
            {
              id: sibling.id,
              requisitionId: requisition.id,
              candidateId: sibling.candidateId,
            },
            actor,
            sibling.stage,
            'closed_not_selected',
            { placedAssignmentId: assignmentId },
          );
        }

        // 5. candidate pool_status → placed
        const poolWritten = await setCandidatePoolStatus(
          tx,
          existing.candidateId,
          'placed',
        );
        if (!poolWritten) {
          throw new ApiError('NOT_FOUND', 'Candidate not found.');
        }
        await emitEvent(tx, {
          entityType: 'candidate',
          entityId: existing.candidateId,
          eventType: 'pool_status_changed',
          actorId: actor.userId,
          actorRole: actor.role,
          fromValue: existing.candidate.poolStatus,
          toValue: 'placed',
          metadata: { placementId: placement.id, requisitionId: requisition.id },
        });

        // 6. requisition_status_changed to the client's users (06 §4.4)
        const recipients = await getActiveClientUsers(tx, requisition.clientId);
        for (const recipient of recipients) {
          await safeEnqueue(tx, deps.logger, {
            event: 'requisition_status_changed',
            recipient,
            entityType: 'requisition',
            entityId: requisition.id,
            context: {
              clientName: requisition.clientName,
              requisitionReference: requisition.reference,
              roleTitle: requisition.advertisedTitle,
              fromStatus: requisition.status,
              toStatus: 'placed',
              actorUserId: actor.userId,
            },
          });
        }
      });

      deps.invalidateAttentionQueue?.();
      if (placement === null) {
        throw new ApiError('INTERNAL_ERROR', 'Placement was not created.');
      }
      return placement;
    },

    // -----------------------------------------------------------------------
    // GET /assignments/:id/events (event.view)
    // -----------------------------------------------------------------------
    async listEvents(assignmentId, actor) {
      assertAdminSurface(actor);
      const existing = await requireAdminRow(db, assignmentId);
      const events = await listEventsForEntity(db, 'assignment', existing.id);
      return dedupeEvents(events);
    },
  };
}
