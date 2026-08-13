/**
 * Candidate contracts (docs/04-API.md §8, docs/02-DATABASE.md §8).
 *
 * - `CandidateSchema` mirrors the full internal `candidates` row in camelCase.
 *   It is an ADMIN-ONLY shape: client-facing candidate data is served through
 *   `client_visible_assignments` (P5), never through these schemas.
 * - `display_name` and `data_completeness` are server-owned: generated column
 *   and computed value respectively — absent from every write body.
 * - Consent is captured only via `POST /candidates/:id/consent`
 *   (`CandidateConsentBodySchema`), never via PATCH, so `consent_captured_at`
 *   always reflects a deliberate consent action.
 * - The webhook body (`WebhookCandidateBodySchema`) documents the 04 §8.2
 *   payload. Runtime validation of webhook payloads is deliberately LENIENT
 *   and lives in the API service — only firstName/lastName are enforced; other
 *   malformed fields are dropped, not rejected.
 */
import { z } from 'zod';
import {
  AccentStrengthSchema,
  AutonomyLevelSchema,
  CandidateFileTypeSchema,
  CandidateSourceSchema,
  DataCompletenessSchema,
  EmploymentStatusSchema,
  EngagementTypeSchema,
  LanguageLevelSchema,
  PoolStatusSchema,
  ProficiencyLevelSchema,
  RateUnitSchema,
  SeniorityLevelSchema,
  SubmissionChannelSchema,
  VettingStatusSchema,
  WorkspaceTypeSchema,
} from './enums.js';
import { PublicIdSchema } from './public-ids.js';

// ---------------------------------------------------------------------------
// Shared field fragments
// ---------------------------------------------------------------------------

const isoTimestamp = z.string().datetime({ offset: true });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
/** `time` columns (overlap_start/_end) — 'HH:MM' or 'HH:MM:SS'. */
const timeOfDay = z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/);
const rating = z.number().int().min(1).max(5);

/** 02 §8.1: sales_background_weight is text constrained by convention. */
export const SalesBackgroundWeightSchema = z.enum([
  'none',
  'light',
  'moderate',
  'heavy',
]);
export type SalesBackgroundWeight = z.infer<typeof SalesBackgroundWeightSchema>;

/**
 * `maxAccentStrength` filter ordering (04 §8): none < light < moderate < heavy.
 */
export const ACCENT_STRENGTH_ORDER = [
  'none',
  'light',
  'moderate',
  'heavy',
] as const;

// ---------------------------------------------------------------------------
// Candidate resource
// ---------------------------------------------------------------------------

export const CandidateSchema = z.object({
  id: z.string().uuid(),
  /** DB-generated 12-char base62 URL handle (0015). Never writable. */
  publicId: PublicIdSchema,
  reference: z.string(),
  externalId: z.string().nullable(),
  firstName: z.string(),
  lastName: z.string(),
  preferredName: z.string().nullable(),
  /** Generated: `<preferred or first> <last initial>.` — never writable. */
  displayName: z.string(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  whatsapp: z.string().nullable(),
  linkedinUrl: z.string().nullable(),
  portfolioUrl: z.string().nullable(),
  photoPath: z.string().nullable(),
  country: z.string().nullable(),
  regionState: z.string().nullable(),
  city: z.string().nullable(),
  timezone: z.string().nullable(),
  nationality: z.string().nullable(),
  relocationStatus: z.string().nullable(),

  // language & communication
  englishSpokenLevel: LanguageLevelSchema.nullable(),
  englishWrittenLevel: LanguageLevelSchema.nullable(),
  accentStrength: AccentStrengthSchema.nullable(),
  accentNotes: z.string().nullable(),
  languageAssessedBy: z.string().uuid().nullable(),
  languageAssessedAt: isoTimestamp.nullable(),

  // professional
  yearsExperienceTotal: z.number().nullable(),
  yearsExperienceRelevant: z.number().nullable(),
  currentTitle: z.string().nullable(),
  currentEmployer: z.string().nullable(),
  employmentStatus: EmploymentStatusSchema.nullable(),
  noticePeriodDays: z.number().int().nullable(),
  availableFrom: isoDate.nullable(),
  seniorityLevel: SeniorityLevelSchema.nullable(),
  engineId: z.string().uuid().nullable(),
  primaryRoleCategoryId: z.string().uuid().nullable(),
  secondarySpecialisationId: z.string().uuid().nullable(),
  hasManagementExperience: z.boolean().nullable(),
  teamSizeManaged: z.number().int().nullable(),
  hasClientFacingExperience: z.boolean().nullable(),
  hasUsClientExperience: z.boolean().nullable(),
  remoteExperienceYears: z.number().nullable(),

  // skills summary
  aiToolProficiency: ProficiencyLevelSchema.nullable(),
  typingWpm: z.number().int().nullable(),
  techLiteracyRating: rating.nullable(),

  // compensation
  expectedRateAmount: z.number().nullable(),
  expectedRateUnit: RateUnitSchema.nullable(),
  expectedRateCurrency: z.string().length(3).nullable(),
  rateMin: z.number().nullable(),
  rateMax: z.number().nullable(),
  isRateNegotiable: z.boolean().nullable(),
  currentRateAmount: z.number().nullable(),
  currentRateUnit: RateUnitSchema.nullable(),
  engagementTypes: z.array(EngagementTypeSchema).nullable(),
  hoursAvailablePerWeek: z.number().int().nullable(),
  overlapStart: timeOfDay.nullable(),
  overlapEnd: timeOfDay.nullable(),
  overlapTimezone: z.string().nullable(),
  maxConcurrentClients: z.number().int().nullable(),

  // remote environment
  internetDownMbps: z.number().nullable(),
  internetUpMbps: z.number().nullable(),
  hasBackupInternet: z.boolean().nullable(),
  hasBackupPower: z.boolean().nullable(),
  computerSpecs: z.string().nullable(),
  hasDualMonitor: z.boolean().nullable(),
  headsetQuality: z.string().nullable(),
  workspace: WorkspaceTypeSchema.nullable(),
  isQuietEnvironmentVerified: z.boolean().nullable(),

  // vetting & fit
  vettingStatus: VettingStatusSchema,
  vettedBy: z.string().uuid().nullable(),
  vettedAt: isoTimestamp.nullable(),
  screeningCallAt: isoTimestamp.nullable(),
  recruiterRating: rating.nullable(),
  recruiterRecommendation: z.string().nullable(),
  strengths: z.string().nullable(),
  watchPoints: z.string().nullable(),
  redFlags: z.string().nullable(),
  autonomy: AutonomyLevelSchema.nullable(),
  canManageUp: z.boolean().nullable(),
  proactivityRating: rating.nullable(),
  attentionToDetailRating: rating.nullable(),
  communicationRating: rating.nullable(),
  energyPresentationRating: rating.nullable(),
  salesBackgroundWeight: SalesBackgroundWeightSchema.nullable(),
  hasOpsBackground: z.boolean().nullable(),
  hasEntrepreneurialAmbition: z.boolean().nullable(),
  areReferencesChecked: z.boolean(),
  backgroundCheckStatus: z.string().nullable(),

  // source & provenance
  source: CandidateSourceSchema,
  sourceDetail: z.string().nullable(),
  sourcedBy: z.string().uuid().nullable(),
  submittedVia: SubmissionChannelSchema,
  externalSystem: z.string().nullable(),
  firstContactedAt: isoTimestamp.nullable(),
  responsivenessRating: rating.nullable(),
  lastActivityAt: isoTimestamp.nullable(),
  dataCompleteness: DataCompletenessSchema,

  // consent
  hasConsentToShareProfile: z.boolean(),
  consentCapturedAt: isoTimestamp.nullable(),
  consentSource: z.string().nullable(),
  retentionUntil: isoDate.nullable(),
  doNotPresentToClientIds: z.array(z.string().uuid()),

  poolStatus: PoolStatusSchema,
  cvPrimaryFileId: z.string().uuid().nullable(),
  createdAt: isoTimestamp,
  updatedAt: isoTimestamp,
  archivedAt: isoTimestamp.nullable(),
});
export type Candidate = z.infer<typeof CandidateSchema>;

// ---------------------------------------------------------------------------
// Child collections
// ---------------------------------------------------------------------------

export const CandidateLanguageSchema = z.object({
  id: z.string().uuid(),
  language: z.string(),
  spokenLevel: LanguageLevelSchema.nullable(),
  writtenLevel: LanguageLevelSchema.nullable(),
  isNative: z.boolean(),
});
export type CandidateLanguage = z.infer<typeof CandidateLanguageSchema>;

export const CreateCandidateLanguageBodySchema = z.object({
  language: z.string().min(1).max(100),
  spokenLevel: LanguageLevelSchema.nullable().optional(),
  writtenLevel: LanguageLevelSchema.nullable().optional(),
  isNative: z.boolean().optional(),
});
export type CreateCandidateLanguageBody = z.infer<
  typeof CreateCandidateLanguageBodySchema
>;

export const UpdateCandidateLanguageBodySchema =
  CreateCandidateLanguageBodySchema.partial().refine(
    (body) => Object.keys(body).length > 0,
    { message: 'At least one field must be provided' },
  );
export type UpdateCandidateLanguageBody = z.infer<
  typeof UpdateCandidateLanguageBodySchema
>;

export const CandidateToolSchema = z.object({
  toolId: z.string().uuid(),
  proficiency: ProficiencyLevelSchema,
  yearsUsed: z.number().nullable(),
  lastUsedYear: z.number().int().nullable(),
});
export type CandidateTool = z.infer<typeof CandidateToolSchema>;

/** `PUT /candidates/:id/tools` replaces the full set (04 §8). */
export const PutCandidateToolsBodySchema = z.object({
  tools: z.array(
    z.object({
      toolId: z.string().uuid(),
      proficiency: ProficiencyLevelSchema,
      yearsUsed: z.number().nonnegative().nullable().optional(),
      lastUsedYear: z.number().int().min(1970).max(2100).nullable().optional(),
    }),
  ),
});
export type PutCandidateToolsBody = z.infer<typeof PutCandidateToolsBodySchema>;

export const CandidateSkillSchema = z.object({
  skillId: z.string().uuid(),
  proficiency: ProficiencyLevelSchema,
  verifiedBy: z.string().uuid().nullable(),
  verifiedAt: isoTimestamp.nullable(),
});
export type CandidateSkill = z.infer<typeof CandidateSkillSchema>;

export const PutCandidateSkillsBodySchema = z.object({
  skills: z.array(
    z.object({
      skillId: z.string().uuid(),
      proficiency: ProficiencyLevelSchema,
    }),
  ),
});
export type PutCandidateSkillsBody = z.infer<typeof PutCandidateSkillsBodySchema>;

export const CandidateEmploymentSchema = z.object({
  id: z.string().uuid(),
  employer: z.string(),
  title: z.string(),
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  isCurrent: z.boolean(),
  responsibilities: z.string().nullable(),
  /** Internal only (02 §8.2) — never surfaces client-side. */
  reasonForLeaving: z.string().nullable(),
  sortOrder: z.number().int(),
});
export type CandidateEmployment = z.infer<typeof CandidateEmploymentSchema>;

export const CreateCandidateEmploymentBodySchema = z.object({
  employer: z.string().min(1).max(300),
  title: z.string().min(1).max(300),
  startDate: isoDate.nullable().optional(),
  endDate: isoDate.nullable().optional(),
  isCurrent: z.boolean().optional(),
  responsibilities: z.string().max(10_000).nullable().optional(),
  reasonForLeaving: z.string().max(5000).nullable().optional(),
  sortOrder: z.number().int().optional(),
});
export type CreateCandidateEmploymentBody = z.infer<
  typeof CreateCandidateEmploymentBodySchema
>;

export const UpdateCandidateEmploymentBodySchema =
  CreateCandidateEmploymentBodySchema.partial().refine(
    (body) => Object.keys(body).length > 0,
    { message: 'At least one field must be provided' },
  );
export type UpdateCandidateEmploymentBody = z.infer<
  typeof UpdateCandidateEmploymentBodySchema
>;

export const CandidateEducationSchema = z.object({
  id: z.string().uuid(),
  institution: z.string(),
  degree: z.string().nullable(),
  fieldOfStudy: z.string().nullable(),
  country: z.string().nullable(),
  startYear: z.number().int().nullable(),
  endYear: z.number().int().nullable(),
});
export type CandidateEducation = z.infer<typeof CandidateEducationSchema>;

export const CreateCandidateEducationBodySchema = z.object({
  institution: z.string().min(1).max(300),
  degree: z.string().max(300).nullable().optional(),
  fieldOfStudy: z.string().max(300).nullable().optional(),
  country: z.string().max(100).nullable().optional(),
  startYear: z.number().int().min(1900).max(2100).nullable().optional(),
  endYear: z.number().int().min(1900).max(2100).nullable().optional(),
});
export type CreateCandidateEducationBody = z.infer<
  typeof CreateCandidateEducationBodySchema
>;

export const UpdateCandidateEducationBodySchema =
  CreateCandidateEducationBodySchema.partial().refine(
    (body) => Object.keys(body).length > 0,
    { message: 'At least one field must be provided' },
  );
export type UpdateCandidateEducationBody = z.infer<
  typeof UpdateCandidateEducationBodySchema
>;

export const CandidateCertificationSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  issuer: z.string().nullable(),
  issuedDate: isoDate.nullable(),
  expiresDate: isoDate.nullable(),
  credentialUrl: z.string().nullable(),
});
export type CandidateCertification = z.infer<typeof CandidateCertificationSchema>;

export const CreateCandidateCertificationBodySchema = z.object({
  name: z.string().min(1).max(300),
  issuer: z.string().max(300).nullable().optional(),
  issuedDate: isoDate.nullable().optional(),
  expiresDate: isoDate.nullable().optional(),
  credentialUrl: z.string().url().max(2000).nullable().optional(),
});
export type CreateCandidateCertificationBody = z.infer<
  typeof CreateCandidateCertificationBodySchema
>;

export const UpdateCandidateCertificationBodySchema =
  CreateCandidateCertificationBodySchema.partial().refine(
    (body) => Object.keys(body).length > 0,
    { message: 'At least one field must be provided' },
  );
export type UpdateCandidateCertificationBody = z.infer<
  typeof UpdateCandidateCertificationBodySchema
>;

export const CandidateReferenceSchema = z.object({
  id: z.string().uuid(),
  refereeName: z.string(),
  relationship: z.string().nullable(),
  company: z.string().nullable(),
  contact: z.string().nullable(),
  checkedBy: z.string().uuid().nullable(),
  checkedAt: isoTimestamp.nullable(),
  outcome: z.string().nullable(),
  notes: z.string().nullable(),
});
export type CandidateReference = z.infer<typeof CandidateReferenceSchema>;

/**
 * `checkedBy`/`checkedAt` are server-set: recorded from the acting user the
 * first time an `outcome` is stored.
 */
export const CreateCandidateReferenceBodySchema = z.object({
  refereeName: z.string().min(1).max(300),
  relationship: z.string().max(300).nullable().optional(),
  company: z.string().max(300).nullable().optional(),
  contact: z.string().max(300).nullable().optional(),
  outcome: z.string().max(2000).nullable().optional(),
  notes: z.string().max(10_000).nullable().optional(),
});
export type CreateCandidateReferenceBody = z.infer<
  typeof CreateCandidateReferenceBodySchema
>;

export const UpdateCandidateReferenceBodySchema =
  CreateCandidateReferenceBodySchema.partial().refine(
    (body) => Object.keys(body).length > 0,
    { message: 'At least one field must be provided' },
  );
export type UpdateCandidateReferenceBody = z.infer<
  typeof UpdateCandidateReferenceBodySchema
>;

export const CandidateNoteSchema = z.object({
  id: z.string().uuid(),
  authorId: z.string().uuid(),
  body: z.string(),
  isClientVisible: z.boolean(),
  createdAt: isoTimestamp,
});
export type CandidateNote = z.infer<typeof CandidateNoteSchema>;

export const CreateCandidateNoteBodySchema = z.object({
  body: z.string().min(1).max(20_000),
  isClientVisible: z.boolean().optional(),
});
export type CreateCandidateNoteBody = z.infer<typeof CreateCandidateNoteBodySchema>;

export const DisqualifierCheckResultSchema = z.enum([
  'pass',
  'fail',
  'not_applicable',
]);
export type DisqualifierCheckResult = z.infer<typeof DisqualifierCheckResultSchema>;

export const CandidateDisqualifierCheckSchema = z.object({
  disqualifierId: z.string().uuid(),
  disqualifierKey: z.string(),
  disqualifierLabel: z.string(),
  result: DisqualifierCheckResultSchema,
  notes: z.string().nullable(),
  checkedBy: z.string().uuid().nullable(),
  checkedAt: isoTimestamp,
});
export type CandidateDisqualifierCheck = z.infer<
  typeof CandidateDisqualifierCheckSchema
>;

/** `PUT` upserts the given checks; checks not listed are left untouched. */
export const PutDisqualifierChecksBodySchema = z.object({
  checks: z
    .array(
      z.object({
        disqualifierId: z.string().uuid(),
        result: DisqualifierCheckResultSchema,
        notes: z.string().max(5000).nullable().optional(),
      }),
    )
    .min(1),
});
export type PutDisqualifierChecksBody = z.infer<
  typeof PutDisqualifierChecksBodySchema
>;

export const JsonRecordSchema = z.record(z.unknown());

export const CandidateAssessmentSchema = z.object({
  id: z.string().uuid(),
  provider: z.string(),
  assessmentType: z.string().nullable(),
  takenAt: isoTimestamp.nullable(),
  scoreSummary: JsonRecordSchema.nullable(),
  reportFileId: z.string().uuid().nullable(),
  interpretedBy: z.string().uuid().nullable(),
  interpretationNotes: z.string().nullable(),
  createdAt: isoTimestamp,
});
export type CandidateAssessment = z.infer<typeof CandidateAssessmentSchema>;

/** Storage only — no scoring logic in MVP (04 §8). */
export const CreateCandidateAssessmentBodySchema = z.object({
  provider: z.string().min(1).max(200),
  assessmentType: z.string().max(200).nullable().optional(),
  takenAt: isoTimestamp.nullable().optional(),
  scoreSummary: JsonRecordSchema.nullable().optional(),
  reportFileId: z.string().uuid().nullable().optional(),
  interpretationNotes: z.string().max(20_000).nullable().optional(),
  rawPayload: JsonRecordSchema.nullable().optional(),
});
export type CreateCandidateAssessmentBody = z.infer<
  typeof CreateCandidateAssessmentBodySchema
>;

// ---------------------------------------------------------------------------
// Files (04 §8.1)
// ---------------------------------------------------------------------------

export const CandidateFileSchema = z.object({
  id: z.string().uuid(),
  candidateId: z.string().uuid(),
  fileType: CandidateFileTypeSchema,
  storagePath: z.string(),
  originalFilename: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
  isClientVisible: z.boolean(),
  /**
   * Row lifecycle (06 §6): 'pending' until the upload is confirmed, then
   * 'complete'. Virus scanning is not implemented in MVP; the column exists
   * so it can be added without a migration.
   */
  virusScanStatus: z.string(),
  uploadedBy: z.string().uuid().nullable(),
  uploadedAt: isoTimestamp,
});
export type CandidateFile = z.infer<typeof CandidateFileSchema>;

export const FileUploadUrlBodySchema = z.object({
  fileType: CandidateFileTypeSchema,
  originalFilename: z.string().min(1).max(300),
  mimeType: z.string().min(1).max(200),
  sizeBytes: z.number().int().positive(),
});
export type FileUploadUrlBody = z.infer<typeof FileUploadUrlBodySchema>;

export const FileUploadUrlResponseSchema = z.object({
  fileId: z.string().uuid(),
  /** Supabase Storage signed upload URL — browser PUTs the bytes directly. */
  uploadUrl: z.string(),
  /** Upload token paired with the signed URL (supabase-js uploadToSignedUrl). */
  token: z.string(),
  storagePath: z.string(),
});
export type FileUploadUrlResponse = z.infer<typeof FileUploadUrlResponseSchema>;

export const UpdateCandidateFileBodySchema = z
  .object({
    isClientVisible: z.boolean().optional(),
    fileType: CandidateFileTypeSchema.optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateCandidateFileBody = z.infer<typeof UpdateCandidateFileBodySchema>;

export const FileDownloadUrlResponseSchema = z.object({
  url: z.string(),
  /** Signed URLs are valid for 300 seconds (06 §6, AC-CA-05). */
  expiresInSeconds: z.literal(300),
});
export type FileDownloadUrlResponse = z.infer<typeof FileDownloadUrlResponseSchema>;

/** Signed download URL validity (06 §6). */
export const DOWNLOAD_URL_TTL_SECONDS = 300;

// ---------------------------------------------------------------------------
// Detail (GET /candidates/:id — full record with all child collections)
// ---------------------------------------------------------------------------

export const CandidateDetailSchema = CandidateSchema.extend({
  /**
   * The camelCase keys from the data-completeness required set that are
   * currently missing (UX 2.5). Non-empty exactly when `dataCompleteness`
   * is 'incomplete'; always `[]` when complete.
   */
  missingFields: z.array(z.string()),
  /**
   * Short-lived (300 s) signed URL for photoPath, computed at read time via
   * the storage port (UX 1.4). Null when there is no photo or signing failed.
   */
  photoUrl: z.string().nullable(),
  languages: z.array(CandidateLanguageSchema),
  tools: z.array(CandidateToolSchema),
  skills: z.array(CandidateSkillSchema),
  employmentHistory: z.array(CandidateEmploymentSchema),
  education: z.array(CandidateEducationSchema),
  certifications: z.array(CandidateCertificationSchema),
  references: z.array(CandidateReferenceSchema),
  notes: z.array(CandidateNoteSchema),
  disqualifierChecks: z.array(CandidateDisqualifierCheckSchema),
  assessments: z.array(CandidateAssessmentSchema),
  files: z.array(CandidateFileSchema),
});
export type CandidateDetail = z.infer<typeof CandidateDetailSchema>;

// ---------------------------------------------------------------------------
// Queries and write bodies (04 §8)
// ---------------------------------------------------------------------------

export const ListCandidatesQuerySchema = z
  .object({
    /** Full-text over cv_search plus trigram name match. */
    search: z.string().min(1).max(200).optional(),
    roleCategoryId: z.string().uuid().optional(),
    engineId: z.string().uuid().optional(),
    country: z.string().min(1).max(100).optional(),
    englishSpokenLevel: LanguageLevelSchema.optional(),
    /** Inclusive ceiling on the none<light<moderate<heavy ordering. */
    maxAccentStrength: AccentStrengthSchema.optional(),
    poolStatus: PoolStatusSchema.optional(),
    vettingStatus: VettingStatusSchema.optional(),
    /** Candidates able to start on or before this date. */
    availableFrom: isoDate.optional(),
    /** Rate ceiling; requires rateUnit so hourly/monthly never mix. */
    rateMax: z.coerce.number().positive().optional(),
    rateUnit: RateUnitSchema.optional(),
    /** Comma-separated tool ids; candidates must have ALL of them. */
    toolIds: z
      .string()
      .transform((value) => value.split(',').map((part) => part.trim()))
      .pipe(z.array(z.string().uuid()).min(1).max(20))
      .optional(),
    dataCompleteness: DataCompletenessSchema.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(25),
    cursor: z.string().min(1).optional(),
  })
  .refine((query) => query.rateMax === undefined || query.rateUnit !== undefined, {
    message: 'rateUnit is required when rateMax is provided',
    path: ['rateUnit'],
  });
export type ListCandidatesQuery = z.infer<typeof ListCandidatesQuerySchema>;

/**
 * Writable candidate fields. Excludes server-owned values: reference,
 * displayName (generated), dataCompleteness (computed), consent capture
 * (dedicated endpoint), cvSearch, archive timestamps.
 */
const CandidateWritableFieldsSchema = z.object({
  externalId: z.string().max(200).nullable(),
  preferredName: z.string().max(200).nullable(),
  email: z.string().email().max(320).nullable(),
  phone: z.string().max(50).nullable(),
  whatsapp: z.string().max(50).nullable(),
  linkedinUrl: z.string().url().max(2000).nullable(),
  portfolioUrl: z.string().url().max(2000).nullable(),
  photoPath: z.string().max(1000).nullable(),
  country: z.string().max(100).nullable(),
  regionState: z.string().max(200).nullable(),
  city: z.string().max(200).nullable(),
  timezone: z.string().max(100).nullable(),
  nationality: z.string().max(100).nullable(),
  relocationStatus: z.string().max(200).nullable(),
  englishSpokenLevel: LanguageLevelSchema.nullable(),
  englishWrittenLevel: LanguageLevelSchema.nullable(),
  accentStrength: AccentStrengthSchema.nullable(),
  accentNotes: z.string().max(5000).nullable(),
  languageAssessedBy: z.string().uuid().nullable(),
  languageAssessedAt: isoTimestamp.nullable(),
  yearsExperienceTotal: z.number().min(0).max(80).nullable(),
  yearsExperienceRelevant: z.number().min(0).max(80).nullable(),
  currentTitle: z.string().max(300).nullable(),
  currentEmployer: z.string().max(300).nullable(),
  employmentStatus: EmploymentStatusSchema.nullable(),
  noticePeriodDays: z.number().int().min(0).nullable(),
  availableFrom: isoDate.nullable(),
  seniorityLevel: SeniorityLevelSchema.nullable(),
  engineId: z.string().uuid().nullable(),
  primaryRoleCategoryId: z.string().uuid().nullable(),
  secondarySpecialisationId: z.string().uuid().nullable(),
  hasManagementExperience: z.boolean().nullable(),
  teamSizeManaged: z.number().int().min(0).nullable(),
  hasClientFacingExperience: z.boolean().nullable(),
  hasUsClientExperience: z.boolean().nullable(),
  remoteExperienceYears: z.number().min(0).max(80).nullable(),
  aiToolProficiency: ProficiencyLevelSchema.nullable(),
  typingWpm: z.number().int().min(0).max(300).nullable(),
  techLiteracyRating: rating.nullable(),
  expectedRateAmount: z.number().nonnegative().nullable(),
  expectedRateUnit: RateUnitSchema.nullable(),
  expectedRateCurrency: z.string().length(3).nullable(),
  rateMin: z.number().nonnegative().nullable(),
  rateMax: z.number().nonnegative().nullable(),
  isRateNegotiable: z.boolean().nullable(),
  currentRateAmount: z.number().nonnegative().nullable(),
  currentRateUnit: RateUnitSchema.nullable(),
  engagementTypes: z.array(EngagementTypeSchema).nullable(),
  hoursAvailablePerWeek: z.number().int().min(1).max(168).nullable(),
  overlapStart: timeOfDay.nullable(),
  overlapEnd: timeOfDay.nullable(),
  overlapTimezone: z.string().max(100).nullable(),
  maxConcurrentClients: z.number().int().min(1).nullable(),
  internetDownMbps: z.number().nonnegative().nullable(),
  internetUpMbps: z.number().nonnegative().nullable(),
  hasBackupInternet: z.boolean().nullable(),
  hasBackupPower: z.boolean().nullable(),
  computerSpecs: z.string().max(2000).nullable(),
  hasDualMonitor: z.boolean().nullable(),
  headsetQuality: z.string().max(500).nullable(),
  workspace: WorkspaceTypeSchema.nullable(),
  isQuietEnvironmentVerified: z.boolean().nullable(),
  vettingStatus: VettingStatusSchema,
  screeningCallAt: isoTimestamp.nullable(),
  recruiterRating: rating.nullable(),
  recruiterRecommendation: z.string().max(10_000).nullable(),
  strengths: z.string().max(10_000).nullable(),
  watchPoints: z.string().max(10_000).nullable(),
  redFlags: z.string().max(10_000).nullable(),
  autonomy: AutonomyLevelSchema.nullable(),
  canManageUp: z.boolean().nullable(),
  proactivityRating: rating.nullable(),
  attentionToDetailRating: rating.nullable(),
  communicationRating: rating.nullable(),
  energyPresentationRating: rating.nullable(),
  salesBackgroundWeight: SalesBackgroundWeightSchema.nullable(),
  hasOpsBackground: z.boolean().nullable(),
  hasEntrepreneurialAmbition: z.boolean().nullable(),
  areReferencesChecked: z.boolean(),
  backgroundCheckStatus: z.string().max(200).nullable(),
  source: CandidateSourceSchema,
  sourceDetail: z.string().max(500).nullable(),
  sourcedBy: z.string().uuid().nullable(),
  externalSystem: z.string().max(200).nullable(),
  firstContactedAt: isoTimestamp.nullable(),
  responsivenessRating: rating.nullable(),
  retentionUntil: isoDate.nullable(),
  doNotPresentToClientIds: z.array(z.string().uuid()),
  poolStatus: PoolStatusSchema,
  cvPrimaryFileId: z.string().uuid().nullable(),
});

/** AC-CA-01: only firstName and lastName are required. */
export const CreateCandidateBodySchema = z
  .object({
    firstName: z.string().min(1).max(200),
    lastName: z.string().min(1).max(200),
  })
  .merge(CandidateWritableFieldsSchema.partial());
export type CreateCandidateBody = z.infer<typeof CreateCandidateBodySchema>;

export const UpdateCandidateBodySchema = z
  .object({
    firstName: z.string().min(1).max(200),
    lastName: z.string().min(1).max(200),
  })
  .merge(CandidateWritableFieldsSchema)
  .partial()
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateCandidateBody = z.infer<typeof UpdateCandidateBodySchema>;

/** `POST /candidates/:id/consent` — sets consent_captured_at server-side. */
export const CandidateConsentBodySchema = z.object({
  hasConsentToShareProfile: z.boolean(),
  consentSource: z.string().min(1).max(500),
});
export type CandidateConsentBody = z.infer<typeof CandidateConsentBodySchema>;

// ---------------------------------------------------------------------------
// Inbound webhook (04 §8.2)
// ---------------------------------------------------------------------------

/**
 * Documented webhook payload. Only firstName/lastName are enforced at
 * runtime; everything else is lenient — unknown enum values are dropped and
 * recorded, never rejected (04 §8.2 behaviour 2/3).
 */
export const WebhookCandidateBodySchema = z.object({
  externalId: z.string().optional(),
  source: CandidateSourceSchema.optional(),
  sourceDetail: z.string().optional(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().optional(),
  phone: z.string().optional(),
  country: z.string().optional(),
  regionState: z.string().optional(),
  englishSpokenLevel: LanguageLevelSchema.optional(),
  accentStrength: AccentStrengthSchema.optional(),
  yearsExperienceTotal: z.number().optional(),
  expectedRateAmount: z.number().optional(),
  expectedRateUnit: RateUnitSchema.optional(),
  primaryRoleCategoryKey: z.string().optional(),
  cvUrl: z.string().optional(),
  raw: JsonRecordSchema.optional(),
});
export type WebhookCandidateBody = z.infer<typeof WebhookCandidateBodySchema>;

export const WebhookResponseSchema = z.object({
  candidateReference: z.string(),
  result: z.enum(['created', 'updated']),
  dataCompleteness: DataCompletenessSchema,
  droppedFields: z.array(z.string()),
});
export type WebhookResponse = z.infer<typeof WebhookResponseSchema>;
