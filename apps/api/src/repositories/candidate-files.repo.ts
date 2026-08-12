/**
 * SQL for candidate_files and webhook_ingest_log (docs/02-DATABASE.md §8.2 /
 * §10, docs/04-API.md §8.1–8.2). No business logic.
 *
 * `virus_scan_status` doubles as the row lifecycle in MVP (06 §6): 'pending'
 * until the upload is confirmed, then 'complete'. Virus scanning itself is
 * out of scope; the column exists so it can be added without a migration.
 */
import type { CandidateFile } from '@sdb/contracts';
import type postgres from 'postgres';
import type { Queryable } from '../lib/db.js';

interface FileRow {
  id: string;
  candidate_id: string;
  file_type: CandidateFile['fileType'];
  storage_path: string;
  original_filename: string;
  mime_type: string;
  size_bytes: string;
  is_client_visible: boolean;
  virus_scan_status: string;
  uploaded_by: string | null;
  uploaded_at: Date;
}

function mapFile(row: FileRow): CandidateFile {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    fileType: row.file_type,
    storagePath: row.storage_path,
    originalFilename: row.original_filename,
    mimeType: row.mime_type,
    // bigint arrives as string from postgres.js.
    sizeBytes: Number(row.size_bytes),
    isClientVisible: row.is_client_visible,
    virusScanStatus: row.virus_scan_status,
    uploadedBy: row.uploaded_by,
    uploadedAt: row.uploaded_at.toISOString(),
  };
}

const FILE_COLUMNS = `
  id, candidate_id, file_type, storage_path, original_filename, mime_type,
  size_bytes::text as size_bytes, is_client_visible, virus_scan_status,
  uploaded_by, uploaded_at
`;

export async function insertFile(
  sql: Queryable,
  input: {
    id: string;
    candidateId: string;
    fileType: string;
    storagePath: string;
    originalFilename: string;
    mimeType: string;
    sizeBytes: number;
    isClientVisible?: boolean;
    /** 'pending' (upload-url flow) or 'complete' (server-side webhook store). */
    status: 'pending' | 'complete';
    uploadedBy: string | null;
  },
): Promise<CandidateFile> {
  const rows = await sql<FileRow[]>`
    insert into candidate_files
      (id, candidate_id, file_type, storage_path, original_filename,
       mime_type, size_bytes, is_client_visible, virus_scan_status, uploaded_by)
    values (${input.id}, ${input.candidateId}, ${input.fileType},
            ${input.storagePath}, ${input.originalFilename}, ${input.mimeType},
            ${input.sizeBytes}, ${input.isClientVisible ?? false},
            ${input.status}, ${input.uploadedBy})
    returning ${sql.unsafe(FILE_COLUMNS)}
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('file insert returned no row');
  return mapFile(row);
}

export async function findFileById(
  sql: Queryable,
  fileId: string,
): Promise<CandidateFile | null> {
  const rows = await sql<FileRow[]>`
    select ${sql.unsafe(FILE_COLUMNS)}
    from candidate_files
    where id = ${fileId}
  `;
  const row = rows[0];
  return row === undefined ? null : mapFile(row);
}

export async function listFiles(
  sql: Queryable,
  candidateId: string,
): Promise<CandidateFile[]> {
  const rows = await sql<FileRow[]>`
    select ${sql.unsafe(FILE_COLUMNS)}
    from candidate_files
    where candidate_id = ${candidateId}
    order by uploaded_at desc
  `;
  return rows.map(mapFile);
}

/** Confirm an upload: pending → complete. Returns false if not pending. */
export async function markFileComplete(
  sql: Queryable,
  fileId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update candidate_files
    set virus_scan_status = 'complete'
    where id = ${fileId}
      and virus_scan_status = 'pending'
    returning id
  `;
  return rows.length > 0;
}

export async function updateFile(
  sql: Queryable,
  fileId: string,
  patch: { isClientVisible?: boolean; fileType?: string },
): Promise<boolean> {
  const assignments: Record<string, unknown> = {};
  if (patch.isClientVisible !== undefined) {
    assignments['is_client_visible'] = patch.isClientVisible;
  }
  if (patch.fileType !== undefined) assignments['file_type'] = patch.fileType;
  if (Object.keys(assignments).length === 0) return true;
  const rows = await sql<{ id: string }[]>`
    update candidate_files set ${sql(assignments)}
    where id = ${fileId}
    returning id
  `;
  return rows.length > 0;
}

export async function deleteFileRow(
  sql: Queryable,
  fileId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    delete from candidate_files where id = ${fileId} returning id
  `;
  return rows.length > 0;
}

/**
 * Client download authorization (04 §8.1, AC-CA-06): the file must be
 * client-visible AND the candidate must have a client-visible assignment to
 * the caller's client — checked against the `client_visible_assignments`
 * view, which is the single visibility gate (02 §11).
 */
export async function clientMayDownloadFile(
  sql: Queryable,
  fileId: string,
  clientId: string,
): Promise<boolean> {
  const rows = await sql<{ ok: number }[]>`
    select 1 as ok
    from candidate_files f
    where f.id = ${fileId}
      and f.is_client_visible = true
      and exists (
        select 1 from client_visible_assignments cva
        where cva.candidate_id = f.candidate_id
          and cva.client_id = ${clientId}
      )
    limit 1
  `;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// webhook_ingest_log (02 §10)
// ---------------------------------------------------------------------------

export interface IngestLogInput {
  source: string;
  externalId: string | null;
  /**
   * The payload as received. When an Idempotency-Key header is present it is
   * recorded inside the stored payload under `__idempotencyKey` (documented
   * pollution — the table has no dedicated column and migrations 0001–0014
   * are frozen).
   */
  rawPayload: unknown;
  idempotencyKey: string | null;
  result: 'created' | 'updated' | 'rejected';
  candidateId: string | null;
  errorDetail: string | null;
}

export async function insertIngestLog(
  sql: Queryable,
  input: IngestLogInput,
): Promise<string> {
  const stored =
    input.idempotencyKey === null
      ? input.rawPayload
      : {
          ...(typeof input.rawPayload === 'object' && input.rawPayload !== null
            ? (input.rawPayload as Record<string, unknown>)
            : { __payload: input.rawPayload }),
          __idempotencyKey: input.idempotencyKey,
        };
  const rows = await sql<{ id: string }[]>`
    insert into webhook_ingest_log
      (source, external_id, raw_payload, result, candidate_id, error_detail)
    values (${input.source}, ${input.externalId},
            ${sql.json(stored as postgres.JSONValue)},
            ${input.result}, ${input.candidateId}, ${input.errorDetail})
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('ingest log insert returned no row');
  return row.id;
}

export interface PriorIngest {
  result: string;
  candidateId: string | null;
}

/** Latest successful ingest recorded under this Idempotency-Key, if any. */
export async function findIngestByIdempotencyKey(
  sql: Queryable,
  key: string,
): Promise<PriorIngest | null> {
  const rows = await sql<{ result: string; candidate_id: string | null }[]>`
    select result, candidate_id
    from webhook_ingest_log
    where raw_payload ->> '__idempotencyKey' = ${key}
      and result in ('created', 'updated')
    order by received_at desc
    limit 1
  `;
  const row = rows[0];
  return row === undefined
    ? null
    : { result: row.result, candidateId: row.candidate_id };
}
