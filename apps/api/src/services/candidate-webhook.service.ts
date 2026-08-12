/**
 * Inbound sourcing webhook (docs/04-API.md §8.2, behaviours 1–8).
 *
 * Design decisions, in spec order:
 * 1. Upsert on externalId — re-posting updates, never duplicates (AC-CA-08).
 * 2. LENIENT validation: only firstName/lastName are required (422 otherwise,
 *    AC-CA-10). Everything else best-effort; data_completeness is computed
 *    against services/data-completeness.ts (AC-CA-09).
 * 3. Unknown enum values are DROPPED (never coerced), listed in
 *    droppedFields, and recorded in webhook_ingest_log.error_detail
 *    (AC-CA-11). Wrong-typed optional fields are treated the same way.
 * 4. primaryRoleCategoryKey resolves via role_categories.key; unresolvable
 *    keys leave the column null and are flagged as dropped.
 * 5. cvUrl is fetched server-side with size/MIME caps and stored via the
 *    storage port as a complete 'cv' candidate_files row. Fetch failure NEVER
 *    fails the request — it is recorded in error_detail.
 * 6. Candidates land at pool_status 'active' with NO assignment; nothing in
 *    this module touches the assignments table (AC-CA-13).
 * 7. Every authenticated request writes exactly one webhook_ingest_log row,
 *    success or rejection (AC-CA-12). (Requests failing the bearer check are
 *    not logged: an unauthenticated payload is untrusted input.)
 * 8. Responds 200 { candidateReference, result, dataCompleteness, droppedFields }.
 *
 * Idempotency-Key (04 §1): when the header is present and a prior successful
 * ingest recorded the same key, the payload is NOT re-applied; the prior
 * outcome is replayed from the log/candidate row. The key is stored inside
 * the logged raw_payload under `__idempotencyKey` (the frozen 0009 table has
 * no dedicated column).
 *
 * Token check: constant-time comparison over SHA-256 digests — neither
 * content nor length of WEBHOOK_INBOUND_TOKEN leaks through timing.
 */
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import {
  AccentStrengthSchema,
  CandidateSourceSchema,
  LanguageLevelSchema,
  MAX_FILE_SIZE_MB,
  RateUnitSchema,
  type Candidate,
  type WebhookResponse,
} from '@sdb/contracts';
import { withTransaction, type Db, type Tx } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import type { SupabaseStoragePort } from '../lib/supabase-storage.js';
import {
  findIngestByIdempotencyKey,
  insertFile,
  insertIngestLog,
} from '../repositories/candidate-files.repo.js';
import {
  findCandidateByExternalId,
  findCandidateById,
  findRoleCategoryIdByKey,
  insertCandidate,
  setCvPrimaryFileIfUnset,
  updateCandidate,
} from '../repositories/candidates.repo.js';
import { computeDataCompleteness } from './data-completeness.js';
import { emitEvent } from './events.js';

// ---------------------------------------------------------------------------
// CV fetching (injectable so tests use a local server or canned fetcher)
// ---------------------------------------------------------------------------

export interface FetchedCv {
  bytes: Uint8Array;
  mimeType: string;
}

export type CvFetcher = (url: string) => Promise<FetchedCv>;

const CV_MIME_TYPES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
]);
const MAX_CV_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

/** Default fetcher: global fetch (undici) with size and MIME caps. */
export const defaultCvFetcher: CvFetcher = async (url) => {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    throw new Error(`cv fetch returned ${response.status}`);
  }
  const contentType = (response.headers.get('content-type') ?? '')
    .split(';')[0]!
    .trim()
    .toLowerCase();
  if (!CV_MIME_TYPES.has(contentType)) {
    throw new Error(`cv fetch returned unsupported content-type ${contentType}`);
  }
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > MAX_CV_BYTES) {
    throw new Error(`cv exceeds the ${MAX_FILE_SIZE_MB}MB cap`);
  }
  return { bytes: buffer, mimeType: contentType };
};

// ---------------------------------------------------------------------------
// Lenient field extraction
// ---------------------------------------------------------------------------

interface Extracted {
  fields: Record<string, unknown>;
  dropped: string[];
}

/**
 * Best-effort extraction: a field parseable by its schema is kept; a present
 * but invalid field is dropped and flagged; an absent field is simply absent.
 */
function extractLenient(payload: Record<string, unknown>): Extracted {
  const fields: Record<string, unknown> = {};
  const dropped: string[] = [];

  const take = (key: string, schema: z.ZodTypeAny): void => {
    const value = payload[key];
    if (value === undefined || value === null) return;
    const parsed = schema.safeParse(value);
    if (parsed.success) {
      fields[key] = parsed.data;
    } else {
      dropped.push(key);
    }
  };

  take('sourceDetail', z.string().max(500));
  take('email', z.string().email().max(320));
  take('phone', z.string().max(50));
  take('country', z.string().max(100));
  take('regionState', z.string().max(200));
  take('englishSpokenLevel', LanguageLevelSchema);
  take('accentStrength', AccentStrengthSchema);
  take('yearsExperienceTotal', z.number().min(0).max(80));
  take('expectedRateAmount', z.number().nonnegative());
  take('expectedRateUnit', RateUnitSchema);
  return { fields, dropped };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface WebhookIngestDeps {
  db: Db;
  storage: SupabaseStoragePort;
  webhookToken: string;
  cvFetcher?: CvFetcher;
  logger?: {
    warn(obj: Record<string, unknown>, msg: string): void;
  };
}

export interface CandidateWebhookService {
  /** Throws 401 UNAUTHENTICATED unless the bearer token matches (AC-CA-07). */
  verifyToken(authorizationHeader: string | undefined): void;
  /** Full ingest per 04 §8.2. Always writes one webhook_ingest_log row. */
  ingest(
    rawBody: unknown,
    idempotencyKey: string | null,
  ): Promise<WebhookResponse>;
}

const WEBHOOK_SOURCE_FALLBACK = 'webhook';

export function createCandidateWebhookService(
  deps: WebhookIngestDeps,
): CandidateWebhookService {
  const { db, storage, webhookToken } = deps;
  const cvFetcher = deps.cvFetcher ?? defaultCvFetcher;
  const expectedDigest = createHash('sha256').update(webhookToken).digest();

  function verifyToken(header: string | undefined): void {
    const presented =
      header !== undefined && header.startsWith('Bearer ')
        ? header.slice('Bearer '.length)
        : null;
    if (presented === null) {
      throw new ApiError('UNAUTHENTICATED', 'Missing or invalid webhook token.');
    }
    const presentedDigest = createHash('sha256').update(presented).digest();
    if (!timingSafeEqual(presentedDigest, expectedDigest)) {
      throw new ApiError('UNAUTHENTICATED', 'Missing or invalid webhook token.');
    }
  }

  async function storeCv(
    tx: Tx,
    candidate: Candidate,
    cvUrl: string,
  ): Promise<string | null> {
    let fetched: FetchedCv;
    try {
      fetched = await cvFetcher(cvUrl);
    } catch (error) {
      // Behaviour 5: fetch failure does not fail the request.
      deps.logger?.warn(
        { candidateId: candidate.id, cvUrl, err: String(error) },
        'webhook cv fetch failed; candidate stored without cv',
      );
      return `cv fetch failed: ${String(error)}`;
    }
    const fileId = randomUUID();
    const extension =
      fetched.mimeType === 'application/pdf' ? 'cv.pdf' : 'cv.docx';
    const storagePath = `candidates/${candidate.id}/${fileId}/${extension}`;
    await storage.uploadObject(storagePath, fetched.bytes, fetched.mimeType);
    await insertFile(tx, {
      id: fileId,
      candidateId: candidate.id,
      fileType: 'cv',
      storagePath,
      originalFilename: extension,
      mimeType: fetched.mimeType,
      sizeBytes: fetched.bytes.byteLength,
      status: 'complete',
      uploadedBy: null,
    });
    await setCvPrimaryFileIfUnset(tx, candidate.id, fileId);
    await emitEvent(tx, {
      entityType: 'candidate',
      entityId: candidate.id,
      eventType: 'cv_text_extraction_queued',
      actorId: null,
      actorRole: null,
      metadata: { fileId, via: 'webhook' },
    });
    return null;
  }

  async function replayIdempotent(
    key: string,
  ): Promise<WebhookResponse | null> {
    const prior = await findIngestByIdempotencyKey(db, key);
    if (prior === null || prior.candidateId === null) return null;
    const candidate = await findCandidateById(db, prior.candidateId, {
      includeArchived: true,
    });
    if (candidate === null) return null;
    await insertIngestLog(db, {
      source: candidate.source,
      externalId: candidate.externalId,
      rawPayload: { replayOf: key },
      idempotencyKey: key,
      result: prior.result === 'created' ? 'created' : 'updated',
      candidateId: candidate.id,
      errorDetail: 'idempotent replay; payload not re-applied',
    });
    return {
      candidateReference: candidate.reference,
      result: prior.result === 'created' ? 'created' : 'updated',
      dataCompleteness: candidate.dataCompleteness,
      droppedFields: [],
    };
  }

  return {
    verifyToken,

    async ingest(rawBody, idempotencyKey) {
      const payload =
        typeof rawBody === 'object' && rawBody !== null && !Array.isArray(rawBody)
          ? (rawBody as Record<string, unknown>)
          : {};

      const sourceRaw = payload['source'];
      const sourceForLog =
        typeof sourceRaw === 'string' && sourceRaw.length > 0
          ? sourceRaw
          : WEBHOOK_SOURCE_FALLBACK;
      const externalId =
        typeof payload['externalId'] === 'string' && payload['externalId'] !== ''
          ? payload['externalId']
          : null;

      // Idempotency-Key honoured (04 §1): a replay never re-applies.
      if (idempotencyKey !== null) {
        const replayed = await replayIdempotent(idempotencyKey);
        if (replayed !== null) return replayed;
      }

      // Strict minimum: firstName + lastName (behaviour 2, AC-CA-10).
      const firstName = payload['firstName'];
      const lastName = payload['lastName'];
      if (
        typeof firstName !== 'string' ||
        firstName.trim() === '' ||
        typeof lastName !== 'string' ||
        lastName.trim() === ''
      ) {
        // Behaviour 7: the rejection is logged too (outside any tx — there is
        // no candidate write to be atomic with).
        await insertIngestLog(db, {
          source: sourceForLog,
          externalId,
          rawPayload: payload,
          idempotencyKey,
          result: 'rejected',
          candidateId: null,
          errorDetail: 'firstName and lastName are required',
        });
        throw new ApiError(
          'VALIDATION_FAILED',
          'firstName and lastName are required.',
          { missing: ['firstName', 'lastName'].filter((key) => {
            const value = payload[key];
            return typeof value !== 'string' || value.trim() === '';
          }) },
        );
      }

      // Lenient extraction (behaviours 2–3).
      const { fields, dropped } = extractLenient(payload);

      // Source enum: unknown values drop to the 'webhook' source (flagged).
      const sourceParsed = CandidateSourceSchema.safeParse(sourceRaw);
      const source = sourceParsed.success ? sourceParsed.data : 'webhook';
      if (sourceRaw !== undefined && sourceRaw !== null && !sourceParsed.success) {
        dropped.push('source');
      }

      // Behaviour 4: resolve primaryRoleCategoryKey; unresolvable → null + flag.
      const roleKeyRaw = payload['primaryRoleCategoryKey'];
      let primaryRoleCategoryId: string | null = null;
      if (typeof roleKeyRaw === 'string' && roleKeyRaw !== '') {
        primaryRoleCategoryId = await findRoleCategoryIdByKey(db, roleKeyRaw);
        if (primaryRoleCategoryId === null) dropped.push('primaryRoleCategoryKey');
      } else if (roleKeyRaw !== undefined && roleKeyRaw !== null) {
        dropped.push('primaryRoleCategoryKey');
      }

      const cvUrl =
        typeof payload['cvUrl'] === 'string' && payload['cvUrl'] !== ''
          ? payload['cvUrl']
          : null;

      const candidateFields: Record<string, unknown> = {
        ...fields,
        ...(primaryRoleCategoryId !== null ? { primaryRoleCategoryId } : {}),
      };

      const completeness = computeDataCompleteness({
        email: candidateFields['email'] ?? null,
        phone: candidateFields['phone'] ?? null,
        country: candidateFields['country'] ?? null,
        englishSpokenLevel: candidateFields['englishSpokenLevel'] ?? null,
        yearsExperienceTotal: candidateFields['yearsExperienceTotal'] ?? null,
        expectedRateAmount: candidateFields['expectedRateAmount'] ?? null,
        expectedRateUnit: candidateFields['expectedRateUnit'] ?? null,
        primaryRoleCategoryId,
      });

      const errorDetailParts: string[] = [];
      if (dropped.length > 0) {
        errorDetailParts.push(`dropped fields: ${dropped.join(', ')}`);
      }

      const outcome = await withTransaction(db, async (tx) => {
        // Behaviour 1: upsert on externalId (AC-CA-08).
        const existing =
          externalId === null
            ? null
            : await findCandidateByExternalId(tx, externalId);

        let candidate: Candidate;
        let result: 'created' | 'updated';
        if (existing === null) {
          candidate = await insertCandidate(tx, {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            source,
            submittedVia: 'webhook',
            dataCompleteness: completeness,
            externalId,
            fields: candidateFields,
          });
          result = 'created';
          await emitEvent(tx, {
            entityType: 'candidate',
            entityId: candidate.id,
            eventType: 'candidate_created',
            actorId: null,
            actorRole: null,
            toValue: candidate.reference,
            metadata: { submittedVia: 'webhook', source, externalId },
          });
        } else {
          await updateCandidate(tx, existing.id, {
            firstName: firstName.trim(),
            lastName: lastName.trim(),
            source,
            ...candidateFields,
            dataCompleteness: completeness,
          });
          result = 'updated';
          await emitEvent(tx, {
            entityType: 'candidate',
            entityId: existing.id,
            eventType: 'candidate_updated',
            actorId: null,
            actorRole: null,
            metadata: {
              submittedVia: 'webhook',
              externalId,
              changedKeys: Object.keys(candidateFields),
            },
          });
          const refreshed = await findCandidateById(tx, existing.id, {
            includeArchived: true,
          });
          if (refreshed === null) throw new Error('candidate vanished mid-upsert');
          candidate = refreshed;
        }

        // Behaviour 5: server-side CV fetch; failure is recorded, not fatal.
        if (cvUrl !== null) {
          const cvError = await storeCv(tx, candidate, cvUrl);
          if (cvError !== null) errorDetailParts.push(cvError);
        }

        // Behaviour 7: exactly one log row, inside the same transaction.
        await insertIngestLog(tx, {
          source: sourceForLog,
          externalId,
          rawPayload: payload,
          idempotencyKey,
          result,
          candidateId: candidate.id,
          errorDetail:
            errorDetailParts.length > 0 ? errorDetailParts.join('; ') : null,
        });

        return { candidate, result };
      });

      // Behaviour 6 (AC-CA-13): nothing above touches assignments; candidates
      // land in the pool ('active' default) and are presented only by humans.
      return {
        candidateReference: outcome.candidate.reference,
        result: outcome.result,
        dataCompleteness: outcome.candidate.dataCompleteness,
        droppedFields: dropped,
      };
    },
  };
}
