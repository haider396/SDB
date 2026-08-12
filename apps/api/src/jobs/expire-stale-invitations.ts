/**
 * expire-stale-invitations (docs/06-BACKEND.md §5): invalidate invitations
 * unaccepted after 14 days. Runs daily at 02:00 UTC; also directly callable
 * so tests control the clock via the `cutoff` parameter (AC-CL-05).
 *
 * Invalidation archives the membership row (and clears its exclusive flags),
 * which makes the token's DB acceptance path fail: markInvitationAccepted
 * only matches rows with `accepted_at is null AND archived_at is null`.
 * Idempotent — already-archived rows never match again. Every invalidation
 * writes an events row (CLAUDE.md rule 6).
 */
import { withTransaction, type Db } from '../lib/db.js';
import { expireInvitationsBefore } from '../repositories/clients.repo.js';
import { emitEvent } from '../services/events.js';
import { INVITATION_TTL_SECONDS } from '../services/invitations.js';

export interface ExpireJobLogger {
  info(obj: Record<string, unknown>, msg: string): void;
}

export interface ExpireStaleInvitationsOptions {
  /** Invitations issued before this instant expire. Default: now − 14 days. */
  cutoff?: Date;
  logger?: ExpireJobLogger;
}

/** Returns the number of invitations invalidated. */
export async function expireStaleInvitations(
  db: Db,
  options: ExpireStaleInvitationsOptions = {},
): Promise<number> {
  const cutoff =
    options.cutoff ?? new Date(Date.now() - INVITATION_TTL_SECONDS * 1000);
  options.logger?.info(
    { job: 'expire-stale-invitations', cutoff: cutoff.toISOString() },
    'job start',
  );

  const expired = await withTransaction(db, async (tx) => {
    const rows = await expireInvitationsBefore(tx, cutoff.toISOString());
    for (const row of rows) {
      await emitEvent(tx, {
        entityType: 'client',
        entityId: row.clientId,
        eventType: 'invitation_expired',
        actorId: null,
        actorRole: null,
        metadata: {
          userId: row.userId,
          clientMemberId: row.memberId,
          cutoff: cutoff.toISOString(),
        },
      });
    }
    return rows;
  });

  options.logger?.info(
    { job: 'expire-stale-invitations', affectedRows: expired.length },
    'job finish',
  );
  return expired.length;
}
