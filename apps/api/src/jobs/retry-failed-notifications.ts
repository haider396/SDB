/**
 * retry-failed-notifications (docs/06-BACKEND.md §5): every 5 minutes, retry
 * `notification_log` rows with `status = 'failed'` and `attempts < 3` whose
 * backoff window (1 min / 5 min / 30 min after the last attempt, 06 §4.3)
 * has elapsed, and drain any stale 'queued' rows the post-commit dispatch
 * never reached (crash recovery). Idempotent — a row reaching 3 attempts is
 * never retried again. Directly callable with an injectable clock (AC-NT-04).
 */
import type { NotificationDispatchService } from '../services/notification-dispatch.service.js';

export interface RetryJobLogger {
  info(obj: Record<string, unknown>, msg: string): void;
}

export interface RetryFailedNotificationsOptions {
  /** Injectable clock for backoff-window evaluation; default: real now. */
  now?: Date;
  logger?: RetryJobLogger;
}

/** Returns the number of dispatch attempts made. */
export async function retryFailedNotifications(
  dispatch: NotificationDispatchService,
  options: RetryFailedNotificationsOptions = {},
): Promise<number> {
  options.logger?.info({ job: 'retry-failed-notifications' }, 'job start');
  const attempted = await dispatch.retryFailed(options.now);
  options.logger?.info(
    { job: 'retry-failed-notifications', affectedRows: attempted },
    'job finish',
  );
  return attempted;
}
