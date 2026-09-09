/**
 * Accepting a submission from a built form's public link.
 *
 * Reuses the existing engine wholesale: `validateSubmission` and
 * `buildSnapshot` are imported from intake-submission.service, so this is a
 * third PROJECTION, not a third pipeline. The six-step 422 contract
 * (duplicate → unknown → required-missing → type-mismatch → rules →
 * invalid-option → condition-not-met) is unchanged.
 *
 * ── The identity rule (Haider, 4 Sep) ───────────────────────────────────────
 * A candidate is identified by EMAIL. They may submit each form once, but may
 * submit different forms — applying for Video Editor and for Developer is ONE
 * person with TWO applications.
 *
 *   - one-per-form is enforced by uq_submission_per_form_per_candidate, so a
 *     repeat raises 23505 rather than being checked-then-inserted (which races)
 *   - attaching to an existing candidate uses projectCandidatePatch, NOT
 *     projectCandidate — see the comment on that function; the difference is
 *     the whole reason a second application does not wipe the first's data
 */
import type { CandidateFormSubmission, IntakeAnswer } from '@sdb/contracts';
import type { Db } from '../lib/db.js';
import { withTransaction } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import {
  attachRegistrationFiles,
  getRegistrationSession,
  insertCandidateAnswer,
  insertCandidateAnswerOptions,
  markSessionSubmitted,
} from '../repositories/candidate-registration.repo.js';
import {
  findLiveCandidateByEmail,
  insertCandidate,
  lockCandidateEmail,
  setCandidateConsent,
  updateCandidate,
} from '../repositories/candidates.repo.js';
import {
  insertSubmission,
  setPrimaryRoleCategoryIfUnset,
} from '../repositories/candidate-forms.repo.js';
import {
  buildSnapshot,
  validateSubmission,
} from './intake-submission.service.js';
import {
  averageWpm,
  projectCandidatePatch,
} from './candidate-registration.service.js';
import type { CandidateFormPublicService } from './candidate-form-public.service.js';
import { emitEvent } from './events.js';

export interface SubmissionLogger {
  info(obj: Record<string, unknown>, msg: string): void;
}

export interface CandidateFormSubmissionServiceDeps {
  db: Db;
  publicFormService: CandidateFormPublicService;
  logger?: SubmissionLogger;
  now?: () => Date;
}

export interface CandidateFormSubmissionService {
  /** `slug === null` submits to the seeded default form (/register). */
  submit(
    slug: string | null,
    body: CandidateFormSubmission,
    meta: { ipHash: string | null },
  ): Promise<{ received: true }>;
}

const UNIQUE_VIOLATION = '23505';

/** One submission per form per candidate. */
const SUBMISSION_CONSTRAINT = 'uq_submission_per_form_per_candidate';

/**
 * One LIVE candidate per email address (0024).
 *
 * Reaching this means two submissions for the same address raced past
 * lockCandidateEmail — which the advisory lock is there to prevent, so it
 * should be unreachable. It is mapped anyway: if the lock is ever removed or
 * bypassed, the candidate gets a truthful message instead of a 500, and the
 * distinct code makes the cause obvious in the logs.
 */
const CANDIDATE_EMAIL_INDEX = 'idx_candidates_email_live';

export function createCandidateFormSubmissionService(
  deps: CandidateFormSubmissionServiceDeps,
): CandidateFormSubmissionService {
  const now = deps.now ?? (() => new Date());

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
    if (session.expiresAt.getTime() <= now().getTime()) {
      throw new ApiError('VALIDATION_FAILED', 'This registration session has expired.');
    }
    return session;
  }

  return {
    async submit(slug, body, meta) {
      const session = await assertOpenSession(body.sessionId);

      // The scope comes from the SAME intersection the public payload used, so
      // the two can never disagree about what the form asks (AC-IF-02).
      const resolved = await deps.publicFormService.resolveScope(slug);

      if (
        body.formVersionId !== undefined &&
        body.formVersionId !== resolved.versionId
      ) {
        // The form was republished between load and submit. Accepted, because
        // it is not the candidate's fault — but the answers are validated
        // against what is live NOW, which is the safe side to err on.
        deps.logger?.info(
          { submitted: body.formVersionId, current: resolved.versionId },
          'candidate form version changed mid-fill (accepted)',
        );
      }

      // Per-form steps: reject rather than silently drop, so a client bug
      // surfaces immediately instead of losing a candidate's CV quietly.
      if (!resolved.form.hasTypingTest && body.typingAttempts.length > 0) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'This form does not include the typing test.',
          { fields: { typingAttempts: 'Not part of this form.' } },
        );
      }
      if (!resolved.form.hasDocumentsStep && body.files.length > 0) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'This form does not accept documents.',
          { fields: { files: 'Not part of this form.' } },
        );
      }

      const prepared = validateSubmission(
        resolved.scope,
        body.answers as IntakeAnswer[],
      );
      const patch = projectCandidatePatch(prepared);

      const email = patch.email ?? null;
      if (email === null) {
        // Activation refuses a form with no email question, so reaching here
        // means the question was deactivated after the form went live.
        throw new ApiError('VALIDATION_FAILED', 'An email address is required.', {
          fields: { email: 'This answer is required.' },
        });
      }

      const capturedAt = now().toISOString();
      const typingAverage = averageWpm(body.typingAttempts);

      try {
        await withTransaction(deps.db, async (tx) => {
          // Serialise concurrent submissions for this address BEFORE looking
          // up, so two simultaneous submissions cannot both create.
          await lockCandidateEmail(tx, email);
          const existing = await findLiveCandidateByEmail(tx, email);

          let candidateId: string;
          if (existing === null) {
            if (patch.firstName === undefined || patch.firstName === null) {
              throw new ApiError('VALIDATION_FAILED', 'A first name is required.', {
                fields: { first_name: 'This answer is required.' },
              });
            }
            if (patch.lastName === undefined || patch.lastName === null) {
              throw new ApiError('VALIDATION_FAILED', 'A last name is required.', {
                fields: { last_name: 'This answer is required.' },
              });
            }
            const { firstName, lastName, ...rest } = patch;
            const created = await insertCandidate(tx, {
              firstName,
              lastName,
              source: 'inbound',
              submittedVia: 'self_registration',
              dataCompleteness: 'incomplete',
              fields: {
                ...rest,
                poolStatus: 'passive',
                vettingStatus: 'not_started',
                typingWpmAverage: typingAverage,
                typingTestAttempts: body.typingAttempts.length,
              },
            });
            candidateId = created.id;
          } else {
            candidateId = existing.id;
            // NEWEST WINS, but only for what THIS form asked. `patch` is built
            // by presence, so unanswered columns are absent and untouched.
            const { ...fields } = patch;
            await updateCandidate(tx, candidateId, fields);
            // Typing figures move only when this form actually ran the test —
            // otherwise a form without it would zero a real measurement.
            if (resolved.form.hasTypingTest && body.typingAttempts.length > 0) {
              await updateCandidate(tx, candidateId, {
                typingWpmAverage: typingAverage,
                typingTestAttempts: body.typingAttempts.length,
              });
            }
          }

          // 23505 here is the one-submission-per-form rule.
          const submission = await insertSubmission(tx, {
            formId: resolved.form.id,
            formVersionId: resolved.versionId,
            candidateId,
            roleCategoryId: resolved.form.roleCategoryId,
            sessionId: session.id,
            source: 'public_form',
            formVersionHash: body.formVersionHash,
            isCreatedCandidate: existing === null,
            answerCount: prepared.length,
            ipHash: meta.ipHash,
          });

          for (const answer of prepared) {
            const answerId = await insertCandidateAnswer(tx, {
              candidateId,
              submissionId: submission.id,
              questionId: answer.question.id,
              questionKey: answer.question.key,
              valueText: answer.valueText,
              valueNumber: answer.valueNumber,
              valueBoolean: answer.valueBoolean,
              valueDate: answer.valueDate,
              valueJson: answer.valueJson,
              questionSnapshot: buildSnapshot(answer.question, capturedAt, answer.valueJson),
            });
            if (answer.optionIds.length > 0) {
              await insertCandidateAnswerOptions(tx, answerId, answer.optionIds);
            }
          }

          // Role tagging. Only set when unset: overwriting on every
          // application would destroy the recruiter's classification, and the
          // submission list already answers "which roles did they apply for".
          if (resolved.form.roleCategoryId !== null) {
            await setPrimaryRoleCategoryIfUnset(
              tx,
              candidateId,
              resolved.form.roleCategoryId,
            );
          }

          // Consent goes through its dedicated setter, never a fields patch:
          // consent columns are excluded from FIELD_TO_COLUMN and unknown keys
          // are dropped SILENTLY, so a fields patch would look right and do
          // nothing — and without consent a candidate can never be presented.
          if (body.consentToShareProfile) {
            await setCandidateConsent(tx, candidateId, {
              hasConsentToShareProfile: true,
              consentSource: `candidate_form:${resolved.form.key}`,
            });
          }

          if (resolved.form.hasDocumentsStep && body.files.length > 0) {
            await attachRegistrationFiles(tx, {
              candidateId,
              sessionId: session.id,
              files: body.files,
            });
          }

          await markSessionSubmitted(tx, session.id, candidateId);

          await emitEvent(tx, {
            entityType: 'candidate',
            entityId: candidateId,
            eventType:
              existing === null
                ? 'candidate_self_registered'
                : 'candidate_form_resubmitted',
            actorId: null,
            actorRole: null,
            metadata: {
              formId: resolved.form.id,
              formKey: resolved.form.key,
              formVersionId: resolved.versionId,
              submissionId: submission.id,
              roleCategoryId: resolved.form.roleCategoryId,
              answerCount: prepared.length,
              attachedToExisting: existing !== null,
            },
          });
        });
      } catch (error) {
        // Discriminate by CONSTRAINT, not just by SQLSTATE: since 0024 there
        // are two unique rules this transaction can break, and they mean very
        // different things to the person filling in the form.
        const pg = error as { code?: string; constraint_name?: string };
        if (pg.code === UNIQUE_VIOLATION) {
          if (pg.constraint_name === CANDIDATE_EMAIL_INDEX) {
            // VALIDATION_FAILED anchored on email, not DUPLICATE_SUBMISSION:
            // this is not "you already applied", and unlike that message it
            // does belong to a specific field, so the 422 field mapper renders
            // it in the right place.
            throw new ApiError(
              'VALIDATION_FAILED',
              'Another application using this email address is being processed. Please submit again.',
              { fields: { email: 'Please submit again.' } },
            );
          }
          if (
            pg.constraint_name === SUBMISSION_CONSTRAINT ||
            pg.constraint_name === undefined
          ) {
            throw new ApiError(
              'DUPLICATE_SUBMISSION',
              'You have already applied using this form.',
            );
          }
        }
        throw error;
      }

      // No ids returned — a public caller learns nothing about our records.
      return { received: true };
    },
  };
}
