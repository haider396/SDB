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
import { expireStaleInvitations } from './expire-stale-invitations.js';
import { extractCvText } from './extract-cv-text.js';
import { flagIncompleteCandidates } from './flag-incomplete-candidates.js';

export interface ScheduledJobs {
  stop: () => void;
}

export interface JobDeps {
  logger: Logger;
  db: Db;
  /** Storage port for CV downloads (extract-cv-text). */
  storage: SupabaseStoragePort;
}

export function registerJobs(deps: JobDeps): ScheduledJobs {
  const { logger, db, storage } = deps;
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

  logger.info({ scheduledJobs: tasks.length }, 'cron scheduler registered');

  return {
    stop() {
      for (const task of tasks) task.stop();
    },
  };
}
