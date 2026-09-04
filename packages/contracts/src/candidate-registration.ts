/**
 * Public candidate registration (docs/CHANGE-REQUESTS-2026-08-13.md T38).
 *
 * The form payload deliberately reuses the intake form shapes
 * (IntakeFormCategory / IntakeFormQuestion) rather than defining parallel
 * types: it is the SAME question engine serving a second audience, so the
 * renderer, the conditional evaluator, and the schema builder are all shared.
 * Only the submission body and its response differ, because a registration
 * creates a candidate rather than a client + requisition.
 */
import { z } from 'zod';
import { IntakeAnswerSchema, IntakeFormCategorySchema } from './intake.js';

/**
 * `GET /api/v1/candidate-registration-form` — public, unauthenticated.
 *
 * No `roleCategoryId` scope: unlike the client intake form, a registering
 * candidate is not applying to one role, so every active candidate-audience
 * question is returned. Role scoping stays available on the question record
 * for later use but is not applied here.
 */
export const CandidateRegistrationFormResponseSchema = z.object({
  formVersionHash: z.string(),
  generatedAt: z.string().datetime({ offset: true }),
  categories: z.array(IntakeFormCategorySchema),
});
export type CandidateRegistrationFormResponse = z.infer<
  typeof CandidateRegistrationFormResponseSchema
>;

/**
 * One recorded typing-test attempt. Rebecca (20:16–20:41): unlimited retakes,
 * and the stored figure is the AVERAGE across attempts, explicitly not the
 * best — "you could be sunk very fast, and then the next moment you are just
 * tired". Attempts are submitted individually so the average stays
 * recomputable server-side; the client never sends a pre-averaged number it
 * could get wrong or game.
 */
export const TypingAttemptSchema = z.object({
  wpm: z.number().int().min(0).max(400),
  accuracy: z.number().min(0).max(100),
  durationSeconds: z.number().int().positive().max(600),
});
export type TypingAttempt = z.infer<typeof TypingAttemptSchema>;

/** A file already uploaded against the registration session. */
export const RegistrationFileRefSchema = z.object({
  fileId: z.string().uuid(),
  fileType: z.enum(['cv', 'photo', 'work_sample', 'assessment_report', 'other']),
});
export type RegistrationFileRef = z.infer<typeof RegistrationFileRefSchema>;

/**
 * Body of `POST /api/v1/candidate-registrations`.
 *
 * `sessionId` ties the submission to any files uploaded mid-flow — a public
 * registrant has no candidate row until this call succeeds, so uploads are
 * staged against the session and attached here.
 *
 * `consentToShareProfile` is captured explicitly rather than inferred from a
 * question answer: without it the candidate can never be presented to a client
 * (422 CONSENT_MISSING, AC-PL-05), so it is too load-bearing to leave as
 * configurable form content.
 */
export const CandidateRegistrationSchema = z.object({
  sessionId: z.string().uuid(),
  formVersionHash: z.string(),
  answers: z.array(IntakeAnswerSchema).min(1),
  typingAttempts: z.array(TypingAttemptSchema).max(50).default([]),
  files: z.array(RegistrationFileRefSchema).max(10).default([]),
  consentToShareProfile: z.boolean(),
});
export type CandidateRegistration = z.infer<typeof CandidateRegistrationSchema>;

/**
 * `201` response. Mirrors the intake form's discipline (AC-IF-14): an
 * unauthenticated caller gets no internal identifiers back — no candidate id,
 * no reference. Only enough to render a confirmation.
 */
export const CandidateRegistrationResponseSchema = z.object({
  received: z.literal(true),
});
export type CandidateRegistrationResponse = z.infer<
  typeof CandidateRegistrationResponseSchema
>;

/** `POST /api/v1/candidate-registrations/session` — starts a session. */
export const RegistrationSessionResponseSchema = z.object({
  sessionId: z.string().uuid(),
  expiresAt: z.string().datetime({ offset: true }),
});
export type RegistrationSessionResponse = z.infer<
  typeof RegistrationSessionResponseSchema
>;

/**
 * `POST /api/v1/candidate-registrations/:sessionId/upload-url`.
 *
 * Same signed-upload dance as the admin path (06-BACKEND §6): the API
 * validates type and size, then hands back a short-lived signed URL so the
 * bytes never traverse the API. The bucket stays private throughout.
 */
export const RegistrationUploadUrlBodySchema = z.object({
  fileType: RegistrationFileRefSchema.shape.fileType,
  originalFilename: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(255),
  sizeBytes: z.number().int().positive(),
});
export type RegistrationUploadUrlBody = z.infer<
  typeof RegistrationUploadUrlBodySchema
>;

/** Mirrors FileUploadUrlResponse so the browser upload helper is shared. */
export const RegistrationUploadUrlResponseSchema = z.object({
  fileId: z.string().uuid(),
  /** Supabase Storage signed upload URL — browser PUTs the bytes directly. */
  uploadUrl: z.string(),
  /** Upload token paired with the signed URL (supabase-js uploadToSignedUrl). */
  token: z.string(),
  storagePath: z.string(),
});
export type RegistrationUploadUrlResponse = z.infer<
  typeof RegistrationUploadUrlResponseSchema
>;

/**
 * Candidate-side question keys that map onto first-class `candidates` columns
 * as well as being stored as answers — the candidate equivalent of
 * MAPPED_QUESTION_KEYS (03 §3.4).
 *
 * The mapping is one-directional: the answer row remains the record of what
 * was asked, the column is a derived projection the system reasons about
 * (search, filters, the client-visible view). Deactivating a mapped question
 * simply stops populating its column; no code path breaks.
 *
 * These keys cannot be renamed or deleted — the seed MUST use them exactly.
 */
export const CANDIDATE_MAPPED_QUESTION_KEYS = [
  'first_name',
  'last_name',
  'preferred_name',
  'email',
  'phone',
  'whatsapp',
  'linkedin_url',
  'country',
  'region_state',
  'city',
  'timezone',
  'english_spoken_level',
  'english_written_level',
  'years_experience_total',
  'current_title',
  'current_employer',
  'available_from',
  'hours_available_per_week',
  'typing_wpm',
] as const;

export type CandidateMappedQuestionKey =
  (typeof CANDIDATE_MAPPED_QUESTION_KEYS)[number];

export function isCandidateMappedQuestionKey(
  key: string,
): key is CandidateMappedQuestionKey {
  return (CANDIDATE_MAPPED_QUESTION_KEYS as readonly string[]).includes(key);
}
