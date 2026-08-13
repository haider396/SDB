/**
 * Candidate file handling (docs/04-API.md §8.1, docs/06-BACKEND.md §6).
 *
 * Flow:
 * 1. upload-url: validate MIME (NFR-5 → 415) and size (NFR-4 → 413), insert a
 *    pending candidate_files row, return a Supabase Storage signed upload URL.
 *    Bytes go browser → Storage directly, never through the API.
 * 2. confirm: verify the object exists and its stored size matches via the
 *    storage port, mark the row complete; a CV queues text extraction.
 * 3. download-url: 300-second signed URL. Admin needs candidate.view; a
 *    CLIENT caller is allowed only when the file is client-visible AND the
 *    candidate has a client-visible assignment to that client (AC-CA-06) —
 *    checked in SQL against client_visible_assignments.
 *
 * DELETE removes the storage object and the row — candidate_files is
 * operational data, not a soft-deleted business entity.
 */
import { randomUUID } from 'node:crypto';
import {
  DOWNLOAD_URL_TTL_SECONDS,
  MAX_FILE_SIZE_MB,
  isAcceptedUploadMimeType,
  type CandidateFile,
  type FileDownloadUrlResponse,
  type FileUploadUrlBody,
  type FileUploadUrlResponse,
  type UpdateCandidateFileBody,
} from '@sdb/contracts';
import { withTransaction, type Db, type Tx } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import type { SupabaseStoragePort } from '../lib/supabase-storage.js';
import * as filesRepo from '../repositories/candidate-files.repo.js';
import {
  clearCvPrimaryFile,
  findCandidateById,
  setCvPrimaryFileIfUnset,
} from '../repositories/candidates.repo.js';
import { resolvePublicId } from '../repositories/public-ids.repo.js';
import type { CandidateActor } from './candidates.service.js';
import { emitEvent } from './events.js';

export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

export interface CandidateFilesServiceDeps {
  db: Db;
  storage: SupabaseStoragePort;
}

export interface CandidateFilesService {
  createUploadUrl(
    candidateId: string,
    body: FileUploadUrlBody,
    actor: CandidateActor,
  ): Promise<FileUploadUrlResponse>;
  confirmUpload(
    candidateId: string,
    fileId: string,
    actor: CandidateActor,
  ): Promise<CandidateFile>;
  list(candidateId: string, actor: CandidateActor): Promise<CandidateFile[]>;
  update(
    candidateId: string,
    fileId: string,
    body: UpdateCandidateFileBody,
    actor: CandidateActor,
  ): Promise<CandidateFile>;
  remove(candidateId: string, fileId: string, actor: CandidateActor): Promise<void>;
  /** `GET /files/:fileId/download-url` — admin or authorized client caller. */
  createDownloadUrl(
    fileId: string,
    actor: CandidateActor,
  ): Promise<FileDownloadUrlResponse>;
}

/** Keep original filenames readable in storage paths without unsafe chars. */
function sanitizeFilename(filename: string): string {
  const cleaned = filename.replaceAll(/[^A-Za-z0-9._-]+/g, '_');
  return cleaned.length > 0 && cleaned !== '.' && cleaned !== '..'
    ? cleaned.slice(0, 140)
    : 'file';
}

export function createCandidateFilesService(
  deps: CandidateFilesServiceDeps,
): CandidateFilesService {
  const { db, storage } = deps;

  function assertAdminSurface(actor: CandidateActor): void {
    if (actor.ownClientId !== null) {
      throw new ApiError('NOT_FOUND', 'Resource not found.');
    }
  }

  /**
   * Map a uuid-or-public-id candidate reference (0015) to the internal uuid.
   * Identity for uuids (no existence check — parity with the previous
   * behaviour); 404 for an unknown public_id.
   */
  async function resolveCandidateRef(ref: string): Promise<string> {
    const candidateId = await resolvePublicId(db, 'candidates', ref);
    if (candidateId === null) {
      throw new ApiError('NOT_FOUND', 'Candidate not found.');
    }
    return candidateId;
  }

  async function requireCandidate(sql: Db | Tx, candidateId: string): Promise<void> {
    const candidate = await findCandidateById(sql, candidateId);
    if (candidate === null) {
      throw new ApiError('NOT_FOUND', 'Candidate not found.');
    }
  }

  async function requireFile(
    sql: Db | Tx,
    candidateId: string,
    fileId: string,
  ): Promise<CandidateFile> {
    const file = await filesRepo.findFileById(sql, fileId);
    if (file === null || file.candidateId !== candidateId) {
      throw new ApiError('NOT_FOUND', 'File not found.');
    }
    return file;
  }

  return {
    async createUploadUrl(candidateId, body, actor) {
      assertAdminSurface(actor);
      if (!isAcceptedUploadMimeType(body.mimeType)) {
        throw new ApiError(
          'UNSUPPORTED_MEDIA_TYPE',
          `MIME type ${body.mimeType} is not accepted (NFR-5).`,
          { mimeType: body.mimeType },
        );
      }
      if (body.sizeBytes > MAX_FILE_SIZE_BYTES) {
        throw new ApiError(
          'FILE_TOO_LARGE',
          `Files may not exceed ${MAX_FILE_SIZE_MB} MB (NFR-4).`,
          { sizeBytes: body.sizeBytes, maxBytes: MAX_FILE_SIZE_BYTES },
        );
      }
      candidateId = await resolveCandidateRef(candidateId);
      await requireCandidate(db, candidateId);

      const fileId = randomUUID();
      const storagePath = `candidates/${candidateId}/${fileId}/${sanitizeFilename(body.originalFilename)}`;
      // Row first, then the signed URL: a URL that was never persisted is
      // harmless, an orphaned URL row is visible and re-issuable.
      const file = await withTransaction(db, async (tx) => {
        const inserted = await filesRepo.insertFile(tx, {
          id: fileId,
          candidateId,
          fileType: body.fileType,
          storagePath,
          originalFilename: body.originalFilename,
          mimeType: body.mimeType,
          sizeBytes: body.sizeBytes,
          status: 'pending',
          uploadedBy: actor.userId,
        });
        await emitEvent(tx, {
          entityType: 'candidate',
          entityId: candidateId,
          eventType: 'file_upload_requested',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: { fileId, fileType: body.fileType, sizeBytes: body.sizeBytes },
        });
        return inserted;
      });

      const signed = await storage.createSignedUploadUrl(storagePath);
      return {
        fileId: file.id,
        uploadUrl: signed.url,
        token: signed.token,
        storagePath,
      };
    },

    async confirmUpload(candidateId, fileId, actor) {
      assertAdminSurface(actor);
      candidateId = await resolveCandidateRef(candidateId);
      const file = await requireFile(db, candidateId, fileId);
      if (file.virusScanStatus !== 'pending') {
        // Confirming twice is idempotent — return the completed row.
        return file;
      }
      const stat = await storage.statObject(file.storagePath);
      if (stat === null) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'The file has not been uploaded yet.',
          { fileId },
        );
      }
      if (stat.sizeBytes !== file.sizeBytes) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'The uploaded size does not match the declared size.',
          { declared: file.sizeBytes, actual: stat.sizeBytes },
        );
      }
      return withTransaction(db, async (tx) => {
        await filesRepo.markFileComplete(tx, fileId);
        await emitEvent(tx, {
          entityType: 'candidate',
          entityId: candidateId,
          eventType: 'file_uploaded',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: { fileId, fileType: file.fileType },
        });
        if (file.fileType === 'cv') {
          const becamePrimary = await setCvPrimaryFileIfUnset(
            tx,
            candidateId,
            fileId,
          );
          // Queue text extraction (06 §5/§6): the extract-cv-text job picks up
          // every cv file with a queued event and no extracted/failed event.
          await emitEvent(tx, {
            entityType: 'candidate',
            entityId: candidateId,
            eventType: 'cv_text_extraction_queued',
            actorId: actor.userId,
            actorRole: actor.role,
            metadata: { fileId, becamePrimary },
          });
        }
        const confirmed = await filesRepo.findFileById(tx, fileId);
        if (confirmed === null) throw new ApiError('NOT_FOUND', 'File not found.');
        return confirmed;
      });
    },

    async list(candidateId, actor) {
      assertAdminSurface(actor);
      candidateId = await resolveCandidateRef(candidateId);
      await requireCandidate(db, candidateId);
      return filesRepo.listFiles(db, candidateId);
    },

    async update(candidateId, fileId, body, actor) {
      assertAdminSurface(actor);
      candidateId = await resolveCandidateRef(candidateId);
      return withTransaction(db, async (tx) => {
        const file = await requireFile(tx, candidateId, fileId);
        await filesRepo.updateFile(tx, fileId, {
          ...(body.isClientVisible !== undefined
            ? { isClientVisible: body.isClientVisible }
            : {}),
          ...(body.fileType !== undefined ? { fileType: body.fileType } : {}),
        });
        await emitEvent(tx, {
          entityType: 'candidate',
          entityId: candidateId,
          eventType: 'file_updated',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: {
            fileId,
            ...(body.isClientVisible !== undefined
              ? { isClientVisible: body.isClientVisible }
              : {}),
            ...(body.fileType !== undefined
              ? { fileType: { from: file.fileType, to: body.fileType } }
              : {}),
          },
        });
        const updated = await filesRepo.findFileById(tx, fileId);
        if (updated === null) throw new ApiError('NOT_FOUND', 'File not found.');
        return updated;
      });
    },

    async remove(candidateId, fileId, actor) {
      assertAdminSurface(actor);
      candidateId = await resolveCandidateRef(candidateId);
      const file = await requireFile(db, candidateId, fileId);
      // Storage object first: if this fails the row survives and the delete
      // can be retried; the reverse would orphan the object forever.
      await storage.removeObject(file.storagePath);
      await withTransaction(db, async (tx) => {
        await clearCvPrimaryFile(tx, candidateId, fileId);
        await filesRepo.deleteFileRow(tx, fileId);
        await emitEvent(tx, {
          entityType: 'candidate',
          entityId: candidateId,
          eventType: 'file_deleted',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: { fileId, fileType: file.fileType, storagePath: file.storagePath },
        });
      });
    },

    async createDownloadUrl(fileId, actor) {
      const file = await filesRepo.findFileById(db, fileId);
      if (actor.ownClientId !== null) {
        // Client caller (AC-CA-06): only client-visible files of candidates
        // with a client-visible assignment to THEIR client. Both refusals are
        // a 404 — existence is never leaked.
        const allowed =
          file !== null &&
          (await filesRepo.clientMayDownloadFile(db, fileId, actor.ownClientId));
        if (!allowed) {
          throw new ApiError('NOT_FOUND', 'File not found.');
        }
      } else if (file === null) {
        throw new ApiError('NOT_FOUND', 'File not found.');
      }
      if (file === null || file.virusScanStatus === 'pending') {
        throw new ApiError('NOT_FOUND', 'File not found.');
      }
      const url = await storage.createSignedDownloadUrl(
        file.storagePath,
        DOWNLOAD_URL_TTL_SECONDS,
      );
      return { url, expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS };
    },
  };
}
