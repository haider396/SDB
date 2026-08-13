/**
 * Admin needs-attention queue (docs/01-PRODUCT-OVERVIEW.md §6,
 * docs/04-API.md §12, docs/06-BACKEND.md §5). No HTTP types, no SQL strings.
 *
 * Exactly the seven buckets of 01 §6, in table order, always all seven —
 * empty buckets are present with count 0 so the landing page never guesses.
 * Thresholds are read from app_settings at query time (AC-PL-14 boundary
 * cases override them mid-test).
 *
 * Caching (06 §5 `refresh-attention-queue-cache`): the 5-minute cron job
 * precomputes into this in-process cache; the endpoint serves the cached
 * result, computes on a cache miss (first request after boot), and
 * recomputes when the caller passes `?refresh=true` (tests, manual reload).
 * In-process is deliberate — the API is a single long-running process
 * (06 §8), so there is no cross-instance invalidation to solve.
 *
 * The surface exists only for unscoped (admin) callers; a client-scoped
 * caller gets a plain 404 even though they hold `requisition.view`.
 */
import type {
  AttentionQueue,
  AttentionQueueBucket,
  AttentionQueueBucketKey,
  AttentionQueueEntityType,
} from '@sdb/contracts';
import { ATTENTION_QUEUE_BUCKET_KEYS } from '@sdb/contracts';
import type { Db } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import {
  getQueueThresholds,
  queueAwaitingClientFeedback,
  queueAwaitingPrincipalApproval,
  queueIncompleteWebhookCandidates,
  queueInterviewWithoutOutcome,
  queueNewIntakeSubmissions,
  queueNoCandidatesPresented,
  queuePaymentConfirmedAccessNotGranted,
  type QueueBucketRecord,
} from '../repositories/attention-queue.repo.js';

/** Display labels, verbatim from the 01 §6 table. */
const BUCKET_LABELS: Record<AttentionQueueBucketKey, string> = {
  new_intake_submissions: 'New intake submissions',
  awaiting_principal_approval: 'Awaiting principal approval',
  payment_confirmed_access_not_granted:
    'Payment confirmed, access not granted',
  no_candidates_presented: 'No candidates presented',
  awaiting_client_feedback: 'Awaiting client feedback',
  interview_without_outcome: 'Interview without outcome',
  incomplete_webhook_candidates: 'Incomplete webhook candidates',
};

const BUCKET_ENTITY_TYPES: Record<
  AttentionQueueBucketKey,
  AttentionQueueEntityType
> = {
  new_intake_submissions: 'requisition',
  awaiting_principal_approval: 'requisition',
  payment_confirmed_access_not_granted: 'client',
  no_candidates_presented: 'requisition',
  awaiting_client_feedback: 'assignment',
  interview_without_outcome: 'interview',
  incomplete_webhook_candidates: 'candidate',
};

export interface AttentionQueueActor {
  /** Resolved membership scope — null for admin callers (04 §1.3). */
  ownClientId: string | null;
}

export interface AttentionQueueServiceDeps {
  db: Db;
}

export interface AttentionQueueService {
  /** Cached view; `forceRefresh` recomputes (endpoint `?refresh=true`). */
  get(
    actor: AttentionQueueActor,
    opts?: { forceRefresh?: boolean },
  ): Promise<AttentionQueue>;
  /** Recompute and store — the 5-minute cron job's entry point (06 §5). */
  refresh(): Promise<AttentionQueue>;
  /**
   * Clear-on-write hook (UX 1.7): drops the cached queue so the next read
   * recomputes. Called by the requisition/assignment services whenever a
   * requisition status or assignment stage changes — deliberately coarse.
   */
  invalidate(): void;
}

export function createAttentionQueueService(
  deps: AttentionQueueServiceDeps,
): AttentionQueueService {
  const { db } = deps;

  let cache: AttentionQueue | null = null;

  function toBucket(
    key: AttentionQueueBucketKey,
    record: QueueBucketRecord,
  ): AttentionQueueBucket {
    return {
      key,
      label: BUCKET_LABELS[key],
      count: record.count,
      items: record.items.map((item) => ({
        entityType: BUCKET_ENTITY_TYPES[key],
        entityId: item.entityId,
        ...(item.requisitionId !== undefined
          ? { requisitionId: item.requisitionId }
          : {}),
        reference: item.reference,
        label: item.label,
        since: item.since,
      })),
    };
  }

  async function compute(): Promise<AttentionQueue> {
    const thresholds = await getQueueThresholds(db);
    const records: Record<AttentionQueueBucketKey, QueueBucketRecord> = {
      new_intake_submissions: await queueNewIntakeSubmissions(db),
      awaiting_principal_approval: await queueAwaitingPrincipalApproval(
        db,
        thresholds.principalApprovalDays,
      ),
      payment_confirmed_access_not_granted:
        await queuePaymentConfirmedAccessNotGranted(db),
      no_candidates_presented: await queueNoCandidatesPresented(
        db,
        thresholds.noCandidatesDays,
      ),
      awaiting_client_feedback: await queueAwaitingClientFeedback(
        db,
        thresholds.awaitingClientDays,
      ),
      interview_without_outcome: await queueInterviewWithoutOutcome(db),
      incomplete_webhook_candidates: await queueIncompleteWebhookCandidates(db),
    };
    const result: AttentionQueue = {
      computedAt: new Date().toISOString(),
      buckets: ATTENTION_QUEUE_BUCKET_KEYS.map((key) =>
        toBucket(key, records[key]),
      ),
    };
    cache = result;
    return result;
  }

  return {
    async get(actor, opts = {}) {
      if (actor.ownClientId !== null) {
        // The admin landing surface does not exist for client-scoped callers.
        throw new ApiError('NOT_FOUND', 'Resource not found.');
      }
      if (opts.forceRefresh === true || cache === null) {
        return compute();
      }
      return cache;
    },

    async refresh() {
      return compute();
    },

    invalidate() {
      cache = null;
    },
  };
}
