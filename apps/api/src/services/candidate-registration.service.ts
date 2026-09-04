/**
 * Public candidate registration (docs/CHANGE-REQUESTS-2026-08-13.md T38).
 *
 * Deliberately reuses the intake pipeline rather than duplicating it:
 * `validateSubmission` and `buildSnapshot` from intake-submission.service are
 * the SAME six-step validation and the SAME snapshot rules (03 §3.3, §1.4).
 * Only the projection target differs — a registration writes a `candidate`
 * where an intake writes a client + requisition.
 *
 * Everything happens in ONE transaction (06-BACKEND §2.1): candidate +
 * N answers + N answer options + file attachments + event. A failed
 * registration leaves no rows behind (the AC-IF-13 discipline, applied here).
 */
import { randomUUID } from 'node:crypto';
import type {
  CandidateRegistration,
  IntakeAnswer,
  QuestionType,
  RegistrationUploadUrlBody,
  RegistrationUploadUrlResponse,
} from '@sdb/contracts';
import {
  MAX_FILE_SIZE_MB,
  isAcceptedUploadMimeType,
  isCandidateMappedQuestionKey,
} from '@sdb/contracts';
import { withTransaction, type Db } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import type { SupabaseStoragePort } from '../lib/supabase-storage.js';
import type { FormQuestionRecord } from '../repositories/intake.repo.js';
import { getActiveFormQuestions } from '../repositories/intake.repo.js';
import {
  attachRegistrationFiles,
  confirmRegistrationFile,
  countStagedFiles,
  createRegistrationSession,
  findRegistrationFile,
  getRegistrationSession,
  insertCandidateAnswer,
  insertCandidateAnswerOptions,
  markSessionSubmitted,
  stageRegistrationFile,
} from '../repositories/candidate-registration.repo.js';
import {
  insertCandidate,
  setCandidateConsent,
} from '../repositories/candidates.repo.js';
import {
  buildSnapshot,
  validateSubmission,
  type PreparedAnswer,
} from './intake-submission.service.js';
import { emitEvent } from './events.js';
import type { CandidateRegistrationFormService } from './candidate-registration-form.service.js';

export interface RegistrationLogger {
  info(obj: Record<string, unknown>, msg: string): void;
}

export interface CandidateRegistrationServiceDeps {
  db: Db;
  formService: CandidateRegistrationFormService;
  storage: SupabaseStoragePort;
  logger?: RegistrationLogger;
  now?: () => Date;
}

export interface CandidateRegistrationService {
  startSession(meta: {
    ipHash: string | null;
    userAgent: string | null;
  }): Promise<{ sessionId: string; expiresAt: string }>;
  createUploadUrl(
    sessionId: string,
    body: RegistrationUploadUrlBody,
  ): Promise<RegistrationUploadUrlResponse>;
  confirmUpload(sessionId: string, fileId: string): Promise<{ confirmed: true }>;
  submit(body: CandidateRegistration): Promise<{ received: true }>;
}

/**
 * Ceiling on staged uploads per session.
 *
 * CandidateRegistrationSchema.files is .max(10), but that caps PROMOTION at
 * submit time, not upload: without this guard one session can mint unlimited
 * signed URLs and write unlimited objects, bounded only by the 60 req/min/IP
 * limiter. Keep the two numbers in step.
 */
const MAX_REGISTRATION_FILES = 10;

/** Keep original filenames readable in storage paths without unsafe chars. */
function sanitizeFilename(filename: string): string {
  const cleaned = filename.replaceAll(/[^A-Za-z0-9._-]+/g, '_');
  return cleaned.length > 0 && cleaned !== '.' && cleaned !== '..'
    ? cleaned.slice(0, 140)
    : 'file';
}

/**
 * Answers that project onto first-class `candidates` columns
 * (CANDIDATE_MAPPED_QUESTION_KEYS). One-directional: the answer row stays the
 * record of what was asked; the column is the queryable projection.
 *
 * Unmapped answers are still stored — they are simply not promoted to a
 * column, which is what makes the question set freely configurable.
 */
interface CandidateProjection {
  firstName: string | null;
  lastName: string | null;
  preferredName: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  linkedinUrl: string | null;
  country: string | null;
  regionState: string | null;
  city: string | null;
  timezone: string | null;
  englishSpokenLevel: string | null;
  englishWrittenLevel: string | null;
  yearsExperienceTotal: number | null;
  currentTitle: string | null;
  currentEmployer: string | null;
  availableFrom: string | null;
  hoursAvailablePerWeek: number | null;
  typingWpm: number | null;
}

const EMPTY_PROJECTION: CandidateProjection = {
  firstName: null,
  lastName: null,
  preferredName: null,
  email: null,
  phone: null,
  whatsapp: null,
  linkedinUrl: null,
  country: null,
  regionState: null,
  city: null,
  timezone: null,
  englishSpokenLevel: null,
  englishWrittenLevel: null,
  yearsExperienceTotal: null,
  currentTitle: null,
  currentEmployer: null,
  availableFrom: null,
  hoursAvailablePerWeek: null,
  typingWpm: null,
};

/** Scalar value of a prepared answer, whichever typed column it populated. */
function scalarOf(answer: PreparedAnswer): string | number | boolean | null {
  if (answer.valueText !== null) return answer.valueText;
  if (answer.valueNumber !== null) return answer.valueNumber;
  if (answer.valueBoolean !== null) return answer.valueBoolean;
  if (answer.valueDate !== null) return answer.valueDate;
  return null;
}

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function asNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function projectCandidate(prepared: PreparedAnswer[]): CandidateProjection {
  const projection: CandidateProjection = { ...EMPTY_PROJECTION };
  for (const answer of prepared) {
    const key = answer.question.key;
    if (!isCandidateMappedQuestionKey(key)) continue;
    const value = scalarOf(answer);
    switch (key) {
      case 'first_name': projection.firstName = asString(value); break;
      case 'last_name': projection.lastName = asString(value); break;
      case 'preferred_name': projection.preferredName = asString(value); break;
      case 'email': projection.email = asString(value)?.toLowerCase() ?? null; break;
      case 'phone': projection.phone = asString(value); break;
      case 'whatsapp': projection.whatsapp = asString(value); break;
      case 'linkedin_url': projection.linkedinUrl = asString(value); break;
      case 'country': projection.country = asString(value); break;
      case 'region_state': projection.regionState = asString(value); break;
      case 'city': projection.city = asString(value); break;
      case 'timezone': projection.timezone = asString(value); break;
      case 'english_spoken_level': projection.englishSpokenLevel = asString(value); break;
      case 'english_written_level': projection.englishWrittenLevel = asString(value); break;
      case 'years_experience_total': projection.yearsExperienceTotal = asNumber(value); break;
      case 'current_title': projection.currentTitle = asString(value); break;
      case 'current_employer': projection.currentEmployer = asString(value); break;
      case 'available_from': projection.availableFrom = asString(value); break;
      case 'hours_available_per_week': projection.hoursAvailablePerWeek = asNumber(value); break;
      case 'typing_wpm': projection.typingWpm = asNumber(value); break;
    }
  }
  return projection;
}

/**
 * The SAME projection, but built BY PRESENCE — only keys this submission
 * actually answered.
 *
 * ⚠ This exists to prevent silent data loss, and the difference from
 * projectCandidate is not cosmetic. projectCandidate spreads EMPTY_PROJECTION,
 * so every mapped key is present with `null` where unanswered. On the CREATE
 * path that is correct: a new candidate genuinely has no value.
 *
 * On the ATTACH path it is destructive. `toColumnAssignments` skips
 * `undefined` but NOT `null`, so feeding the full projection to
 * updateCandidate would write null over every mapped column the second form
 * did not ask about — applying for Developer would wipe the typing speed
 * captured by the Video Editor form.
 *
 * Building by presence means an unanswered key is simply absent, so
 * toColumnAssignments skips it: newest wins for what was asked, and nothing
 * else moves.
 *
 * Columns that are NOT mapped question keys — vetting_status, pool_status,
 * data_completeness, source, submitted_via, consent — cannot appear here by
 * construction, which is what keeps a re-application from resetting a vetted
 * candidate.
 */
export function projectCandidatePatch(
  prepared: PreparedAnswer[],
): Partial<CandidateProjection> {
  const patch: Partial<CandidateProjection> = {};
  for (const answer of prepared) {
    const key = answer.question.key;
    if (!isCandidateMappedQuestionKey(key)) continue;
    const value = scalarOf(answer);
    switch (key) {
      case 'first_name': patch.firstName = asString(value); break;
      case 'last_name': patch.lastName = asString(value); break;
      case 'preferred_name': patch.preferredName = asString(value); break;
      case 'email': patch.email = asString(value)?.toLowerCase() ?? null; break;
      case 'phone': patch.phone = asString(value); break;
      case 'whatsapp': patch.whatsapp = asString(value); break;
      case 'linkedin_url': patch.linkedinUrl = asString(value); break;
      case 'country': patch.country = asString(value); break;
      case 'region_state': patch.regionState = asString(value); break;
      case 'city': patch.city = asString(value); break;
      case 'timezone': patch.timezone = asString(value); break;
      case 'english_spoken_level': patch.englishSpokenLevel = asString(value); break;
      case 'english_written_level': patch.englishWrittenLevel = asString(value); break;
      case 'years_experience_total': patch.yearsExperienceTotal = asNumber(value); break;
      case 'current_title': patch.currentTitle = asString(value); break;
      case 'current_employer': patch.currentEmployer = asString(value); break;
      case 'available_from': patch.availableFrom = asString(value); break;
      case 'hours_available_per_week': patch.hoursAvailablePerWeek = asNumber(value); break;
      case 'typing_wpm': patch.typingWpm = asNumber(value); break;
    }
  }
  return patch;
}

/**
 * Average WPM across attempts, rounded. Rebecca was explicit (20:41):
 * "Let's do average" — never the best score. Computed server-side from the
 * raw attempts so the figure cannot be inflated by the client.
 */
export function averageWpm(attempts: { wpm: number }[]): number | null {
  if (attempts.length === 0) return null;
  const total = attempts.reduce((sum, attempt) => sum + attempt.wpm, 0);
  return Math.round(total / attempts.length);
}

export function createCandidateRegistrationService(
  deps: CandidateRegistrationServiceDeps,
): CandidateRegistrationService {
  const now = deps.now ?? (() => new Date());

  /**
   * A session is the only authorisation an anonymous registrant has, so every
   * session-scoped call resolves it the same way: it must exist, be unspent,
   * and be unexpired.
   */
  async function assertOpenSession(sessionId: string) {
    const session = await getRegistrationSession(deps.db, sessionId);
    if (session === null) {
      throw new ApiError('NOT_FOUND', 'Registration session not found.');
    }
    if (session.submittedAt !== null) {
      throw new ApiError(
        'VALIDATION_FAILED',
        'This registration has already been submitted.',
      );
    }
    if (session.expiresAt.getTime() < now().getTime()) {
      throw new ApiError(
        'VALIDATION_FAILED',
        'This registration session has expired. Please start again.',
      );
    }
    return session;
  }

  return {
    async startSession(meta) {
      const session = await createRegistrationSession(deps.db, meta);
      return {
        sessionId: session.id,
        expiresAt: session.expiresAt.toISOString(),
      };
    },

    /**
     * Signed upload URL for a file attached mid-registration.
     *
     * Same validation as the admin path (06-BACKEND §6): MIME against NFR-5
     * (415) and size against NFR-4 (413), a private bucket, and a short-lived
     * signed URL so the bytes go browser → Storage without touching the API.
     *
     * The difference from the admin path is that the caller is anonymous, so
     * the session is the authorisation object: an unknown, expired, or
     * already-submitted session gets nothing. Abuse beyond that is bounded by
     * the global 60 req/min/IP limiter. See D8 in the change-request doc —
     * virus scanning is still a stub here, exactly as it is for admins.
     */
    async createUploadUrl(sessionId, body) {
      const session = await assertOpenSession(sessionId);

      if (!isAcceptedUploadMimeType(body.mimeType)) {
        throw new ApiError(
          'UNSUPPORTED_MEDIA_TYPE',
          `MIME type ${body.mimeType} is not accepted (NFR-5).`,
        );
      }
      if (body.sizeBytes > MAX_FILE_SIZE_MB * 1024 * 1024) {
        throw new ApiError(
          'FILE_TOO_LARGE',
          `Files must be ${MAX_FILE_SIZE_MB}MB or smaller (NFR-4).`,
        );
      }
      const stagedCount = await countStagedFiles(deps.db, session.id);
      if (stagedCount >= MAX_REGISTRATION_FILES) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `This registration already has the maximum of ${MAX_REGISTRATION_FILES} files.`,
        );
      }

      const objectId = randomUUID();
      const path = `registrations/${session.id}/${objectId}-${sanitizeFilename(
        body.originalFilename,
      )}`;
      const signed = await deps.storage.createSignedUploadUrl(path);
      const staged = await stageRegistrationFile(deps.db, {
        sessionId: session.id,
        fileType: body.fileType,
        storagePath: path,
        originalFilename: body.originalFilename,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
      });

      return {
        fileId: staged.id,
        uploadUrl: signed.url,
        token: signed.token,
        storagePath: path,
      };
    },

    /**
     * Confirm a staged upload — and VERIFY it, exactly as the admin path does
     * (candidate-files.service.ts). This used to stamp confirmed_at
     * unconditionally, so any caller holding an open session could mark a
     * never-uploaded file confirmed; attachRegistrationFiles would then promote
     * a candidate_files row pointing at an object that does not exist, and
     * every consumer downstream (extract-cv-text, signed download,
     * cv_primary_file_id) would fail on a phantom file.
     *
     * Deliberately NOT re-checking MIME here: Storage reports the uploader's
     * own Content-Type, which is attacker-controlled and proves nothing. MIME
     * is validated in createUploadUrl against NFR-5, the only place it can
     * mean anything. Real content sniffing belongs with virus scanning (D8).
     */
    async confirmUpload(sessionId, fileId) {
      await assertOpenSession(sessionId);

      const file = await findRegistrationFile(deps.db, sessionId, fileId);
      if (file === null) {
        throw new ApiError('NOT_FOUND', 'Upload not found for this session.');
      }
      // Confirming twice is idempotent, matching the admin path.
      if (file.confirmedAt !== null) {
        return { confirmed: true };
      }

      const stat = await deps.storage.statObject(file.storagePath);
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

      const confirmed = await confirmRegistrationFile(deps.db, sessionId, fileId);
      if (!confirmed) {
        throw new ApiError('NOT_FOUND', 'Upload not found for this session.');
      }
      return { confirmed: true };
    },

    async submit(body) {
      await assertOpenSession(body.sessionId);

      // Same six-step pipeline as the client intake form (03 §3.3), pointed at
      // the candidate library. Unknown / out-of-scope / type-mismatched /
      // rule-violating / bad-option / hidden-conditional answers all reject
      // here with the documented 422 codes.
      const scope = await getActiveFormQuestions(deps.db, null, 'candidate');
      const prepared = validateSubmission(scope, body.answers as IntakeAnswer[]);
      const projection = projectCandidate(prepared);

      if (projection.firstName === null || projection.lastName === null) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'First name and last name are required.',
          {
            // `fields` — NOT `fieldErrors`. The web error mapper
            // (features/intake-form/error-map.ts) reads details.fields, so any
            // other key silently produces an error banner with no per-field
            // messages and nothing anchored to an input.
            fields: {
              ...(projection.firstName === null
                ? { first_name: 'This answer is required.' }
                : {}),
              ...(projection.lastName === null
                ? { last_name: 'This answer is required.' }
                : {}),
            },
          },
        );
      }

      const currentForm = await deps.formService.getForm();
      if (currentForm.formVersionHash !== body.formVersionHash) {
        // Accepted but logged, matching the intake form's behaviour (03 §3.2
        // rule 7) — a stale hash means the question set changed mid-fill,
        // which is not the registrant's fault.
        deps.logger?.info(
          {
            submittedHash: body.formVersionHash,
            currentHash: currentForm.formVersionHash,
          },
          'candidate registration formVersionHash mismatch (accepted)',
        );
      }

      const capturedAt = now().toISOString();
      const typingAverage = averageWpm(body.typingAttempts);
      // Destructured out here: narrowing from the guard above does not survive
      // into the transaction callback.
      //
      // `typingWpm` deliberately stays in `rest` so it lands in the
      // pre-existing candidates.typing_wpm column (0007). The two are
      // different facts and both are worth keeping: typing_wpm is what the
      // candidate SAID, typing_wpm_average is what the test MEASURED. A
      // recruiter can see when a claim and a measurement disagree.
      const { firstName, lastName, ...rest } = projection;

      await withTransaction(deps.db, async (tx) => {
        const candidate = await insertCandidate(tx, {
          firstName,
          lastName,
          // 'inbound' already exists in candidate_source and is the correct
          // reading of someone who came to us (02 §2).
          source: 'inbound',
          submittedVia: 'self_registration',
          // The daily flag-incomplete job recomputes this properly; a fresh
          // self-registration is assumed partial until it does.
          dataCompleteness: 'incomplete',
          fields: {
            ...rest,
            // A self-registration is an unvetted inbound lead. It must never
            // be presentable to a client until a human reviews it — the
            // client-visibility gate is stage-based, but pool status keeps it
            // out of the default recruiter working set too.
            poolStatus: 'passive',
            vettingStatus: 'not_started',
            // Measured only — never back-filled from the self-reported figure.
            typingWpmAverage: typingAverage,
            typingTestAttempts: body.typingAttempts.length,
          },
        });

        // Consent goes through its dedicated setter, NOT the generic `fields`
        // patch: consent columns are deliberately absent from FIELD_TO_COLUMN
        // so they cannot be set by a blanket PATCH. toColumnAssignments drops
        // unknown keys silently, so routing consent through `fields` would
        // look correct and quietly do nothing — and without consent a
        // candidate can never be presented (422 CONSENT_MISSING, AC-PL-05).
        if (body.consentToShareProfile) {
          await setCandidateConsent(tx, candidate.id, {
            hasConsentToShareProfile: true,
            consentSource: 'self_registration_form',
          });
        }

        for (const answer of prepared) {
          const answerId = await insertCandidateAnswer(tx, {
            candidateId: candidate.id,
            questionId: answer.question.id,
            questionKey: answer.question.key,
            valueText: answer.valueText,
            valueNumber: answer.valueNumber,
            valueBoolean: answer.valueBoolean,
            valueDate: answer.valueDate,
            valueJson: answer.valueJson,
            questionSnapshot: buildSnapshot(answer.question, capturedAt),
          });
          if (answer.optionIds.length > 0) {
            await insertCandidateAnswerOptions(tx, answerId, answer.optionIds);
          }
        }

        if (body.files.length > 0) {
          await attachRegistrationFiles(tx, {
            candidateId: candidate.id,
            sessionId: body.sessionId,
            files: body.files,
          });
        }

        await markSessionSubmitted(tx, body.sessionId, candidate.id);

        await emitEvent(tx, {
          entityType: 'candidate',
          entityId: candidate.id,
          eventType: 'candidate_self_registered',
          actorId: null,
          actorRole: null,
          fromValue: null,
          toValue: 'sourced',
          metadata: {
            answerCount: prepared.length,
            fileCount: body.files.length,
            typingAttempts: body.typingAttempts.length,
            typingWpmAverage: typingAverage,
          },
        });
      });

      // AC-IF-14 discipline: an unauthenticated caller gets no internal ids.
      return { received: true };
    },
  };
}

/** Re-exported for the question-type map used by the web renderer tests. */
export type { QuestionType, FormQuestionRecord };
