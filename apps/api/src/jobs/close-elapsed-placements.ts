/**
 * Auto-close placements whose guarantee window has elapsed (T31).
 *
 * Rebecca, 38:10: "Once they're post 90 days, it's closed. We know they're
 * set, they're fine, if they need a resource, we just start from the
 * beginning."
 *
 * Only `active` placements are touched, and only once their guarantee end
 * date is in the past. A placement already ended by either side keeps that
 * status — "completed" means the guarantee ran its course, not merely that
 * time passed, so it must never overwrite a real outcome.
 *
 * The requisition is deliberately NOT touched: it is already `placed`, which
 * is terminal in REQUISITION_TRANSITIONS. Closing here is about the placement's
 * guarantee, not about reopening or re-closing the hiring process.
 *
 * Idempotent: a second run finds nothing left to close.
 */
import type { Db } from '../lib/db.js';
import type { Logger } from '../lib/logger.js';
import { emitEvent } from '../services/events.js';
import { withTransaction } from '../lib/db.js';

export interface CloseElapsedPlacementsDeps {
  db: Db;
  logger: Logger;
  /** Injectable clock so tests can advance past a guarantee date. */
  now?: () => Date;
}

export async function closeElapsedPlacements(
  deps: CloseElapsedPlacementsDeps,
): Promise<{ closed: number }> {
  const { db, logger } = deps;
  const now = deps.now ?? (() => new Date());
  const today = now().toISOString().slice(0, 10);

  logger.info({ job: 'close-elapsed-placements' }, 'job start');

  const closed = await withTransaction(db, async (tx) => {
    const rows = await tx<
      { id: string; candidate_id: string; requisition_id: string }[]
    >`
      update placements
         set status = 'completed', updated_at = now()
       where status = 'active'
         and guarantee_end_date is not null
         and guarantee_end_date <= ${today}::date
      returning id, candidate_id, requisition_id
    `;

    // Every state change writes an event (CLAUDE.md rule 6). The actor is
    // null: this is the scheduler, not a person.
    for (const row of rows) {
      await emitEvent(tx, {
        entityType: 'candidate',
        entityId: row.candidate_id,
        eventType: 'placement_guarantee_completed',
        actorId: null,
        actorRole: null,
        fromValue: 'active',
        toValue: 'completed',
        metadata: {
          placementId: row.id,
          requisitionId: row.requisition_id,
        },
      });
    }

    return rows.length;
  });

  logger.info(
    { job: 'close-elapsed-placements', affectedRows: closed },
    'job finish',
  );
  return { closed };
}
