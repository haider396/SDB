/**
 * Admin stats, the rejection-reasons report, and the global event log
 * (docs/04-API.md §12). No HTTP types, no SQL strings.
 *
 * Rules enforced here:
 * - stats and the report are unscoped-only surfaces; a client-scoped caller
 *   gets a plain 404 even when their role carries the route permission
 *   (`/events` and `/reports/*` additionally require `event.view`, which
 *   client roles do not hold — this is defence in depth, not the gate)
 * - the rejection report window is inclusive [from, to]; from > to is a 422
 *   before any query runs
 * - free-text rejections surface as one 'other' row per actor with their
 *   texts listed (AC-PL-15)
 * - the event list paginates on a (occurred_at, id) keyset, newest first,
 *   and de-duplicates app+trigger pairs for display (06 §2.3). The
 *   `nextCursor` is taken from the RAW page, before dedupe, so pagination
 *   never skips rows; a merged pair can therefore reappear collapsed on the
 *   next page boundary — duplicates are acceptable, missing rows are not.
 */
import type {
  AdminStats,
  EntityEvent,
  ListEventsQuery,
  RejectionReasonsQuery,
  RejectionReasonsReport,
  UserRoleKey,
} from '@sdb/contracts';
import { decodeCursor, encodeCursor } from '../lib/cursor.js';
import type { Db } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import {
  countActivePlacements,
  countOpenRequisitions,
  getAverageDaysToPresent,
  getCandidatesByStage,
  getRejectionReasonGroups,
  listEventsPage,
} from '../repositories/reporting.repo.js';
import { dedupeEvents } from './requisitions.service.js';

/** Display label for the free-text group (AC-PL-15). */
const OTHER_KEY = 'other';
const OTHER_LABEL = 'Other (free text)';

export interface ReportingActor {
  userId: string;
  role: UserRoleKey | null;
  /** Resolved membership scope — null for admin callers (04 §1.3). */
  ownClientId: string | null;
}

export interface ReportingServiceDeps {
  db: Db;
}

export interface ReportingService {
  getAdminStats(actor: ReportingActor): Promise<AdminStats>;
  getRejectionReasonsReport(
    query: RejectionReasonsQuery,
    actor: ReportingActor,
  ): Promise<RejectionReasonsReport>;
  listEvents(
    query: ListEventsQuery,
    actor: ReportingActor,
  ): Promise<{ data: EntityEvent[]; nextCursor: string | null }>;
}

export function createReportingService(
  deps: ReportingServiceDeps,
): ReportingService {
  const { db } = deps;

  /** These admin surfaces do not exist for client-scoped callers. */
  function assertAdminSurface(actor: ReportingActor): void {
    if (actor.ownClientId !== null) {
      throw new ApiError('NOT_FOUND', 'Resource not found.');
    }
  }

  return {
    async getAdminStats(actor) {
      assertAdminSurface(actor);
      const [openRequisitions, candidatesByStage, averageDaysToPresent, activePlacements] =
        await Promise.all([
          countOpenRequisitions(db),
          getCandidatesByStage(db),
          getAverageDaysToPresent(db),
          countActivePlacements(db),
        ]);
      return {
        openRequisitions,
        candidatesByStage,
        averageDaysToPresent,
        activePlacements,
      };
    },

    async getRejectionReasonsReport(query, actor) {
      assertAdminSurface(actor);
      if (new Date(query.from).getTime() > new Date(query.to).getTime()) {
        throw new ApiError('VALIDATION_FAILED', '`from` must not be after `to`.', {
          fields: { from: 'Must not be after `to`.' },
        });
      }
      const groups = await getRejectionReasonGroups(db, {
        from: query.from,
        to: query.to,
        actor: query.actor ?? null,
        roleCategoryId: query.roleCategoryId ?? null,
      });
      const rows = groups.map((group) => ({
        actor: group.actor,
        reasonId: group.reasonId,
        // A reason-null group is the free-text bucket (AC-PL-15).
        reasonKey: group.reasonKey ?? OTHER_KEY,
        label: group.label ?? OTHER_LABEL,
        count: group.count,
        otherTexts: group.otherTexts,
      }));
      return {
        from: query.from,
        to: query.to,
        actor: query.actor ?? null,
        roleCategoryId: query.roleCategoryId ?? null,
        totalCount: rows.reduce((sum, row) => sum + row.count, 0),
        rows,
      };
    },

    async listEvents(query, actor) {
      assertAdminSurface(actor);
      // The cursor payload reuses the shared keyset shape; `createdAt`
      // carries occurred_at here.
      const after =
        query.cursor === undefined ? null : decodeCursor(query.cursor);
      const raw = await listEventsPage(
        db,
        {
          entityType: query.entityType ?? null,
          entityId: query.entityId ?? null,
          eventType: query.eventType ?? null,
          actorId: query.actorId ?? null,
          from: query.from ?? null,
          to: query.to ?? null,
        },
        query.limit + 1,
        after === null ? null : { occurredAt: after.createdAt, id: after.id },
      );
      const hasMore = raw.length > query.limit;
      const page = hasMore ? raw.slice(0, query.limit) : raw;
      const last = page[page.length - 1];
      const nextCursor =
        hasMore && last !== undefined
          ? encodeCursor({ createdAt: last.occurredAt, id: last.id })
          : null;
      return { data: dedupeEvents(page), nextCursor };
    },
  };
}
