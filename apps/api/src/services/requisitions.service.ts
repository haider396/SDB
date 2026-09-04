/**
 * Requisition lifecycle business rules (docs/04-API.md §7, docs/01 §3 J3 /
 * §4, docs/06-BACKEND.md §2.2). No HTTP types, no SQL strings.
 *
 * Rules enforced here:
 * - all status writes go through the REQUISITION_TRANSITIONS adjacency map;
 *   an illegal move is 409 INVALID_TRANSITION with { from, to } (AC-RQ-01/02)
 * - commercial fields are OMITTED — keys absent, not null — for callers
 *   without `requisition.view_commercials` (AC-RQ-06)
 * - only the requisition's principal may approve or request changes, even
 *   with the permission (AC-RQ-04); request-changes requires a comment
 * - client-scoped callers are implicitly tenant-filtered; a foreign
 *   requisition is a 404 (04 §1.3)
 * - answer upserts run through the SAME six-step intake validation pipeline
 * - every status change writes an event and queues the
 *   `requisition_status_changed` notification to all client users (06 §4.4);
 *   a failed enqueue never rolls back the transition
 * - the events read de-duplicates app+trigger pairs on
 *   (entity_id, event_type, occurred_at) within 1s for display (06 §2.3)
 */
import {
  REQUISITION_COMMERCIAL_KEYS,
  type EntityEvent,
  type IntakeAnswer,
  type ListRequisitionsQuery,
  type Requisition,
  type RequisitionDetail,
  type RequisitionStatus,
  type TransitionRequisitionBody,
  type UpdateRequisitionBody,
  type UserRoleKey,
} from '@sdb/contracts';
import { decodeCursor, encodeCursor } from '../lib/cursor.js';
import { withTransaction, type Db, type Tx } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import {
  getActiveClientUsers,
  findMember,
} from '../repositories/clients.repo.js';
import { getActiveFormQuestions } from '../repositories/intake.repo.js';
import {
  findRequisitionById,
  getAnswersForRequisition,
  getClientVisibleStageCounts,
  getStageCounts,
  getTaxonomyLabels,
  listEventsForEntity,
  listRequisitions,
  replaceAnswerOptions,
  updateRequisition,
  upsertAnswer,
  writeRequisitionStatus,
  type EventRecord,
  type RequisitionRecord,
} from '../repositories/requisitions.repo.js';
import { findClientPlacementForRequisition } from '../repositories/placements.repo.js';
import { findUserById } from '../repositories/users.repo.js';
import { emitEvent } from './events.js';
import {
  buildSnapshot,
  validateSubmission,
  type PreparedAnswer,
} from './intake-submission.service.js';
import { safeEnqueue, type EnqueueLogger } from './notifications.js';
import { canTransition, REQUISITION_TRANSITIONS } from './state-machines.js';

export interface RequisitionActor {
  userId: string;
  role: UserRoleKey | null;
  /** Resolved membership scope — null for admin callers (04 §1.3). */
  ownClientId: string | null;
  /** `requisition.view_commercials` (AC-RQ-06). */
  canViewCommercials: boolean;
}

export interface RequisitionsServiceDeps {
  db: Db;
  logger?: EnqueueLogger;
  /**
   * Attention-queue clear-on-write hook (UX 1.7): called after any
   * successful status transition so the admin queue never serves a stale
   * cache. Coarse by design.
   */
  invalidateAttentionQueue?: () => void;
}

export interface RequisitionsService {
  list(
    query: ListRequisitionsQuery,
    actor: RequisitionActor,
  ): Promise<{ data: Requisition[]; nextCursor: string | null; total?: number }>;
  get(requisitionId: string, actor: RequisitionActor): Promise<RequisitionDetail>;
  update(
    requisitionId: string,
    body: UpdateRequisitionBody,
    actor: RequisitionActor,
  ): Promise<RequisitionDetail>;
  updateAnswers(
    requisitionId: string,
    answers: IntakeAnswer[],
    actor: RequisitionActor,
  ): Promise<RequisitionDetail>;
  transition(
    requisitionId: string,
    body: TransitionRequisitionBody,
    actor: RequisitionActor,
  ): Promise<Requisition>;
  requestPrincipalApproval(
    requisitionId: string,
    actor: RequisitionActor,
  ): Promise<Requisition>;
  principalApprove(
    requisitionId: string,
    actor: RequisitionActor,
  ): Promise<Requisition>;
  principalRequestChanges(
    requisitionId: string,
    comment: string,
    actor: RequisitionActor,
  ): Promise<Requisition>;
  listEvents(requisitionId: string, actor: RequisitionActor): Promise<EntityEvent[]>;
}

/** Strip commercial keys entirely — absent, not null (AC-RQ-06). */
function toRequisitionPayload(
  record: RequisitionRecord,
  includeCommercials: boolean,
): Record<string, unknown> {
  const payload: Record<string, unknown> = { ...record };
  if (!includeCommercials) {
    for (const key of REQUISITION_COMMERCIAL_KEYS) {
      delete payload[key];
    }
  }
  return payload;
}

/** Postgres check_violation (chk_budget_order). */
const PG_CHECK_VIOLATION = '23514';

export function createRequisitionsService(
  deps: RequisitionsServiceDeps,
): RequisitionsService {
  /**
   * Tenant-filtered load: scoped callers only ever see their own client's
   * requisitions — anything else is a 404 (04 §1.3, AC-AUTH-05).
   * `requisitionRef` accepts the internal uuid OR the 12-char public_id
   * (0015); callers that keep using their `requisitionId` parameter after
   * this reassign it to the returned record's `.id`.
   */
  async function load(
    requisitionRef: string,
    actor: RequisitionActor,
  ): Promise<RequisitionRecord> {
    const record =
      actor.ownClientId === null
        ? await findRequisitionById(deps.db, requisitionRef)
        : await findRequisitionById(deps.db, requisitionRef, actor.ownClientId);
    if (record === null) {
      throw new ApiError('NOT_FOUND', 'Requisition not found.');
    }
    return record;
  }

  async function buildDetail(
    record: RequisitionRecord,
    actor: RequisitionActor,
  ): Promise<RequisitionDetail> {
    const [taxonomy, answers, countsByStage, placement] = await Promise.all([
      getTaxonomyLabels(deps.db, {
        engineId: record.engineId,
        departmentId: record.departmentId,
        roleCategoryId: record.roleCategoryId,
      }),
      getAnswersForRequisition(deps.db, record.id),
      // Client callers see counts over client_visible_assignments ONLY —
      // internal stages stay structurally invisible (CLAUDE.md rule 3).
      actor.ownClientId === null
        ? getStageCounts(deps.db, record.id)
        : getClientVisibleStageCounts(deps.db, actor.ownClientId, record.id),
      // Post-hire guarantee window (T31). Dates and status only — safe for a
      // client caller, and the same shape the dashboard returns.
      findClientPlacementForRequisition(deps.db, record.id),
    ]);
    const payload = {
      ...toRequisitionPayload(record, actor.canViewCommercials),
      taxonomy,
      answers: answers.map((answer) => {
        const snapshot = answer.questionSnapshot;
        return {
          id: answer.id,
          questionId: answer.questionId,
          questionKey: answer.questionKey,
          label:
            typeof snapshot['label'] === 'string'
              ? snapshot['label']
              : answer.questionKey,
          questionType:
            typeof snapshot['questionType'] === 'string'
              ? snapshot['questionType']
              : 'unknown',
          valueText: answer.valueText,
          valueNumber: answer.valueNumber,
          valueBoolean: answer.valueBoolean,
          valueDate: answer.valueDate,
          valueJson: answer.valueJson ?? null,
          selectedOptions: answer.selectedOptions,
          questionSnapshot: snapshot,
          answeredBy: answer.answeredBy,
          createdAt: answer.createdAt,
          updatedAt: answer.updatedAt,
        };
      }),
      countsByStage,
      placement,
    };
    return payload as unknown as RequisitionDetail;
  }

  /** Queue `requisition_status_changed` to every active user of the client. */
  async function notifyStatusChanged(
    tx: Tx,
    record: RequisitionRecord,
    toStatus: RequisitionStatus,
    actorUserId: string,
  ): Promise<void> {
    const recipients = await getActiveClientUsers(tx, record.clientId);
    for (const recipient of recipients) {
      await safeEnqueue(tx, deps.logger, {
        event: 'requisition_status_changed',
        recipient,
        entityType: 'requisition',
        entityId: record.id,
        context: {
          clientName: record.clientName,
          requisitionReference: record.reference,
          roleTitle: record.advertisedTitle,
          fromStatus: record.status,
          toStatus,
          actorUserId,
        },
      });
    }
  }

  interface TransitionStamps {
    principalApprovedAt?: boolean;
    principalChangeRequest?: string | null;
  }

  /**
   * The single status-write path (06 §2.2): validate against the adjacency
   * map, CAS-write the row, emit the event, and queue notifications — one
   * transaction. Timestamps derive from the target status.
   */
  async function performTransition(
    record: RequisitionRecord,
    toStatus: RequisitionStatus,
    actor: RequisitionActor,
    note: string | null,
    stamps: TransitionStamps = {},
    extra?: (tx: Tx) => Promise<void>,
  ): Promise<RequisitionRecord> {
    const from = record.status;
    if (!canTransition(REQUISITION_TRANSITIONS, from, toStatus)) {
      throw new ApiError(
        'INVALID_TRANSITION',
        `Cannot move a requisition from '${from}' to '${toStatus}'.`,
        { from, to: toStatus },
      );
    }

    // T16 gate. Rebecca, 35:40: "we cannot look for the position until we have
    // the job description." Enforced here rather than in the UI so it holds
    // for every caller — the admin page, the client portal, and the API.
    //
    // Only the move INTO sourcing is blocked: a position legitimately sits
    // without a description while it is still submitted or awaiting approval.
    if (
      toStatus === 'sourcing' &&
      (record.jobDescription === null || record.jobDescription.trim() === '')
    ) {
      throw new ApiError(
        'VALIDATION_FAILED',
        'Add a job description before sourcing starts — it is what candidates are shown.',
        { fields: { jobDescription: 'A job description is required before sourcing.' } },
      );
    }

    await withTransaction(deps.db, async (tx) => {
      const written = await writeRequisitionStatus(tx, record.id, from, toStatus, {
        ...(stamps.principalApprovedAt === true ? { principalApprovedAt: true } : {}),
        ...(toStatus === 'sourcing' ? { sourcingStartedAt: true } : {}),
        ...(toStatus === 'closed_unfilled' || toStatus === 'placed'
          ? { closedAt: true }
          : {}),
        ...(stamps.principalChangeRequest !== undefined
          ? { principalChangeRequest: stamps.principalChangeRequest }
          : {}),
      });
      if (!written) {
        // Concurrent transition won the CAS — the caller's move is no longer
        // legal from the actual current state.
        throw new ApiError(
          'INVALID_TRANSITION',
          `Cannot move a requisition from '${from}' to '${toStatus}'.`,
          { from, to: toStatus },
        );
      }
      await emitEvent(tx, {
        entityType: 'requisition',
        entityId: record.id,
        eventType: 'status_changed',
        actorId: actor.userId,
        actorRole: actor.role,
        fromValue: from,
        toValue: toStatus,
        metadata: {
          clientId: record.clientId,
          reference: record.reference,
          ...(note !== null ? { note } : {}),
        },
      });
      await notifyStatusChanged(tx, record, toStatus, actor.userId);
      if (extra !== undefined) await extra(tx);
    });
    deps.invalidateAttentionQueue?.();

    const updated = await findRequisitionById(deps.db, record.id);
    if (updated === null) {
      throw new ApiError('INTERNAL_ERROR', 'Requisition disappeared mid-write.');
    }
    return updated;
  }

  /** AC-RQ-04: identity, not permission — 403 for anyone but the principal. */
  function assertIsPrincipal(
    record: RequisitionRecord,
    actor: RequisitionActor,
  ): void {
    if (record.principalUserId === null || record.principalUserId !== actor.userId) {
      throw new ApiError(
        'FORBIDDEN',
        'Only the designated principal may act on this requisition.',
      );
    }
  }

  return {
    async list(query, actor) {
      // 04 §1.3: a client-scoped caller's tenant filter comes from their
      // membership — the clientId query param is admin-only and ignored here.
      const clientId = actor.ownClientId ?? query.clientId;
      const { data: rows, total } = await listRequisitions(deps.db, {
        ...(clientId !== undefined ? { clientId } : {}),
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.engineId !== undefined ? { engineId: query.engineId } : {}),
        ...(query.roleCategoryId !== undefined
          ? { roleCategoryId: query.roleCategoryId }
          : {}),
        ...(query.search !== undefined ? { search: query.search } : {}),
        limit: query.limit,
        ...(query.cursor !== undefined ? { cursor: decodeCursor(query.cursor) } : {}),
      });
      const last = rows[rows.length - 1];
      return {
        data: rows.map(
          (row) =>
            toRequisitionPayload(row, actor.canViewCommercials) as unknown as Requisition,
        ),
        nextCursor:
          rows.length === query.limit && last !== undefined
            ? encodeCursor({ createdAt: last.createdAt, id: last.id })
            : null,
        // UX 2.9: full filtered count — first (un-cursored) pages only.
        ...(query.cursor === undefined ? { total } : {}),
      };
    },

    async get(requisitionId, actor) {
      const record = await load(requisitionId, actor);
      return buildDetail(record, actor);
    },

    async update(requisitionId, body, actor) {
      const record = await load(requisitionId, actor);
      requisitionId = record.id;

      // 02 §7: budget_unit is mandatory whenever a budget amount is present —
      // checked against the MERGED row so partial updates stay coherent.
      const mergedMin = body.budgetMin !== undefined ? body.budgetMin : record.budgetMin;
      const mergedMax = body.budgetMax !== undefined ? body.budgetMax : record.budgetMax;
      const mergedUnit =
        body.budgetUnit !== undefined ? body.budgetUnit : record.budgetUnit;
      if ((mergedMin !== null || mergedMax !== null) && mergedUnit === null) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'budgetUnit is required whenever a budget amount is present.',
          { fields: { budgetUnit: 'Required when a budget amount is set.' } },
        );
      }
      if (mergedMin !== null && mergedMax !== null && mergedMin > mergedMax) {
        throw new ApiError('VALIDATION_FAILED', 'budgetMin exceeds budgetMax.', {
          fields: { budgetMin: 'Must not exceed budgetMax.' },
        });
      }

      // The principal must belong to the requisition's client (01 §3 J3).
      if (body.principalUserId !== undefined && body.principalUserId !== null) {
        const member = await findMember(deps.db, record.clientId, body.principalUserId);
        if (member === null) {
          throw new ApiError(
            'VALIDATION_FAILED',
            'principalUserId must be a member of the requisition’s client.',
            { fields: { principalUserId: 'Not a member of this client.' } },
          );
        }
      }

      try {
        await withTransaction(deps.db, async (tx) => {
          const updated = await updateRequisition(tx, requisitionId, body);
          if (!updated) throw new ApiError('NOT_FOUND', 'Requisition not found.');
          await emitEvent(tx, {
            entityType: 'requisition',
            entityId: requisitionId,
            eventType: 'requisition_updated',
            actorId: actor.userId,
            actorRole: actor.role,
            metadata: {
              clientId: record.clientId,
              changedFields: Object.keys(body),
            },
          });
        });
      } catch (error) {
        const code =
          typeof error === 'object' && error !== null && 'code' in error
            ? String((error as { code: unknown }).code)
            : undefined;
        if (code === PG_CHECK_VIOLATION) {
          throw new ApiError('VALIDATION_FAILED', 'budgetMin exceeds budgetMax.', {
            fields: { budgetMin: 'Must not exceed budgetMax.' },
          });
        }
        throw error;
      }
      const fresh = await load(requisitionId, actor);
      return buildDetail(fresh, actor);
    },

    async updateAnswers(requisitionId, answers, actor) {
      const record = await load(requisitionId, actor);
      requisitionId = record.id;

      // Same six-step pipeline as intake (03 §3.3): validate the MERGED
      // answer set (stored + incoming) against the active scope, then write
      // only the incoming keys — untouched answers keep their snapshots.
      const scope = await getActiveFormQuestions(deps.db, record.roleCategoryId);
      const scopeKeys = new Set(scope.map((question) => question.key));
      const incomingKeys = new Set(answers.map((answer) => answer.questionKey));

      const existing = await getAnswersForRequisition(deps.db, requisitionId);
      const merged: IntakeAnswer[] = [...answers];
      for (const stored of existing) {
        if (incomingKeys.has(stored.questionKey)) continue;
        if (!scopeKeys.has(stored.questionKey)) continue; // question retired
        if (stored.valueText !== null) {
          merged.push({ questionKey: stored.questionKey, valueText: stored.valueText });
        } else if (stored.valueNumber !== null) {
          merged.push({ questionKey: stored.questionKey, valueNumber: stored.valueNumber });
        } else if (stored.valueBoolean !== null) {
          merged.push({ questionKey: stored.questionKey, valueBoolean: stored.valueBoolean });
        } else if (stored.valueDate !== null) {
          merged.push({ questionKey: stored.questionKey, valueDate: stored.valueDate });
        } else if (stored.valueJson !== null && stored.valueJson !== undefined) {
          merged.push({
            questionKey: stored.questionKey,
            valueJson: stored.valueJson as IntakeAnswer['valueJson'],
          });
        }
      }

      const prepared = validateSubmission(scope, merged);
      const toWrite: PreparedAnswer[] = prepared.filter((entry) =>
        incomingKeys.has(entry.question.key),
      );
      const capturedAt = new Date().toISOString();

      await withTransaction(deps.db, async (tx) => {
        for (const entry of toWrite) {
          const answerId = await upsertAnswer(tx, {
            requisitionId,
            questionId: entry.question.id,
            questionKey: entry.question.key,
            valueText: entry.valueText,
            valueNumber: entry.valueNumber,
            valueBoolean: entry.valueBoolean,
            valueDate: entry.valueDate,
            valueJson: entry.valueJson,
            questionSnapshot: buildSnapshot(entry.question, capturedAt),
            answeredBy: actor.userId,
          });
          await replaceAnswerOptions(tx, answerId, entry.optionIds);
        }
        await emitEvent(tx, {
          entityType: 'requisition',
          entityId: requisitionId,
          eventType: 'answers_updated',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: {
            clientId: record.clientId,
            questionKeys: toWrite.map((entry) => entry.question.key),
          },
        });
      });

      const fresh = await load(requisitionId, actor);
      return buildDetail(fresh, actor);
    },

    async transition(requisitionId, body, actor) {
      const record = await load(requisitionId, actor);
      const updated = await performTransition(
        record,
        body.toStatus,
        actor,
        body.note ?? null,
      );
      return toRequisitionPayload(
        updated,
        actor.canViewCommercials,
      ) as unknown as Requisition;
    },

    async requestPrincipalApproval(requisitionId, actor) {
      const record = await load(requisitionId, actor);
      if (record.principalUserId === null) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'Set principalUserId before requesting principal approval.',
          { fields: { principalUserId: 'No principal designated.' } },
        );
      }
      const principal = await findUserById(deps.db, record.principalUserId);
      const updated = await performTransition(
        record,
        'pending_principal_approval',
        actor,
        null,
        {},
        async (tx) => {
          if (principal !== null) {
            await safeEnqueue(tx, deps.logger, {
              event: 'principal_approval_requested',
              recipient: {
                userId: principal.id,
                email: principal.email,
                fullName: principal.fullName,
              },
              entityType: 'requisition',
              entityId: record.id,
              context: {
                clientName: record.clientName,
                requisitionReference: record.reference,
                roleTitle: record.advertisedTitle,
                actorUserId: actor.userId,
              },
            });
          }
        },
      );
      return toRequisitionPayload(
        updated,
        actor.canViewCommercials,
      ) as unknown as Requisition;
    },

    async principalApprove(requisitionId, actor) {
      const record = await load(requisitionId, actor);
      assertIsPrincipal(record, actor);
      const updated = await performTransition(record, 'sourcing', actor, null, {
        principalApprovedAt: true,
        principalChangeRequest: null,
      });
      return toRequisitionPayload(
        updated,
        actor.canViewCommercials,
      ) as unknown as Requisition;
    },

    async principalRequestChanges(requisitionId, comment, actor) {
      const record = await load(requisitionId, actor);
      assertIsPrincipal(record, actor);
      const updated = await performTransition(
        record,
        'changes_requested',
        actor,
        comment,
        { principalChangeRequest: comment },
      );
      return toRequisitionPayload(
        updated,
        actor.canViewCommercials,
      ) as unknown as Requisition;
    },

    async listEvents(requisitionId, actor) {
      const record = await load(requisitionId, actor);
      const events = await listEventsForEntity(deps.db, 'requisition', record.id);
      return dedupeEvents(events);
    },
  };
}

/**
 * Display de-duplication (06 §2.3): the app emits an event and the DB trigger
 * writes a backstop for the same change. Rows sharing (entity_id, event_type,
 * from, to) within a one-second window collapse to one — preferring the
 * app-sourced row, which carries the actor.
 *
 * Generic over the record type so enriched read models (e.g. the client
 * dashboard's feed records with requisition context) keep their extra fields
 * through dedupe. EventRecord is structurally an EntityEvent (including the
 * read-time actorName), so callers typed to EntityEvent[] remain sound.
 */
export function dedupeEvents<T extends EventRecord>(events: T[]): T[] {
  const kept: T[] = [];
  for (const event of events) {
    const duplicateIndex = kept.findIndex(
      (candidate) =>
        candidate.entityId === event.entityId &&
        candidate.eventType === event.eventType &&
        candidate.fromValue === event.fromValue &&
        candidate.toValue === event.toValue &&
        Math.abs(
          new Date(candidate.occurredAt).getTime() -
            new Date(event.occurredAt).getTime(),
        ) <= 1000,
    );
    if (duplicateIndex === -1) {
      kept.push(event);
      continue;
    }
    const existing = kept[duplicateIndex];
    if (existing !== undefined && existing.actorId === null && event.actorId !== null) {
      kept[duplicateIndex] = event; // prefer the app event (has the actor)
    }
  }
  return kept;
}
