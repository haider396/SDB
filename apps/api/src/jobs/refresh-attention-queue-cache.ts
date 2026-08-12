/**
 * refresh-attention-queue-cache — every 5 minutes (docs/06-BACKEND.md §5).
 *
 * Recomputes the seven needs-attention buckets (01 §6) into the
 * AttentionQueueService's in-process cache, which GET /admin/attention-queue
 * serves. Idempotent by construction — each run replaces the previous
 * snapshot. Logs start, finish, and per-bucket counts.
 */
import type { Logger } from '../lib/logger.js';
import type { AttentionQueueService } from '../services/attention-queue.service.js';

export interface RefreshAttentionQueueOptions {
  logger: Logger;
}

export async function refreshAttentionQueueCache(
  attentionQueue: AttentionQueueService,
  opts: RefreshAttentionQueueOptions,
): Promise<void> {
  const { logger } = opts;
  logger.info({ job: 'refresh-attention-queue-cache' }, 'job started');
  const snapshot = await attentionQueue.refresh();
  logger.info(
    {
      job: 'refresh-attention-queue-cache',
      computedAt: snapshot.computedAt,
      counts: Object.fromEntries(
        snapshot.buckets.map((bucket) => [bucket.key, bucket.count]),
      ),
    },
    'job finished',
  );
}
