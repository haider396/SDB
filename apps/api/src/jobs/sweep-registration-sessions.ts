/**
 * sweep-registration-sessions: delete abandoned public registration sessions
 * and the objects they staged.
 *
 * `candidate_registration_sessions` expires after 24 hours, and 0017's own
 * comment promises a scheduled sweep — but `findExpiredSessions` and
 * `deleteSessions` were never wired to anything. Until now every visitor who
 * started the form, uploaded a CV and walked away left that CV in Storage
 * permanently. That is a retention defect, not untidiness: it is an unbounded,
 * monotonically growing store of candidate PII nobody consented to keep.
 *
 * ORDER MATTERS. Storage objects are removed BEFORE the rows, because the rows
 * are the only record of the paths — delete them first and the objects are
 * orphaned with no way left to find them. If a removal fails, the session is
 * skipped and retried on the next run rather than losing that record.
 *
 * Idempotent: a session already gone never matches again, and removing an
 * object that is already absent is a success.
 */
import type { Db } from '../lib/db.js';
import {
  deleteSessions,
  findExpiredSessions,
} from '../repositories/candidate-registration.repo.js';
import type { SupabaseStoragePort } from '../lib/supabase-storage.js';

export interface SweepJobLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface SweepRegistrationSessionsOptions {
  /** Cap per run so one sweep cannot monopolise the connection pool. */
  limit?: number;
  logger?: SweepJobLogger;
}

export interface SweepRegistrationSessionsResult {
  sessionsDeleted: number;
  objectsRemoved: number;
  sessionsSkipped: number;
}

export async function sweepRegistrationSessions(
  db: Db,
  storage: SupabaseStoragePort,
  options: SweepRegistrationSessionsOptions = {},
): Promise<SweepRegistrationSessionsResult> {
  const limit = options.limit ?? 500;
  options.logger?.info({ job: 'sweep-registration-sessions', limit }, 'job start');

  const expired = await findExpiredSessions(db, limit);
  const deletable: string[] = [];
  let objectsRemoved = 0;
  let sessionsSkipped = 0;

  for (const session of expired) {
    let allRemoved = true;
    for (const path of session.storagePaths) {
      try {
        await storage.removeObject(path);
        objectsRemoved += 1;
      } catch (cause) {
        // Keep the row so the path is still discoverable next run.
        allRemoved = false;
        options.logger?.warn(
          {
            job: 'sweep-registration-sessions',
            sessionId: session.id,
            storagePath: path,
            err: cause instanceof Error ? cause.message : String(cause),
          },
          'could not remove staged object; session kept for retry',
        );
        break;
      }
    }
    if (allRemoved) deletable.push(session.id);
    else sessionsSkipped += 1;
  }

  const sessionsDeleted = await deleteSessions(db, deletable);

  options.logger?.info(
    {
      job: 'sweep-registration-sessions',
      sessionsDeleted,
      objectsRemoved,
      sessionsSkipped,
      affectedRows: sessionsDeleted,
    },
    'job finish',
  );
  return { sessionsDeleted, objectsRemoved, sessionsSkipped };
}
