/**
 * Notification dispatch orchestration (docs/06-BACKEND.md §4.3, P7).
 *
 * ## Post-commit dispatch design
 *
 * P2–P6 enqueue `notification_log` rows (status 'queued') INSIDE the same
 * transaction as the state change they announce; nothing dispatches inline.
 * Dispatch is strictly post-commit and strictly fire-and-forget:
 *
 * 1. app.ts registers an `onResponse` hook that calls `scheduleDrain()` after
 *    every successful mutating request. `onResponse` runs after the reply has
 *    left the server, so the enqueueing transaction has committed and no
 *    dispatch outcome can ever alter — let alone fail — the user-facing
 *    response (AC-NT-03).
 * 2. `scheduleDrain()` defers to `setImmediate` and coalesces: one drain loop
 *    runs at a time, and a request landing mid-drain simply flags another
 *    pass. The drain claims ALL queued rows (not "the request's rows") — the
 *    row is the unit of work, so a drain triggered by request B harmlessly
 *    delivers what request A enqueued if A's drain lost the race.
 * 3. The `retry-failed-notifications` cron (every 5 min, 06 §5) is the safety
 *    net: an immediate attempt that fails — or a process crash between commit
 *    and drain, which leaves rows 'queued' — is picked up there. It also
 *    drains stale 'queued' rows for exactly that crash case.
 *
 * ## Attempt bookkeeping
 *
 * Migration 0009 (forward-only, frozen) has no last_attempt_at column, so
 * each attempt's instant lives in the provider_response jsonb envelope:
 * `{ attemptedAt, httpStatus, body }` — `body` being the response body §4.3
 * requires stored. Backoff (1 min / 5 min / 30 min, max 3 attempts) is
 * evaluated against `attemptedAt` with an injectable clock (AC-NT-04).
 */
import type {
  ListNotificationsQuery,
  NotificationLogRow,
  NotificationPayload,
  UserRoleKey,
} from '@sdb/contracts';
import type { GoHighLevelClient } from '../integrations/gohighlevel.js';
import { decodeCursor, encodeCursor } from '../lib/cursor.js';
import { withTransaction, type Db } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import {
  findNotificationById,
  getAssignmentRequisitionContext,
  getClientCompanyName,
  getRequisitionContext,
  getUserFullName,
  listFailedRetryCandidates,
  listNotificationsPage,
  listQueuedNotifications,
  markNotificationFailed,
  markNotificationSent,
  requeueNotification,
} from '../repositories/notifications.repo.js';
import { emitEvent } from './events.js';

/** 06 §4.3: maximum 3 attempts. */
export const MAX_DISPATCH_ATTEMPTS = 3;
/**
 * 06 §4.3 backoff: after the Nth failed attempt, the next attempt becomes
 * eligible this long after it. With the 3-attempt cap only the first two
 * windows can fire; the 30-minute window is kept so raising the cap needs
 * no other change.
 */
export const RETRY_BACKOFF_MS: readonly number[] = [60_000, 300_000, 1_800_000];

const DRAIN_BATCH_LIMIT = 100;

export interface DispatchLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
  error(obj: Record<string, unknown>, msg: string): void;
}

export interface NotificationDispatchDeps {
  db: Db;
  ghl: GoHighLevelClient;
  publicAppUrl: string;
  logger?: DispatchLogger;
  /** Injectable clock (AC-NT-04); defaults to Date.now-based real time. */
  now?: () => Date;
}

export interface DispatchActor {
  userId: string;
  role: UserRoleKey | null;
}

export interface NotificationDispatchService {
  /**
   * Fire-and-forget post-commit trigger: coalesced, deferred, never throws.
   * Safe to call from a response hook.
   */
  scheduleDrain(): void;
  /** Await quiescence of the drain loop — for tests and shutdown. */
  idle(): Promise<void>;
  /** Dispatch every queued row now. Returns the number of rows attempted. */
  drainQueued(): Promise<number>;
  /**
   * Retry failed rows within the backoff windows; also drains any stale
   * queued rows (crash recovery). Returns the number of rows attempted.
   */
  retryFailed(now?: Date): Promise<number>;
  /** Admin log view (GET /admin/notifications). */
  list(query: ListNotificationsQuery): Promise<{
    data: NotificationLogRow[];
    nextCursor: string | null;
    total?: number;
  }>;
  /** Manual resend: re-queue, write the event row, dispatch immediately. */
  resend(id: string, actor: DispatchActor): Promise<NotificationLogRow>;
}

interface StoredRecipient {
  email: string;
  fullName: string;
  userId: string | null;
}

/** The §4.1 recipient block from the enqueue-time payload. */
function storedRecipient(row: NotificationLogRow): StoredRecipient {
  const recipient = (row.payload as { recipient?: Partial<StoredRecipient> })
    .recipient;
  return {
    email: recipient?.email ?? row.recipientEmail,
    fullName: recipient?.fullName ?? '',
    userId: recipient?.userId ?? row.recipientUserId,
  };
}

function splitFullName(fullName: string): { firstName: string; lastName: string } {
  const trimmed = fullName.trim();
  if (trimmed === '') return { firstName: '', lastName: '' };
  const [first, ...rest] = trimmed.split(/\s+/u);
  return { firstName: first ?? '', lastName: rest.join(' ') };
}

export function createNotificationDispatchService(
  deps: NotificationDispatchDeps,
): NotificationDispatchService {
  const { db, ghl, publicAppUrl } = deps;
  const now = (): Date => (deps.now !== undefined ? deps.now() : new Date());

  // -------------------------------------------------------------------------
  // Payload build (06 §4.1: identical shape for every event, every field a
  // template might need present even when unused).
  // -------------------------------------------------------------------------

  async function buildPayload(row: NotificationLogRow): Promise<NotificationPayload> {
    const stored = row.payload as {
      context?: Record<string, unknown>;
    };
    const storedContext = stored.context ?? {};

    const context: Record<string, unknown> = {
      clientName: null,
      requisitionReference: null,
      roleTitle: null,
      candidateCount: null,
      actionUrl: null,
      actorName: null,
      ...storedContext,
    };

    // intake_submitted enqueues `companyName` (the prospect has no portal
    // client name yet); surface it under the standard merge-field name too.
    if (context['clientName'] == null && typeof context['companyName'] === 'string') {
      context['clientName'] = context['companyName'];
    }

    // Enrich from the entity reference for anything the enqueue site did not
    // carry. Enrichment is best-effort: a vanished entity leaves nulls rather
    // than failing the dispatch.
    if (row.entityId !== null) {
      if (row.entityType === 'requisition' || row.entityType === 'assignment') {
        const enriched =
          row.entityType === 'requisition'
            ? await getRequisitionContext(db, row.entityId)
            : await getAssignmentRequisitionContext(db, row.entityId);
        if (enriched !== null) {
          if (context['clientName'] == null) context['clientName'] = enriched.clientName;
          if (context['requisitionReference'] == null) {
            context['requisitionReference'] = enriched.reference;
          }
          if (context['roleTitle'] == null) context['roleTitle'] = enriched.advertisedTitle;
        }
      } else if (row.entityType === 'client' && context['clientName'] == null) {
        context['clientName'] = await getClientCompanyName(db, row.entityId);
      }
    }

    if (context['actorName'] == null && typeof context['actorUserId'] === 'string') {
      context['actorName'] = await getUserFullName(db, context['actorUserId']);
    }

    if (context['actionUrl'] == null) {
      const reference = context['requisitionReference'];
      context['actionUrl'] =
        typeof reference === 'string'
          ? `${publicAppUrl}/requisitions/${reference}`
          : publicAppUrl;
    }

    const recipient = storedRecipient(row);
    const { firstName, lastName } = splitFullName(recipient.fullName);

    return {
      event: row.event,
      recipient: {
        email: recipient.email,
        firstName,
        lastName,
        userId: recipient.userId,
      },
      context: context as NotificationPayload['context'],
      sentAt: now().toISOString(),
      notificationLogId: row.id,
    };
  }

  // -------------------------------------------------------------------------
  // Single-row dispatch: build → POST → mark sent/failed (06 §4.3).
  // -------------------------------------------------------------------------

  async function dispatchRow(row: NotificationLogRow): Promise<void> {
    const attemptedAt = now().toISOString();
    let payload: NotificationPayload | null = null;
    try {
      payload = await buildPayload(row);
    } catch (error) {
      await markNotificationFailed(db, {
        id: row.id,
        payload: null,
        providerResponse: { attemptedAt, httpStatus: null, body: null },
        error: `payload build failed: ${String(error)}`,
      });
      deps.logger?.error(
        { notificationLogId: row.id, event: row.event, err: String(error) },
        'notification payload build failed',
      );
      return;
    }

    const result = await ghl.dispatch(row.event, payload);
    const payloadRecord = payload as unknown as Record<string, unknown>;
    if (result.ok) {
      await markNotificationSent(db, {
        id: row.id,
        payload: payloadRecord,
        providerResponse: {
          attemptedAt,
          httpStatus: result.httpStatus,
          body: result.responseBody,
        },
        sentAt: payload.sentAt ?? attemptedAt,
      });
      deps.logger?.info(
        { notificationLogId: row.id, event: row.event, httpStatus: result.httpStatus },
        'notification sent',
      );
    } else {
      await markNotificationFailed(db, {
        id: row.id,
        payload: payloadRecord,
        providerResponse: {
          attemptedAt,
          httpStatus: result.httpStatus,
          body: result.responseBody,
        },
        error: result.error,
      });
      deps.logger?.warn(
        {
          notificationLogId: row.id,
          event: row.event,
          attempts: row.attempts + 1,
          err: result.error,
        },
        'notification dispatch failed',
      );
    }
  }

  async function drainPass(): Promise<number> {
    const rows = await listQueuedNotifications(db, DRAIN_BATCH_LIMIT);
    for (const row of rows) {
      await dispatchRow(row);
    }
    return rows.length;
  }

  // -------------------------------------------------------------------------
  // Serialized dispatch executor. Every dispatching entry point — the
  // post-commit drain, the retry cron, explicit test drains, and manual
  // resends — runs through one promise chain, so no two code paths can pick
  // up the same 'queued' row concurrently and double-POST it. A single
  // in-process executor suffices: 06 §8 mandates one long-running process.
  // -------------------------------------------------------------------------

  let chain: Promise<unknown> = Promise.resolve();

  function serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = chain.then(fn, fn);
    chain = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Fire-and-forget post-commit trigger: enqueue a pass, swallow failures. */
  function scheduleDrain(): void {
    serialize(drainPass).catch((error: unknown) => {
      // Never let a drain failure escape into the caller (06 §4.3);
      // affected rows stay queued for the cron safety net.
      deps.logger?.error({ err: String(error) }, 'notification drain pass failed');
    });
  }

  /** Resolves once every dispatch scheduled so far has settled. */
  async function idle(): Promise<void> {
    let current: Promise<unknown>;
    do {
      current = chain;
      await current;
    } while (current !== chain); // work was appended while we waited
  }

  // -------------------------------------------------------------------------
  // Retry job body (06 §5 retry-failed-notifications).
  // -------------------------------------------------------------------------

  function lastAttemptAt(row: NotificationLogRow): number | null {
    const response = row.providerResponse as { attemptedAt?: unknown } | null;
    if (response === null || typeof response !== 'object') return null;
    const raw = response.attemptedAt;
    if (typeof raw !== 'string') return null;
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
  }

  function isRetryEligible(row: NotificationLogRow, at: Date): boolean {
    if (row.attempts >= MAX_DISPATCH_ATTEMPTS) return false;
    if (row.attempts === 0) return true;
    const last = lastAttemptAt(row);
    if (last === null) return true; // no attempt record — do not strand the row
    const waitMs =
      RETRY_BACKOFF_MS[Math.min(row.attempts, RETRY_BACKOFF_MS.length) - 1] ??
      RETRY_BACKOFF_MS[RETRY_BACKOFF_MS.length - 1] ??
      0;
    return at.getTime() - last >= waitMs;
  }

  async function retryPass(at?: Date): Promise<number> {
    const clock = at ?? now();
    let attempted = 0;
    // Crash recovery: rows the post-commit drain never reached stay 'queued'.
    attempted += await drainPass();
    const candidates = await listFailedRetryCandidates(
      db,
      MAX_DISPATCH_ATTEMPTS,
      DRAIN_BATCH_LIMIT,
    );
    for (const row of candidates) {
      if (!isRetryEligible(row, clock)) continue;
      await dispatchRow(row);
      attempted += 1;
    }
    return attempted;
  }

  // -------------------------------------------------------------------------
  // Admin surface.
  // -------------------------------------------------------------------------

  return {
    scheduleDrain,
    idle,
    drainQueued: () => serialize(drainPass),
    retryFailed: (at?: Date) => serialize(() => retryPass(at)),

    async list(query) {
      const after = query.cursor === undefined ? null : decodeCursor(query.cursor);
      const { data: rows, total } = await listNotificationsPage(
        db,
        { status: query.status ?? null, event: query.event ?? null },
        query.limit + 1,
        after,
      );
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      const nextCursor =
        rows.length > query.limit && last !== undefined
          ? encodeCursor({ createdAt: last.createdAt, id: last.id })
          : null;
      return {
        data: page,
        nextCursor,
        // UX 2.9: full filtered count — first (un-cursored) pages only.
        ...(after === null ? { total } : {}),
      };
    },

    async resend(id, actor) {
      const existing = await findNotificationById(db, id);
      if (existing === null) {
        throw new ApiError('NOT_FOUND', 'Notification not found.');
      }
      // Re-queue and audit in one transaction; dispatch strictly after commit
      // (06 §4.3), so a provider failure leaves a clean 'failed' row with a
      // fresh attempt budget rather than rolling back the resend.
      await withTransaction(db, async (tx) => {
        await requeueNotification(tx, id);
        await emitEvent(tx, {
          entityType: 'notification',
          entityId: id,
          eventType: 'notification_resent',
          actorId: actor.userId,
          actorRole: actor.role,
          fromValue: existing.status,
          toValue: 'queued',
          metadata: { event: existing.event, recipientEmail: existing.recipientEmail },
        });
      });
      // Inside the executor: re-check the status so a drain pass that beat us
      // to the freshly re-queued row does not lead to a second POST.
      await serialize(async () => {
        const requeued = await findNotificationById(db, id);
        if (requeued !== null && requeued.status === 'queued') {
          await dispatchRow(requeued);
        }
      });
      const fresh = await findNotificationById(db, id);
      if (fresh === null) {
        throw new ApiError('INTERNAL_ERROR', 'Notification vanished during resend.');
      }
      return fresh;
    },
  };
}
