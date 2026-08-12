/**
 * In-process scheduled jobs via node-cron (docs/06-BACKEND.md §5).
 *
 * P0 wires the scheduler registration point only. The six jobs in 06 §5 land
 * with their owning phases (retry-failed-notifications → P7,
 * extract-cv-text → P3, etc.). All jobs must be idempotent and log start,
 * finish, and affected row counts.
 */
import cron from 'node-cron';
import type { Logger } from '../lib/logger.js';

export interface ScheduledJobs {
  stop: () => void;
}

export function registerJobs(logger: Logger): ScheduledJobs {
  const tasks: cron.ScheduledTask[] = [];

  // No jobs are scheduled in P0. Later phases push cron.schedule(...) tasks
  // into `tasks` here so shutdown stops them cleanly.

  logger.info({ scheduledJobs: tasks.length }, 'cron scheduler registered');

  return {
    stop() {
      for (const task of tasks) task.stop();
    },
  };
}
