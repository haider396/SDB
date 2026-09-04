/**
 * In-process scheduled jobs via node-cron (docs/06-BACKEND.md §5).
 *
 * P2 registers `expire-stale-invitations` (daily 02:00 UTC). The remaining
 * jobs in 06 §5 land with their owning phases (retry-failed-notifications →
 * P7, extract-cv-text → P3, etc.). All jobs are idempotent, directly callable
 * for tests, and log start, finish, and affected row counts.
 */
import cron from 'node-cron';
import type { Db } from '../lib/db.js';
import type { Logger } from '../lib/logger.js';
import type { SupabaseStoragePort } from '../lib/supabase-storage.js';
import type { AttentionQueueService } from '../services/attention-queue.service.js';
import type { NotificationDispatchService } from '../services/notification-dispatch.service.js';
import { closeElapsedPlacements } from './close-elapsed-placements.js';
import { expireStaleInvitations } from './expire-stale-invitations.js';
import { extractCvText } from './extract-cv-text.js';
import { flagIncompleteCandidates } from './flag-incomplete-candidates.js';
import { refreshAttentionQueueCache } from './refresh-attention-queue-cache.js';
import { retryFailedNotifications } from './retry-failed-notifications.js';
import { sweepRegistrationSessions } from './sweep-registration-sessions.js';

export interface ScheduledJobs {
  stop: () => void;
}

export interface JobDeps {
  logger: Logger;
  db: Db;
  /** Storage port for CV downloads (extract-cv-text). */
  storage: SupabaseStoragePort;
  /**
   * The app's AttentionQueueService instance (buildApp decorates it on the
   * Fastify instance) — the refresh job must warm the SAME in-process cache
   * the endpoint serves, so server.ts passes `app.attentionQueue` here.
   */
  attentionQueue?: AttentionQueueService;
  /**
   * The app's dispatch service instance (buildApp decorates it on the
   * Fastify instance) — the retry job shares its GHL client, clock, and
   * drain coalescing, so server.ts passes `app.notificationDispatch` here.
   */
  notificationDispatch?: NotificationDispatchService;
}

export function registerJobs(deps: JobDeps): ScheduledJobs {
  const { logger, db, storage, attentionQueue, notificationDispatch } = deps;
  const tasks: cron.ScheduledTask[] = [];

  // expire-stale-invitations — daily 02:00 UTC (06 §5, AC-CL-05).
  tasks.push(
    cron.schedule(
      '0 2 * * *',
      () => {
        expireStaleInvitations(db, { logger }).catch((error: unknown) => {
          logger.error(
            { job: 'expire-stale-invitations', err: String(error) },
            'job failed',
          );
        });
      },
      { timezone: 'UTC' },
    ),
  );

  // close-elapsed-placements — daily 04:00 UTC (T31). Runs after the 02:00
  // invitation sweep so a day's scheduled work is spread rather than stacked.
  tasks.push(
    cron.schedule(
      '0 4 * * *',
      () => {
        closeElapsedPlacements({ db, logger }).catch((error: unknown) => {
          logger.error(
            { job: 'close-elapsed-placements', err: String(error) },
            'job failed',
          );
        });
      },
      { timezone: 'UTC' },
    ),
  );

  // sweep-registration-sessions — daily 02:30 UTC. Sits between the 02:00
  // invitation sweep and the 03:00 completeness pass, keeping the day's
  // scheduled work spread rather than stacked.
  tasks.push(
    cron.schedule(
      '30 2 * * *',
      () => {
        sweepRegistrationSessions(db, storage, { logger }).catch(
          (error: unknown) => {
            logger.error(
              { job: 'sweep-registration-sessions', err: String(error) },
              'job failed',
            );
          },
        );
      },
      { timezone: 'UTC' },
    ),
  );

  // extract-cv-text — every 2 minutes (06 §5, AC-CA-04).
  tasks.push(
    cron.schedule(
      '*/2 * * * *',
      () => {
        extractCvText(db, storage, { logger }).catch((error: unknown) => {
          logger.error({ job: 'extract-cv-text', err: String(error) }, 'job failed');
        });
      },
      { timezone: 'UTC' },
    ),
  );

  // flag-incomplete-candidates — daily 03:00 UTC (06 §5).
  tasks.push(
    cron.schedule(
      '0 3 * * *',
      () => {
        flagIncompleteCandidates(db, { logger }).catch((error: unknown) => {
          logger.error(
            { job: 'flag-incomplete-candidates', err: String(error) },
            'job failed',
          );
        });
      },
      { timezone: 'UTC' },
    ),
  );

  // refresh-attention-queue-cache — every 5 minutes (06 §5, AC-PL-14).
  if (attentionQueue !== undefined) {
    tasks.push(
      cron.schedule(
        '*/5 * * * *',
        () => {
          refreshAttentionQueueCache(attentionQueue, { logger }).catch(
            (error: unknown) => {
              logger.error(
                { job: 'refresh-attention-queue-cache', err: String(error) },
                'job failed',
              );
            },
          );
        },
        { timezone: 'UTC' },
      ),
    );
  }

  // retry-failed-notifications — every 5 minutes (06 §5, AC-NT-04).
  if (notificationDispatch !== undefined) {
    tasks.push(
      cron.schedule(
        '*/5 * * * *',
        () => {
          retryFailedNotifications(notificationDispatch, { logger }).catch(
            (error: unknown) => {
              logger.error(
                { job: 'retry-failed-notifications', err: String(error) },
                'job failed',
              );
            },
          );
        },
        { timezone: 'UTC' },
      ),
    );
  }

  logger.info({ scheduledJobs: tasks.length }, 'cron scheduler registered');

  return {
    stop() {
      for (const task of tasks) task.stop();
    },
  };
}
