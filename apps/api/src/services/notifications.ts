/**
 * Notification enqueue helpers (docs/06-BACKEND.md §4.3). Dispatch is P7 —
 * P2 only writes `notification_log` rows with status 'queued'.
 *
 * `safeEnqueue` runs the insert inside a SAVEPOINT and swallows failures:
 * a notification failure must never fail — or roll back — the user-facing
 * request (AC-CL-03). The savepoint matters: without it, a failed insert
 * aborts the enclosing Postgres transaction and every later statement in the
 * grant/transition flow would fail with 25P02.
 */
import type { NotificationEvent } from '@sdb/contracts';
import type { Tx } from '../lib/db.js';
import { enqueueNotification } from '../repositories/intake.repo.js';

export interface NotificationRecipient {
  userId: string;
  email: string;
  fullName: string;
}

export interface EnqueueLogger {
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface EnqueueInput {
  event: NotificationEvent;
  recipient: NotificationRecipient;
  entityType: string;
  entityId: string;
  /** Merged into the standard payload's `context` (06 §4.1). */
  context: Record<string, unknown>;
}

/**
 * Enqueue one notification; returns false (and logs) instead of throwing.
 * Callers pass the OPEN transaction — the row commits with the state change.
 */
export async function safeEnqueue(
  tx: Tx,
  logger: EnqueueLogger | undefined,
  input: EnqueueInput,
): Promise<boolean> {
  try {
    await tx.savepoint(async (sp) => {
      await enqueueNotification(sp, {
        event: input.event,
        recipientEmail: input.recipient.email,
        recipientUserId: input.recipient.userId,
        entityType: input.entityType,
        entityId: input.entityId,
        payload: {
          event: input.event,
          recipient: {
            email: input.recipient.email,
            fullName: input.recipient.fullName,
            userId: input.recipient.userId,
          },
          context: input.context,
          sentAt: null,
        },
      });
    });
    return true;
  } catch (error) {
    logger?.warn(
      { err: String(error), event: input.event, entityId: input.entityId },
      'notification enqueue failed; state change committed regardless (06 §4.3)',
    );
    return false;
  }
}
