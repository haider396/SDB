/**
 * extract-cv-text (docs/06-BACKEND.md §5): every 2 minutes, process CV files
 * pending text extraction into `candidates.cv_search`. Directly callable so
 * tests drive it without the scheduler (AC-CA-04).
 *
 * Queueing model — no schema change, events are the queue:
 * - Confirming a CV upload (or webhook CV ingestion) emits a
 *   `cv_text_extraction_queued` event carrying the fileId.
 * - This job processes every complete cv file whose latest queued event is
 *   newer than its latest `cv_text_extracted` / `cv_text_extraction_failed`
 *   event, then emits the outcome event. Idempotent by construction; a
 *   re-queue (e.g. after a name change rebuilt cv_search) re-extracts.
 *
 * cv_search append mechanism: migration 0010's trg_candidate_cv_search fires
 * only on INSERT or UPDATE OF first_name/last_name/preferred_name/
 * current_title/strengths — an UPDATE touching only cv_search does not fire
 * it. The job therefore writes cv_search as
 *   <trigger-built A/B/C parts, recomputed> || setweight(to_tsvector(cv text), 'D')
 * in one statement, so the write can never be clobbered by the trigger and
 * never drifts from the trigger's own weighting. When one of the trigger's
 * source columns later changes, the trigger rebuilds A/B/C without D — the
 * candidates service re-queues extraction in that case so this job restores
 * the CV text within its 2-minute cadence.
 */
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse/lib/pdf-parse.js';
import { withTransaction, type Db } from '../lib/db.js';
import type { SupabaseStoragePort } from '../lib/supabase-storage.js';
import { emitEvent } from '../services/events.js';

/** tsvector positions cap at 16383; cap input text well below tsvector limits. */
const MAX_EXTRACTED_CHARS = 300_000;

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export interface ExtractCvTextLogger {
  info(obj: Record<string, unknown>, msg: string): void;
  warn(obj: Record<string, unknown>, msg: string): void;
}

export interface ExtractCvTextOptions {
  logger?: ExtractCvTextLogger;
  /** Max files per run; the 2-minute cadence drains any backlog. */
  limit?: number;
}

interface PendingCvRow {
  id: string;
  candidate_id: string;
  storage_path: string;
  mime_type: string;
}

export async function extractTextFromCv(
  bytes: Uint8Array,
  mimeType: string,
): Promise<string> {
  if (mimeType === 'application/pdf') {
    // A dedicated zero-offset copy: pdf-parse forwards the value to pdf.js,
    // which misreads pooled Node Buffers (non-zero byteOffset) and fails with
    // 'bad XRef entry'. `new Uint8Array(bytes)` always copies to offset 0.
    const result = await pdfParse(
      new Uint8Array(bytes) as unknown as Buffer,
    );
    return result.text;
  }
  if (mimeType === DOCX_MIME) {
    const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
    return result.value;
  }
  throw new Error(`unsupported cv mime type: ${mimeType}`);
}

/** Returns the number of files whose text landed in cv_search. */
export async function extractCvText(
  db: Db,
  storage: SupabaseStoragePort,
  options: ExtractCvTextOptions = {},
): Promise<number> {
  const limit = options.limit ?? 20;
  options.logger?.info({ job: 'extract-cv-text' }, 'job start');

  const pending = await db<PendingCvRow[]>`
    select f.id, f.candidate_id, f.storage_path, f.mime_type
    from candidate_files f
    where f.file_type = 'cv'
      and f.virus_scan_status = 'complete'
      and (
        select max(e.occurred_at) from events e
        where e.entity_type = 'candidate'
          and e.entity_id = f.candidate_id
          and e.event_type = 'cv_text_extraction_queued'
          and e.metadata ->> 'fileId' = f.id::text
      ) > coalesce((
        select max(e.occurred_at) from events e
        where e.entity_type = 'candidate'
          and e.entity_id = f.candidate_id
          and e.event_type in ('cv_text_extracted', 'cv_text_extraction_failed')
          and e.metadata ->> 'fileId' = f.id::text
      ), '-infinity'::timestamptz)
    order by f.uploaded_at
    limit ${limit}
  `;

  let processed = 0;
  for (const file of pending) {
    try {
      const bytes = await storage.downloadObject(file.storage_path);
      const raw = await extractTextFromCv(bytes, file.mime_type);
      const text = raw.replaceAll(/\s+/g, ' ').trim().slice(0, MAX_EXTRACTED_CHARS);

      await withTransaction(db, async (tx) => {
        // Recompute the trigger's A/B/C parts and append the CV text as 'D'
        // in one UPDATE touching only cv_search (see module docblock).
        await tx`
          update candidates
          set cv_search =
              setweight(to_tsvector('english',
                coalesce(first_name, '') || ' ' ||
                coalesce(last_name, '')  || ' ' ||
                coalesce(preferred_name, '')), 'A')
            || setweight(to_tsvector('english', coalesce(current_title, '')), 'B')
            || setweight(to_tsvector('english', coalesce(strengths, '')), 'C')
            || setweight(to_tsvector('english', ${text}), 'D')
          where id = ${file.candidate_id}
        `;
        await emitEvent(tx, {
          entityType: 'candidate',
          entityId: file.candidate_id,
          eventType: 'cv_text_extracted',
          actorId: null,
          actorRole: null,
          metadata: { fileId: file.id, characters: text.length },
        });
      });
      processed += 1;
    } catch (error) {
      options.logger?.warn(
        { job: 'extract-cv-text', fileId: file.id, err: String(error) },
        'cv text extraction failed',
      );
      await withTransaction(db, async (tx) => {
        await emitEvent(tx, {
          entityType: 'candidate',
          entityId: file.candidate_id,
          eventType: 'cv_text_extraction_failed',
          actorId: null,
          actorRole: null,
          metadata: { fileId: file.id, error: String(error).slice(0, 500) },
        });
      });
    }
  }

  options.logger?.info(
    { job: 'extract-cv-text', pending: pending.length, affectedRows: processed },
    'job finish',
  );
  return processed;
}
