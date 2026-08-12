/**
 * flag-incomplete-candidates (docs/06-BACKEND.md §5): daily 03:00 UTC,
 * recompute `candidates.data_completeness` against the required-field set
 * (services/data-completeness.ts). Directly callable for tests. Idempotent —
 * a second run finds nothing to change. Every flip writes an events row
 * (CLAUDE.md rule 6).
 */
import { withTransaction, type Db } from '../lib/db.js';
import { COMPLETENESS_SQL_PREDICATE } from '../services/data-completeness.js';
import { emitEvent } from '../services/events.js';

export interface FlagIncompleteLogger {
  info(obj: Record<string, unknown>, msg: string): void;
}

export interface FlagIncompleteOptions {
  logger?: FlagIncompleteLogger;
}

interface FlippedRow {
  id: string;
  data_completeness: 'complete' | 'incomplete';
  previous: 'complete' | 'incomplete';
}

/** Returns the number of candidates whose completeness changed. */
export async function flagIncompleteCandidates(
  db: Db,
  options: FlagIncompleteOptions = {},
): Promise<number> {
  options.logger?.info({ job: 'flag-incomplete-candidates' }, 'job start');

  const flipped = await withTransaction(db, async (tx) => {
    // COMPLETENESS_SQL_PREDICATE is built from a static column list — safe
    // for sql.unsafe; no request data is involved.
    const computed = `case when ${COMPLETENESS_SQL_PREDICATE}
      then 'complete'::data_completeness else 'incomplete'::data_completeness end`;
    const rows = await tx<FlippedRow[]>`
      update candidates
      set data_completeness = ${tx.unsafe(computed)}
      where archived_at is null
        and data_completeness is distinct from ${tx.unsafe(computed)}
      returning id, data_completeness,
        (case when data_completeness = 'complete'::data_completeness
          then 'incomplete' else 'complete' end) as previous
    `;
    for (const row of rows) {
      await emitEvent(tx, {
        entityType: 'candidate',
        entityId: row.id,
        eventType: 'data_completeness_changed',
        actorId: null,
        actorRole: null,
        fromValue: row.previous,
        toValue: row.data_completeness,
        metadata: { job: 'flag-incomplete-candidates' },
      });
    }
    return rows;
  });

  options.logger?.info(
    { job: 'flag-incomplete-candidates', affectedRows: flipped.length },
    'job finish',
  );
  return flipped.length;
}
