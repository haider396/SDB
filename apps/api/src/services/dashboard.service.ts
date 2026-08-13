/**
 * Client dashboard composition (docs/04-API.md §12 GET /client/dashboard,
 * docs/05-FRONTEND.md P5 landing page). No HTTP types, no SQL strings.
 *
 * Rules enforced here:
 * - the surface exists ONLY for client-scoped callers; an unscoped (admin)
 *   caller gets a plain 404 — the admin landing page is the attention queue
 * - the caller's clientId comes from their resolved membership, never from
 *   the request (04 §1.3); every repository call is tenant-filtered
 * - stage summaries and awaiting-review candidates come exclusively from
 *   `client_visible_assignments` (CLAUDE.md rules 3–4)
 * - principal approvals appear only when the CALLER is the requisition's
 *   designated principal — another member sees an empty list
 * - recent events are requisition events only, de-duplicated app+trigger
 *   pairs (06 §2.3), capped at 20
 */
import type { ClientDashboard, UserRoleKey } from '@sdb/contracts';
import type { Db } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import {
  getStageCountsByRequisition,
  listCandidatesAwaitingReview,
  listClientRequisitionSummaries,
  listPendingPrincipalApprovals,
  listRecentClientRequisitionEvents,
} from '../repositories/dashboard.repo.js';
import { dedupeEvents } from './requisitions.service.js';

const RECENT_EVENTS_LIMIT = 20;
/** Fetch overhead so post-dedupe still fills the page. */
const RECENT_EVENTS_FETCH = RECENT_EVENTS_LIMIT * 2;

export interface DashboardActor {
  userId: string;
  role: UserRoleKey | null;
  /** Resolved membership scope — null for admin callers (04 §1.3). */
  ownClientId: string | null;
}

export interface DashboardServiceDeps {
  db: Db;
}

export interface DashboardService {
  getClientDashboard(actor: DashboardActor): Promise<ClientDashboard>;
}

export function createDashboardService(
  deps: DashboardServiceDeps,
): DashboardService {
  const { db } = deps;

  return {
    async getClientDashboard(actor) {
      const clientId = actor.ownClientId;
      if (clientId === null) {
        // The client surface does not exist for unscoped callers.
        throw new ApiError('NOT_FOUND', 'Resource not found.');
      }

      const [summaries, stageCounts, approvals, awaitingReview, rawEvents] =
        await Promise.all([
          listClientRequisitionSummaries(db, clientId),
          getStageCountsByRequisition(db, clientId),
          listPendingPrincipalApprovals(db, clientId, actor.userId),
          listCandidatesAwaitingReview(db, clientId),
          listRecentClientRequisitionEvents(db, clientId, RECENT_EVENTS_FETCH),
        ]);

      return {
        requisitions: summaries.map((summary) => ({
          id: summary.id,
          publicId: summary.publicId,
          reference: summary.reference,
          advertisedTitle: summary.advertisedTitle,
          status: summary.status,
          submittedAt: summary.submittedAt,
          updatedAt: summary.updatedAt,
          stageCounts: stageCounts.get(summary.id) ?? {},
        })),
        pendingActions: {
          principalApprovals: approvals,
          candidatesAwaitingReview: awaitingReview,
        },
        recentEvents: dedupeEvents(rawEvents).slice(0, RECENT_EVENTS_LIMIT),
      };
    },
  };
}
