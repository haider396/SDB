/**
 * SQL for the candidates core table and its child collections
 * (docs/02-DATABASE.md §8, docs/04-API.md §8). No business logic — leniency
 * rules, completeness computation, and authorization live in services.
 *
 * Conventions:
 * - `reference` comes from candidate_reference_seq (migration 0013) —
 *   concurrency-safe, 'CAN-NNNNNN'.
 * - `source` is ALWAYS set explicitly on insert. The column default in 0007
 *   was defective ('manual' is not a candidate_source value; fixed forward in
 *   0012 to 'other') — the repository never relies on it.
 * - `date` columns are selected `::text` so no timezone shift can corrupt
 *   them; enum/uuid arrays are selected `::text[]` so postgres.js parses them.
 * - numeric columns arrive as strings from postgres.js and are Number()ed in
 *   the mapper.
 */
import type {
  Candidate,
  CandidateAssessment,
  CandidateCertification,
  CandidateEducation,
  CandidateEmployment,
  CandidateLanguage,
  CandidateNote,
  CandidateReference,
  CandidateSkill,
  CandidateTool,
  CandidateDisqualifierCheck,
} from '@sdb/contracts';
import type postgres from 'postgres';
import type { Queryable } from '../lib/db.js';
import { resolvePublicId } from './public-ids.repo.js';

// ---------------------------------------------------------------------------
// Row mapping
// ---------------------------------------------------------------------------

const iso = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();
const num = (value: string | null): number | null =>
  value === null ? null : Number(value);

interface CandidateRow {
  id: string;
  public_id: string;
  reference: string;
  external_id: string | null;
  first_name: string;
  last_name: string;
  preferred_name: string | null;
  display_name: string;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  linkedin_url: string | null;
  portfolio_url: string | null;
  photo_path: string | null;
  country: string | null;
  region_state: string | null;
  city: string | null;
  timezone: string | null;
  nationality: string | null;
  relocation_status: string | null;
  english_spoken_level: Candidate['englishSpokenLevel'];
  english_written_level: Candidate['englishWrittenLevel'];
  accent_strength: Candidate['accentStrength'];
  accent_notes: string | null;
  language_assessed_by: string | null;
  language_assessed_at: Date | null;
  years_experience_total: string | null;
  years_experience_relevant: string | null;
  current_title: string | null;
  current_employer: string | null;
  employment_status: Candidate['employmentStatus'];
  notice_period_days: number | null;
  available_from: string | null;
  seniority_level: Candidate['seniorityLevel'];
  engine_id: string | null;
  primary_role_category_id: string | null;
  secondary_specialisation_id: string | null;
  has_management_experience: boolean | null;
  team_size_managed: number | null;
  has_client_facing_experience: boolean | null;
  has_us_client_experience: boolean | null;
  remote_experience_years: string | null;
  ai_tool_proficiency: Candidate['aiToolProficiency'];
  typing_wpm: number | null;
  tech_literacy_rating: number | null;
  expected_rate_amount: string | null;
  expected_rate_unit: Candidate['expectedRateUnit'];
  expected_rate_currency: string | null;
  rate_min: string | null;
  rate_max: string | null;
  is_rate_negotiable: boolean | null;
  current_rate_amount: string | null;
  current_rate_unit: Candidate['currentRateUnit'];
  engagement_types: string[] | null;
  hours_available_per_week: number | null;
  overlap_start: string | null;
  overlap_end: string | null;
  overlap_timezone: string | null;
  max_concurrent_clients: number | null;
  internet_down_mbps: string | null;
  internet_up_mbps: string | null;
  has_backup_internet: boolean | null;
  has_backup_power: boolean | null;
  computer_specs: string | null;
  has_dual_monitor: boolean | null;
  headset_quality: string | null;
  workspace: Candidate['workspace'];
  is_quiet_environment_verified: boolean | null;
  vetting_status: Candidate['vettingStatus'];
  vetted_by: string | null;
  vetted_at: Date | null;
  screening_call_at: Date | null;
  recruiter_rating: number | null;
  recruiter_recommendation: string | null;
  strengths: string | null;
  watch_points: string | null;
  red_flags: string | null;
  autonomy: Candidate['autonomy'];
  can_manage_up: boolean | null;
  proactivity_rating: number | null;
  attention_to_detail_rating: number | null;
  communication_rating: number | null;
  energy_presentation_rating: number | null;
  sales_background_weight: Candidate['salesBackgroundWeight'];
  has_ops_background: boolean | null;
  has_entrepreneurial_ambition: boolean | null;
  are_references_checked: boolean;
  background_check_status: string | null;
  source: Candidate['source'];
  source_detail: string | null;
  sourced_by: string | null;
  submitted_via: Candidate['submittedVia'];
  external_system: string | null;
  first_contacted_at: Date | null;
  responsiveness_rating: number | null;
  last_activity_at: Date | null;
  data_completeness: Candidate['dataCompleteness'];
  has_consent_to_share_profile: boolean;
  consent_captured_at: Date | null;
  consent_source: string | null;
  retention_until: string | null;
  do_not_present_to_client_ids: string[];
  pool_status: Candidate['poolStatus'];
  cv_primary_file_id: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

const CANDIDATE_COLUMNS = `
  id, public_id, reference, external_id, first_name, last_name, preferred_name,
  display_name, email::text as email, phone, whatsapp, linkedin_url,
  portfolio_url, photo_path, country, region_state, city, timezone,
  nationality, relocation_status,
  english_spoken_level, english_written_level, accent_strength, accent_notes,
  language_assessed_by, language_assessed_at,
  years_experience_total, years_experience_relevant, current_title,
  current_employer, employment_status, notice_period_days,
  available_from::text as available_from, seniority_level, engine_id,
  primary_role_category_id, secondary_specialisation_id,
  has_management_experience, team_size_managed, has_client_facing_experience,
  has_us_client_experience, remote_experience_years,
  ai_tool_proficiency, typing_wpm, tech_literacy_rating,
  expected_rate_amount, expected_rate_unit, expected_rate_currency,
  rate_min, rate_max, is_rate_negotiable, current_rate_amount,
  current_rate_unit, engagement_types::text[] as engagement_types,
  hours_available_per_week, overlap_start::text as overlap_start,
  overlap_end::text as overlap_end, overlap_timezone, max_concurrent_clients,
  internet_down_mbps, internet_up_mbps, has_backup_internet, has_backup_power,
  computer_specs, has_dual_monitor, headset_quality, workspace,
  is_quiet_environment_verified,
  vetting_status, vetted_by, vetted_at, screening_call_at, recruiter_rating,
  recruiter_recommendation, strengths, watch_points, red_flags, autonomy,
  can_manage_up, proactivity_rating, attention_to_detail_rating,
  communication_rating, energy_presentation_rating, sales_background_weight,
  has_ops_background, has_entrepreneurial_ambition, are_references_checked,
  background_check_status,
  source, source_detail, sourced_by, submitted_via, external_system,
  first_contacted_at, responsiveness_rating, last_activity_at,
  data_completeness,
  has_consent_to_share_profile, consent_captured_at, consent_source,
  retention_until::text as retention_until,
  do_not_present_to_client_ids::text[] as do_not_present_to_client_ids,
  pool_status, cv_primary_file_id, created_at, updated_at, archived_at
`;

function mapCandidate(row: CandidateRow): Candidate {
  return {
    id: row.id,
    publicId: row.public_id,
    reference: row.reference,
    externalId: row.external_id,
    firstName: row.first_name,
    lastName: row.last_name,
    preferredName: row.preferred_name,
    displayName: row.display_name,
    email: row.email,
    phone: row.phone,
    whatsapp: row.whatsapp,
    linkedinUrl: row.linkedin_url,
    portfolioUrl: row.portfolio_url,
    photoPath: row.photo_path,
    country: row.country,
    regionState: row.region_state,
    city: row.city,
    timezone: row.timezone,
    nationality: row.nationality,
    relocationStatus: row.relocation_status,
    englishSpokenLevel: row.english_spoken_level,
    englishWrittenLevel: row.english_written_level,
    accentStrength: row.accent_strength,
    accentNotes: row.accent_notes,
    languageAssessedBy: row.language_assessed_by,
    languageAssessedAt: iso(row.language_assessed_at),
    yearsExperienceTotal: num(row.years_experience_total),
    yearsExperienceRelevant: num(row.years_experience_relevant),
    currentTitle: row.current_title,
    currentEmployer: row.current_employer,
    employmentStatus: row.employment_status,
    noticePeriodDays: row.notice_period_days,
    availableFrom: row.available_from,
    seniorityLevel: row.seniority_level,
    engineId: row.engine_id,
    primaryRoleCategoryId: row.primary_role_category_id,
    secondarySpecialisationId: row.secondary_specialisation_id,
    hasManagementExperience: row.has_management_experience,
    teamSizeManaged: row.team_size_managed,
    hasClientFacingExperience: row.has_client_facing_experience,
    hasUsClientExperience: row.has_us_client_experience,
    remoteExperienceYears: num(row.remote_experience_years),
    aiToolProficiency: row.ai_tool_proficiency,
    typingWpm: row.typing_wpm,
    techLiteracyRating: row.tech_literacy_rating,
    expectedRateAmount: num(row.expected_rate_amount),
    expectedRateUnit: row.expected_rate_unit,
    expectedRateCurrency: row.expected_rate_currency,
    rateMin: num(row.rate_min),
    rateMax: num(row.rate_max),
    isRateNegotiable: row.is_rate_negotiable,
    currentRateAmount: num(row.current_rate_amount),
    currentRateUnit: row.current_rate_unit,
    engagementTypes: (row.engagement_types ?? null) as Candidate['engagementTypes'],
    hoursAvailablePerWeek: row.hours_available_per_week,
    overlapStart: row.overlap_start,
    overlapEnd: row.overlap_end,
    overlapTimezone: row.overlap_timezone,
    maxConcurrentClients: row.max_concurrent_clients,
    internetDownMbps: num(row.internet_down_mbps),
    internetUpMbps: num(row.internet_up_mbps),
    hasBackupInternet: row.has_backup_internet,
    hasBackupPower: row.has_backup_power,
    computerSpecs: row.computer_specs,
    hasDualMonitor: row.has_dual_monitor,
    headsetQuality: row.headset_quality,
    workspace: row.workspace,
    isQuietEnvironmentVerified: row.is_quiet_environment_verified,
    vettingStatus: row.vetting_status,
    vettedBy: row.vetted_by,
    vettedAt: iso(row.vetted_at),
    screeningCallAt: iso(row.screening_call_at),
    recruiterRating: row.recruiter_rating,
    recruiterRecommendation: row.recruiter_recommendation,
    strengths: row.strengths,
    watchPoints: row.watch_points,
    redFlags: row.red_flags,
    autonomy: row.autonomy,
    canManageUp: row.can_manage_up,
    proactivityRating: row.proactivity_rating,
    attentionToDetailRating: row.attention_to_detail_rating,
    communicationRating: row.communication_rating,
    energyPresentationRating: row.energy_presentation_rating,
    salesBackgroundWeight: row.sales_background_weight,
    hasOpsBackground: row.has_ops_background,
    hasEntrepreneurialAmbition: row.has_entrepreneurial_ambition,
    areReferencesChecked: row.are_references_checked,
    backgroundCheckStatus: row.background_check_status,
    source: row.source,
    sourceDetail: row.source_detail,
    sourcedBy: row.sourced_by,
    submittedVia: row.submitted_via,
    externalSystem: row.external_system,
    firstContactedAt: iso(row.first_contacted_at),
    responsivenessRating: row.responsiveness_rating,
    lastActivityAt: iso(row.last_activity_at),
    dataCompleteness: row.data_completeness,
    hasConsentToShareProfile: row.has_consent_to_share_profile,
    consentCapturedAt: iso(row.consent_captured_at),
    consentSource: row.consent_source,
    retentionUntil: row.retention_until,
    doNotPresentToClientIds: row.do_not_present_to_client_ids,
    poolStatus: row.pool_status,
    cvPrimaryFileId: row.cv_primary_file_id,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    archivedAt: iso(row.archived_at),
  };
}

// ---------------------------------------------------------------------------
// camelCase patch → snake_case assignments
// ---------------------------------------------------------------------------

/** camelCase body key → column name, for every writable candidate field. */
const FIELD_TO_COLUMN: Record<string, string> = {
  externalId: 'external_id',
  firstName: 'first_name',
  lastName: 'last_name',
  preferredName: 'preferred_name',
  email: 'email',
  phone: 'phone',
  whatsapp: 'whatsapp',
  linkedinUrl: 'linkedin_url',
  portfolioUrl: 'portfolio_url',
  photoPath: 'photo_path',
  country: 'country',
  regionState: 'region_state',
  city: 'city',
  timezone: 'timezone',
  nationality: 'nationality',
  relocationStatus: 'relocation_status',
  englishSpokenLevel: 'english_spoken_level',
  englishWrittenLevel: 'english_written_level',
  accentStrength: 'accent_strength',
  accentNotes: 'accent_notes',
  languageAssessedBy: 'language_assessed_by',
  languageAssessedAt: 'language_assessed_at',
  yearsExperienceTotal: 'years_experience_total',
  yearsExperienceRelevant: 'years_experience_relevant',
  currentTitle: 'current_title',
  currentEmployer: 'current_employer',
  employmentStatus: 'employment_status',
  noticePeriodDays: 'notice_period_days',
  availableFrom: 'available_from',
  seniorityLevel: 'seniority_level',
  engineId: 'engine_id',
  primaryRoleCategoryId: 'primary_role_category_id',
  secondarySpecialisationId: 'secondary_specialisation_id',
  hasManagementExperience: 'has_management_experience',
  teamSizeManaged: 'team_size_managed',
  hasClientFacingExperience: 'has_client_facing_experience',
  hasUsClientExperience: 'has_us_client_experience',
  remoteExperienceYears: 'remote_experience_years',
  aiToolProficiency: 'ai_tool_proficiency',
  typingWpm: 'typing_wpm',
  techLiteracyRating: 'tech_literacy_rating',
  expectedRateAmount: 'expected_rate_amount',
  expectedRateUnit: 'expected_rate_unit',
  expectedRateCurrency: 'expected_rate_currency',
  rateMin: 'rate_min',
  rateMax: 'rate_max',
  isRateNegotiable: 'is_rate_negotiable',
  currentRateAmount: 'current_rate_amount',
  currentRateUnit: 'current_rate_unit',
  engagementTypes: 'engagement_types',
  hoursAvailablePerWeek: 'hours_available_per_week',
  typingWpmAverage: 'typing_wpm_average',
  typingTestAttempts: 'typing_test_attempts',
  overlapStart: 'overlap_start',
  overlapEnd: 'overlap_end',
  overlapTimezone: 'overlap_timezone',
  maxConcurrentClients: 'max_concurrent_clients',
  internetDownMbps: 'internet_down_mbps',
  internetUpMbps: 'internet_up_mbps',
  hasBackupInternet: 'has_backup_internet',
  hasBackupPower: 'has_backup_power',
  computerSpecs: 'computer_specs',
  hasDualMonitor: 'has_dual_monitor',
  headsetQuality: 'headset_quality',
  workspace: 'workspace',
  isQuietEnvironmentVerified: 'is_quiet_environment_verified',
  vettingStatus: 'vetting_status',
  vettedBy: 'vetted_by',
  vettedAt: 'vetted_at',
  screeningCallAt: 'screening_call_at',
  recruiterRating: 'recruiter_rating',
  recruiterRecommendation: 'recruiter_recommendation',
  strengths: 'strengths',
  watchPoints: 'watch_points',
  redFlags: 'red_flags',
  autonomy: 'autonomy',
  canManageUp: 'can_manage_up',
  proactivityRating: 'proactivity_rating',
  attentionToDetailRating: 'attention_to_detail_rating',
  communicationRating: 'communication_rating',
  energyPresentationRating: 'energy_presentation_rating',
  salesBackgroundWeight: 'sales_background_weight',
  hasOpsBackground: 'has_ops_background',
  hasEntrepreneurialAmbition: 'has_entrepreneurial_ambition',
  areReferencesChecked: 'are_references_checked',
  backgroundCheckStatus: 'background_check_status',
  source: 'source',
  sourceDetail: 'source_detail',
  sourcedBy: 'sourced_by',
  submittedVia: 'submitted_via',
  externalSystem: 'external_system',
  firstContactedAt: 'first_contacted_at',
  responsivenessRating: 'responsiveness_rating',
  lastActivityAt: 'last_activity_at',
  retentionUntil: 'retention_until',
  doNotPresentToClientIds: 'do_not_present_to_client_ids',
  poolStatus: 'pool_status',
  cvPrimaryFileId: 'cv_primary_file_id',
  dataCompleteness: 'data_completeness',
};

/** Convert a camelCase patch to snake_case column assignments. */
export function toColumnAssignments(
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const assignments: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    const column = FIELD_TO_COLUMN[key];
    if (column === undefined) continue;
    assignments[column] = value;
  }
  return assignments;
}

// ---------------------------------------------------------------------------
// Core reads
// ---------------------------------------------------------------------------

export interface ListCandidatesFilters {
  search?: string;
  roleCategoryId?: string;
  engineId?: string;
  country?: string;
  englishSpokenLevel?: string;
  /** Pre-expanded allowed accent values (none<light<moderate<heavy ceiling). */
  accentStrengths?: string[];
  poolStatus?: string;
  vettingStatus?: string;
  availableFrom?: string;
  rateMax?: number;
  rateUnit?: string;
  /** Candidate must have ALL of these tools. */
  toolIds?: string[];
  dataCompleteness?: string;
  limit: number;
  cursor?: { createdAt: string; id: string };
}

/**
 * `total` is the full filtered count via `count(*) over ()` — accurate only
 * when no cursor predicate narrows the window (the service surfaces it on
 * first pages only, UX 2.9). 0 when the page is empty.
 */
export async function listCandidates(
  sql: Queryable,
  filters: ListCandidatesFilters,
): Promise<{ data: Candidate[]; total: number }> {
  const rows = await sql<(CandidateRow & { total: string })[]>`
    select ${sql.unsafe(CANDIDATE_COLUMNS)}, count(*) over ()::text as total
    from candidates
    where archived_at is null
      ${
        filters.search === undefined
          ? sql``
          : sql`and (
              cv_search @@ plainto_tsquery('english', ${filters.search})
              or (first_name || ' ' || last_name) ilike ${'%' + filters.search + '%'}
            )`
      }
      ${
        filters.roleCategoryId === undefined
          ? sql``
          : sql`and primary_role_category_id = ${filters.roleCategoryId}`
      }
      ${filters.engineId === undefined ? sql`` : sql`and engine_id = ${filters.engineId}`}
      ${filters.country === undefined ? sql`` : sql`and country = ${filters.country}`}
      ${
        filters.englishSpokenLevel === undefined
          ? sql``
          : sql`and english_spoken_level = ${filters.englishSpokenLevel}::language_level`
      }
      ${
        filters.accentStrengths === undefined
          ? sql``
          : sql`and accent_strength = any(${filters.accentStrengths}::accent_strength[])`
      }
      ${
        filters.poolStatus === undefined
          ? sql``
          : sql`and pool_status = ${filters.poolStatus}::pool_status`
      }
      ${
        filters.vettingStatus === undefined
          ? sql``
          : sql`and vetting_status = ${filters.vettingStatus}::vetting_status`
      }
      ${
        filters.availableFrom === undefined
          ? sql``
          : sql`and available_from is not null and available_from <= ${filters.availableFrom}::date`
      }
      ${
        filters.rateMax === undefined || filters.rateUnit === undefined
          ? sql``
          : sql`and expected_rate_unit = ${filters.rateUnit}::rate_unit
                and expected_rate_amount <= ${filters.rateMax}`
      }
      ${
        filters.toolIds === undefined
          ? sql``
          : sql`and id in (
              select candidate_id from candidate_tools
              where tool_id = any(${filters.toolIds}::uuid[])
              group by candidate_id
              having count(distinct tool_id) = ${filters.toolIds.length}
            )`
      }
      ${
        filters.dataCompleteness === undefined
          ? sql``
          : sql`and data_completeness = ${filters.dataCompleteness}::data_completeness`
      }
      ${
        filters.cursor === undefined
          ? sql``
          : sql`and (created_at, id) < (${filters.cursor.createdAt}::timestamptz, ${filters.cursor.id}::uuid)`
      }
    order by created_at desc, id desc
    limit ${filters.limit}
  `;
  return {
    data: rows.map(mapCandidate),
    total: Number(rows[0]?.total ?? '0'),
  };
}

/** `candidateRef` is a uuid OR a public_id (0015) — resolved here. */
export async function findCandidateById(
  sql: Queryable,
  candidateRef: string,
  opts: { includeArchived?: boolean } = {},
): Promise<Candidate | null> {
  const candidateId = await resolvePublicId(sql, 'candidates', candidateRef);
  if (candidateId === null) return null;
  const rows = await sql<CandidateRow[]>`
    select ${sql.unsafe(CANDIDATE_COLUMNS)}
    from candidates
    where id = ${candidateId}
      ${opts.includeArchived === true ? sql`` : sql`and archived_at is null`}
  `;
  const row = rows[0];
  return row === undefined ? null : mapCandidate(row);
}

export async function findCandidateByExternalId(
  sql: Queryable,
  externalId: string,
): Promise<Candidate | null> {
  const rows = await sql<CandidateRow[]>`
    select ${sql.unsafe(CANDIDATE_COLUMNS)}
    from candidates
    where external_id = ${externalId}
  `;
  const row = rows[0];
  return row === undefined ? null : mapCandidate(row);
}

// ---------------------------------------------------------------------------
// Core writes
// ---------------------------------------------------------------------------

export interface InsertCandidateInput {
  firstName: string;
  lastName: string;
  /** Explicit, never the column default (defective in 0007, fixed in 0012). */
  source: Candidate['source'];
  submittedVia: Candidate['submittedVia'];
  dataCompleteness?: Candidate['dataCompleteness'];
  externalId?: string | null;
  /** Remaining writable fields as camelCase; applied via toColumnAssignments. */
  fields?: Record<string, unknown>;
}

export async function insertCandidate(
  sql: Queryable,
  input: InsertCandidateInput,
): Promise<Candidate> {
  const rows = await sql<{ id: string }[]>`
    insert into candidates (reference, first_name, last_name, source, submitted_via, data_completeness, external_id)
    values (
      'CAN-' || lpad(nextval('candidate_reference_seq')::text, 6, '0'),
      ${input.firstName},
      ${input.lastName},
      ${input.source},
      ${input.submittedVia},
      ${input.dataCompleteness ?? 'complete'},
      ${input.externalId ?? null}
    )
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('candidate insert returned no row');
  const assignments = toColumnAssignments(input.fields ?? {});
  // firstName/lastName/source/... already set; strip them from the patch.
  delete assignments['first_name'];
  delete assignments['last_name'];
  delete assignments['source'];
  delete assignments['submitted_via'];
  delete assignments['external_id'];
  if (Object.keys(assignments).length > 0) {
    await sql`
      update candidates set ${sql(assignments)} where id = ${row.id}
    `;
  }
  const created = await findCandidateById(sql, row.id);
  if (created === null) throw new Error('candidate vanished after insert');
  return created;
}

/** Returns false when the candidate does not exist (or is archived). */
export async function updateCandidate(
  sql: Queryable,
  candidateId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const assignments = toColumnAssignments(patch);
  if (Object.keys(assignments).length === 0) return true;
  const rows = await sql<{ id: string }[]>`
    update candidates
    set ${sql(assignments)}
    where id = ${candidateId}
      and archived_at is null
    returning id
  `;
  return rows.length > 0;
}

/**
 * Candidate identity lookup. Email is the identity (Haider, 4 Sep): the same
 * person applying to a second role must attach to the SAME candidate record.
 *
 * `email` is citext, so this is case-insensitive with no lower() and no
 * functional index — served by idx_candidates_email_live (0020).
 *
 * Archived candidates are EXCLUDED: archiving means "this person is gone", and
 * silently resurrecting them from a public form would be worse than a duplicate.
 */
export async function findLiveCandidateByEmail(
  sql: Queryable,
  email: string,
): Promise<{ id: string; reference: string } | null> {
  const rows = await sql<{ id: string; reference: string }[]>`
    select id, reference from candidates
     where email = ${email} and archived_at is null
     limit 1
  `;
  return rows[0] ?? null;
}

/**
 * Serialise concurrent submissions for one email address.
 *
 * Two people submitting the same address at the same instant would both see
 * "no candidate" and both insert. The lock is held for the rest of the
 * transaction and released on commit or rollback, so the second waits and then
 * finds the first's row. This — not the unique index — is what actually holds
 * under concurrency; the index (0022) is the backstop that turns a logic bug
 * into an error instead of a duplicate.
 */
export async function lockCandidateEmail(
  sql: Queryable,
  email: string,
): Promise<void> {
  await sql`
    select pg_advisory_xact_lock(
      hashtextextended('sdb:candidate_email:' || lower(${email}), 0)
    )
  `;
}

export async function archiveCandidate(
  sql: Queryable,
  candidateId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update candidates
    set archived_at = now()
    where id = ${candidateId}
      and archived_at is null
    returning id
  `;
  return rows.length > 0;
}

export async function setCandidateConsent(
  sql: Queryable,
  candidateId: string,
  input: { hasConsentToShareProfile: boolean; consentSource: string },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update candidates
    set has_consent_to_share_profile = ${input.hasConsentToShareProfile},
        consent_source = ${input.consentSource},
        consent_captured_at = now()
    where id = ${candidateId}
      and archived_at is null
    returning id
  `;
  return rows.length > 0;
}

export async function setCvPrimaryFileIfUnset(
  sql: Queryable,
  candidateId: string,
  fileId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update candidates
    set cv_primary_file_id = ${fileId}
    where id = ${candidateId}
      and cv_primary_file_id is null
    returning id
  `;
  return rows.length > 0;
}

export async function clearCvPrimaryFile(
  sql: Queryable,
  candidateId: string,
  fileId: string,
): Promise<void> {
  await sql`
    update candidates
    set cv_primary_file_id = null
    where id = ${candidateId}
      and cv_primary_file_id = ${fileId}
  `;
}

// ---------------------------------------------------------------------------
// Taxonomy helper (webhook: primaryRoleCategoryKey → id)
// ---------------------------------------------------------------------------

export async function findRoleCategoryIdByKey(
  sql: Queryable,
  key: string,
): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    select id from role_categories where key = ${key} and is_active = true
  `;
  return rows[0]?.id ?? null;
}

// ---------------------------------------------------------------------------
// Child collections (04 §8) — thin per-table CRUD
// ---------------------------------------------------------------------------

interface LanguageRow {
  id: string;
  language: string;
  spoken_level: CandidateLanguage['spokenLevel'];
  written_level: CandidateLanguage['writtenLevel'];
  is_native: boolean;
}

export async function listLanguages(
  sql: Queryable,
  candidateId: string,
): Promise<CandidateLanguage[]> {
  const rows = await sql<LanguageRow[]>`
    select id, language, spoken_level, written_level, is_native
    from candidate_languages
    where candidate_id = ${candidateId}
    order by language
  `;
  return rows.map((row) => ({
    id: row.id,
    language: row.language,
    spokenLevel: row.spoken_level,
    writtenLevel: row.written_level,
    isNative: row.is_native,
  }));
}

export async function insertLanguage(
  sql: Queryable,
  candidateId: string,
  input: {
    language: string;
    spokenLevel?: string | null;
    writtenLevel?: string | null;
    isNative?: boolean;
  },
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into candidate_languages (candidate_id, language, spoken_level, written_level, is_native)
    values (${candidateId}, ${input.language}, ${input.spokenLevel ?? null},
            ${input.writtenLevel ?? null}, ${input.isNative ?? false})
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('language insert returned no row');
  return row.id;
}

export async function updateLanguage(
  sql: Queryable,
  candidateId: string,
  languageId: string,
  patch: {
    language?: string;
    spokenLevel?: string | null;
    writtenLevel?: string | null;
    isNative?: boolean;
  },
): Promise<boolean> {
  const assignments: Record<string, unknown> = {};
  if (patch.language !== undefined) assignments['language'] = patch.language;
  if (patch.spokenLevel !== undefined) assignments['spoken_level'] = patch.spokenLevel;
  if (patch.writtenLevel !== undefined) assignments['written_level'] = patch.writtenLevel;
  if (patch.isNative !== undefined) assignments['is_native'] = patch.isNative;
  if (Object.keys(assignments).length === 0) return true;
  const rows = await sql<{ id: string }[]>`
    update candidate_languages set ${sql(assignments)}
    where id = ${languageId} and candidate_id = ${candidateId}
    returning id
  `;
  return rows.length > 0;
}

export async function deleteLanguage(
  sql: Queryable,
  candidateId: string,
  languageId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    delete from candidate_languages
    where id = ${languageId} and candidate_id = ${candidateId}
    returning id
  `;
  return rows.length > 0;
}

interface ToolRow {
  tool_id: string;
  proficiency: CandidateTool['proficiency'];
  years_used: string | null;
  last_used_year: number | null;
}

export async function listTools(
  sql: Queryable,
  candidateId: string,
): Promise<CandidateTool[]> {
  const rows = await sql<ToolRow[]>`
    select tool_id, proficiency, years_used, last_used_year
    from candidate_tools
    where candidate_id = ${candidateId}
    order by tool_id
  `;
  return rows.map((row) => ({
    toolId: row.tool_id,
    proficiency: row.proficiency,
    yearsUsed: num(row.years_used),
    lastUsedYear: row.last_used_year,
  }));
}

/** PUT semantics: replace the full set (04 §8). */
export async function replaceTools(
  sql: Queryable,
  candidateId: string,
  tools: {
    toolId: string;
    proficiency: string;
    yearsUsed?: number | null;
    lastUsedYear?: number | null;
  }[],
): Promise<void> {
  await sql`delete from candidate_tools where candidate_id = ${candidateId}`;
  for (const tool of tools) {
    await sql`
      insert into candidate_tools (candidate_id, tool_id, proficiency, years_used, last_used_year)
      values (${candidateId}, ${tool.toolId}, ${tool.proficiency},
              ${tool.yearsUsed ?? null}, ${tool.lastUsedYear ?? null})
    `;
  }
}

interface SkillRow {
  skill_id: string;
  proficiency: CandidateSkill['proficiency'];
  verified_by: string | null;
  verified_at: Date | null;
}

export async function listSkills(
  sql: Queryable,
  candidateId: string,
): Promise<CandidateSkill[]> {
  const rows = await sql<SkillRow[]>`
    select skill_id, proficiency, verified_by, verified_at
    from candidate_skills
    where candidate_id = ${candidateId}
    order by skill_id
  `;
  return rows.map((row) => ({
    skillId: row.skill_id,
    proficiency: row.proficiency,
    verifiedBy: row.verified_by,
    verifiedAt: iso(row.verified_at),
  }));
}

export async function replaceSkills(
  sql: Queryable,
  candidateId: string,
  skills: { skillId: string; proficiency: string }[],
): Promise<void> {
  await sql`delete from candidate_skills where candidate_id = ${candidateId}`;
  for (const skill of skills) {
    await sql`
      insert into candidate_skills (candidate_id, skill_id, proficiency)
      values (${candidateId}, ${skill.skillId}, ${skill.proficiency})
    `;
  }
}

interface EmploymentRow {
  id: string;
  employer: string;
  title: string;
  start_date: string | null;
  end_date: string | null;
  is_current: boolean;
  responsibilities: string | null;
  reason_for_leaving: string | null;
  sort_order: number;
}

export async function listEmployment(
  sql: Queryable,
  candidateId: string,
): Promise<CandidateEmployment[]> {
  const rows = await sql<EmploymentRow[]>`
    select id, employer, title, start_date::text as start_date,
           end_date::text as end_date, is_current, responsibilities,
           reason_for_leaving, sort_order
    from candidate_employment_history
    where candidate_id = ${candidateId}
    order by sort_order, start_date desc nulls last
  `;
  return rows.map((row) => ({
    id: row.id,
    employer: row.employer,
    title: row.title,
    startDate: row.start_date,
    endDate: row.end_date,
    isCurrent: row.is_current,
    responsibilities: row.responsibilities,
    reasonForLeaving: row.reason_for_leaving,
    sortOrder: row.sort_order,
  }));
}

export async function insertEmployment(
  sql: Queryable,
  candidateId: string,
  input: Record<string, unknown>,
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into candidate_employment_history
      (candidate_id, employer, title, start_date, end_date, is_current,
       responsibilities, reason_for_leaving, sort_order)
    values (${candidateId}, ${input['employer'] as string}, ${input['title'] as string},
            ${(input['startDate'] as string | null | undefined) ?? null},
            ${(input['endDate'] as string | null | undefined) ?? null},
            ${(input['isCurrent'] as boolean | undefined) ?? false},
            ${(input['responsibilities'] as string | null | undefined) ?? null},
            ${(input['reasonForLeaving'] as string | null | undefined) ?? null},
            ${(input['sortOrder'] as number | undefined) ?? 0})
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('employment insert returned no row');
  return row.id;
}

const EMPLOYMENT_COLUMNS: Record<string, string> = {
  employer: 'employer',
  title: 'title',
  startDate: 'start_date',
  endDate: 'end_date',
  isCurrent: 'is_current',
  responsibilities: 'responsibilities',
  reasonForLeaving: 'reason_for_leaving',
  sortOrder: 'sort_order',
};

function pickAssignments(
  patch: Record<string, unknown>,
  mapping: Record<string, string>,
): Record<string, unknown> {
  const assignments: Record<string, unknown> = {};
  for (const [key, column] of Object.entries(mapping)) {
    const value = patch[key];
    if (value !== undefined) assignments[column] = value;
  }
  return assignments;
}

export async function updateEmployment(
  sql: Queryable,
  candidateId: string,
  entryId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const assignments = pickAssignments(patch, EMPLOYMENT_COLUMNS);
  if (Object.keys(assignments).length === 0) return true;
  const rows = await sql<{ id: string }[]>`
    update candidate_employment_history set ${sql(assignments)}
    where id = ${entryId} and candidate_id = ${candidateId}
    returning id
  `;
  return rows.length > 0;
}

export async function deleteEmployment(
  sql: Queryable,
  candidateId: string,
  entryId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    delete from candidate_employment_history
    where id = ${entryId} and candidate_id = ${candidateId}
    returning id
  `;
  return rows.length > 0;
}

interface EducationRow {
  id: string;
  institution: string;
  degree: string | null;
  field_of_study: string | null;
  country: string | null;
  start_year: number | null;
  end_year: number | null;
}

export async function listEducation(
  sql: Queryable,
  candidateId: string,
): Promise<CandidateEducation[]> {
  const rows = await sql<EducationRow[]>`
    select id, institution, degree, field_of_study, country, start_year, end_year
    from candidate_education
    where candidate_id = ${candidateId}
    order by end_year desc nulls last, institution
  `;
  return rows.map((row) => ({
    id: row.id,
    institution: row.institution,
    degree: row.degree,
    fieldOfStudy: row.field_of_study,
    country: row.country,
    startYear: row.start_year,
    endYear: row.end_year,
  }));
}

export async function insertEducation(
  sql: Queryable,
  candidateId: string,
  input: Record<string, unknown>,
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into candidate_education
      (candidate_id, institution, degree, field_of_study, country, start_year, end_year)
    values (${candidateId}, ${input['institution'] as string},
            ${(input['degree'] as string | null | undefined) ?? null},
            ${(input['fieldOfStudy'] as string | null | undefined) ?? null},
            ${(input['country'] as string | null | undefined) ?? null},
            ${(input['startYear'] as number | null | undefined) ?? null},
            ${(input['endYear'] as number | null | undefined) ?? null})
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('education insert returned no row');
  return row.id;
}

const EDUCATION_COLUMNS: Record<string, string> = {
  institution: 'institution',
  degree: 'degree',
  fieldOfStudy: 'field_of_study',
  country: 'country',
  startYear: 'start_year',
  endYear: 'end_year',
};

export async function updateEducation(
  sql: Queryable,
  candidateId: string,
  entryId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const assignments = pickAssignments(patch, EDUCATION_COLUMNS);
  if (Object.keys(assignments).length === 0) return true;
  const rows = await sql<{ id: string }[]>`
    update candidate_education set ${sql(assignments)}
    where id = ${entryId} and candidate_id = ${candidateId}
    returning id
  `;
  return rows.length > 0;
}

export async function deleteEducation(
  sql: Queryable,
  candidateId: string,
  entryId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    delete from candidate_education
    where id = ${entryId} and candidate_id = ${candidateId}
    returning id
  `;
  return rows.length > 0;
}

interface CertificationRow {
  id: string;
  name: string;
  issuer: string | null;
  issued_date: string | null;
  expires_date: string | null;
  credential_url: string | null;
}

export async function listCertifications(
  sql: Queryable,
  candidateId: string,
): Promise<CandidateCertification[]> {
  const rows = await sql<CertificationRow[]>`
    select id, name, issuer, issued_date::text as issued_date,
           expires_date::text as expires_date, credential_url
    from candidate_certifications
    where candidate_id = ${candidateId}
    order by issued_date desc nulls last, name
  `;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    issuer: row.issuer,
    issuedDate: row.issued_date,
    expiresDate: row.expires_date,
    credentialUrl: row.credential_url,
  }));
}

export async function insertCertification(
  sql: Queryable,
  candidateId: string,
  input: Record<string, unknown>,
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into candidate_certifications
      (candidate_id, name, issuer, issued_date, expires_date, credential_url)
    values (${candidateId}, ${input['name'] as string},
            ${(input['issuer'] as string | null | undefined) ?? null},
            ${(input['issuedDate'] as string | null | undefined) ?? null},
            ${(input['expiresDate'] as string | null | undefined) ?? null},
            ${(input['credentialUrl'] as string | null | undefined) ?? null})
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('certification insert returned no row');
  return row.id;
}

const CERTIFICATION_COLUMNS: Record<string, string> = {
  name: 'name',
  issuer: 'issuer',
  issuedDate: 'issued_date',
  expiresDate: 'expires_date',
  credentialUrl: 'credential_url',
};

export async function updateCertification(
  sql: Queryable,
  candidateId: string,
  entryId: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  const assignments = pickAssignments(patch, CERTIFICATION_COLUMNS);
  if (Object.keys(assignments).length === 0) return true;
  const rows = await sql<{ id: string }[]>`
    update candidate_certifications set ${sql(assignments)}
    where id = ${entryId} and candidate_id = ${candidateId}
    returning id
  `;
  return rows.length > 0;
}

export async function deleteCertification(
  sql: Queryable,
  candidateId: string,
  entryId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    delete from candidate_certifications
    where id = ${entryId} and candidate_id = ${candidateId}
    returning id
  `;
  return rows.length > 0;
}

interface ReferenceRow {
  id: string;
  referee_name: string;
  relationship: string | null;
  company: string | null;
  contact: string | null;
  checked_by: string | null;
  checked_at: Date | null;
  outcome: string | null;
  notes: string | null;
}

export async function listReferences(
  sql: Queryable,
  candidateId: string,
): Promise<CandidateReference[]> {
  const rows = await sql<ReferenceRow[]>`
    select id, referee_name, relationship, company, contact,
           checked_by, checked_at, outcome, notes
    from candidate_references
    where candidate_id = ${candidateId}
    order by referee_name
  `;
  return rows.map((row) => ({
    id: row.id,
    refereeName: row.referee_name,
    relationship: row.relationship,
    company: row.company,
    contact: row.contact,
    checkedBy: row.checked_by,
    checkedAt: iso(row.checked_at),
    outcome: row.outcome,
    notes: row.notes,
  }));
}

export async function insertReference(
  sql: Queryable,
  candidateId: string,
  input: Record<string, unknown>,
  checkedBy: string | null,
): Promise<string> {
  const outcome = (input['outcome'] as string | null | undefined) ?? null;
  const rows = await sql<{ id: string }[]>`
    insert into candidate_references
      (candidate_id, referee_name, relationship, company, contact, outcome,
       notes, checked_by, checked_at)
    values (${candidateId}, ${input['refereeName'] as string},
            ${(input['relationship'] as string | null | undefined) ?? null},
            ${(input['company'] as string | null | undefined) ?? null},
            ${(input['contact'] as string | null | undefined) ?? null},
            ${outcome},
            ${(input['notes'] as string | null | undefined) ?? null},
            ${outcome === null ? null : checkedBy},
            ${outcome === null ? null : new Date()})
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('reference insert returned no row');
  return row.id;
}

const REFERENCE_COLUMNS: Record<string, string> = {
  refereeName: 'referee_name',
  relationship: 'relationship',
  company: 'company',
  contact: 'contact',
  outcome: 'outcome',
  notes: 'notes',
};

export async function updateReference(
  sql: Queryable,
  candidateId: string,
  entryId: string,
  patch: Record<string, unknown>,
  checkedBy: string | null,
): Promise<boolean> {
  const assignments = pickAssignments(patch, REFERENCE_COLUMNS);
  if (Object.keys(assignments).length === 0) return true;
  // Recording an outcome stamps the checker (the latest checker is the
  // accountable one).
  if (patch['outcome'] !== undefined && patch['outcome'] !== null) {
    assignments['checked_by'] = checkedBy;
    assignments['checked_at'] = new Date();
  }
  const rows = await sql<{ id: string }[]>`
    update candidate_references set ${sql(assignments)}
    where id = ${entryId} and candidate_id = ${candidateId}
    returning id
  `;
  return rows.length > 0;
}

export async function deleteReference(
  sql: Queryable,
  candidateId: string,
  entryId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    delete from candidate_references
    where id = ${entryId} and candidate_id = ${candidateId}
    returning id
  `;
  return rows.length > 0;
}

interface NoteRow {
  id: string;
  author_id: string;
  body: string;
  is_client_visible: boolean;
  created_at: Date;
}

export async function listNotes(
  sql: Queryable,
  candidateId: string,
): Promise<CandidateNote[]> {
  const rows = await sql<NoteRow[]>`
    select id, author_id, body, is_client_visible, created_at
    from candidate_notes
    where candidate_id = ${candidateId}
    order by created_at desc
  `;
  return rows.map((row) => ({
    id: row.id,
    authorId: row.author_id,
    body: row.body,
    isClientVisible: row.is_client_visible,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function insertNote(
  sql: Queryable,
  candidateId: string,
  input: { authorId: string; body: string; isClientVisible?: boolean },
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into candidate_notes (candidate_id, author_id, body, is_client_visible)
    values (${candidateId}, ${input.authorId}, ${input.body}, ${input.isClientVisible ?? false})
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('note insert returned no row');
  return row.id;
}

interface DisqualifierCheckRow {
  disqualifier_id: string;
  disqualifier_key: string;
  disqualifier_label: string;
  result: CandidateDisqualifierCheck['result'];
  notes: string | null;
  checked_by: string | null;
  checked_at: Date;
}

export async function listDisqualifierChecks(
  sql: Queryable,
  candidateId: string,
): Promise<CandidateDisqualifierCheck[]> {
  const rows = await sql<DisqualifierCheckRow[]>`
    select c.disqualifier_id, d.key as disqualifier_key,
           d.label as disqualifier_label, c.result, c.notes,
           c.checked_by, c.checked_at
    from candidate_disqualifier_checks c
    join disqualifiers d on d.id = c.disqualifier_id
    where c.candidate_id = ${candidateId}
    order by d.sort_order, d.key
  `;
  return rows.map((row) => ({
    disqualifierId: row.disqualifier_id,
    disqualifierKey: row.disqualifier_key,
    disqualifierLabel: row.disqualifier_label,
    result: row.result,
    notes: row.notes,
    checkedBy: row.checked_by,
    checkedAt: row.checked_at.toISOString(),
  }));
}

export async function upsertDisqualifierCheck(
  sql: Queryable,
  candidateId: string,
  input: {
    disqualifierId: string;
    result: string;
    notes?: string | null;
    checkedBy: string;
  },
): Promise<void> {
  await sql`
    insert into candidate_disqualifier_checks
      (candidate_id, disqualifier_id, result, notes, checked_by, checked_at)
    values (${candidateId}, ${input.disqualifierId}, ${input.result},
            ${input.notes ?? null}, ${input.checkedBy}, now())
    on conflict (candidate_id, disqualifier_id)
    do update set result = excluded.result, notes = excluded.notes,
                  checked_by = excluded.checked_by, checked_at = excluded.checked_at
  `;
}

interface AssessmentRow {
  id: string;
  provider: string;
  assessment_type: string | null;
  taken_at: Date | null;
  score_summary: Record<string, unknown> | null;
  report_file_id: string | null;
  interpreted_by: string | null;
  interpretation_notes: string | null;
  created_at: Date;
}

export async function listAssessments(
  sql: Queryable,
  candidateId: string,
): Promise<CandidateAssessment[]> {
  const rows = await sql<AssessmentRow[]>`
    select id, provider, assessment_type, taken_at, score_summary,
           report_file_id, interpreted_by, interpretation_notes, created_at
    from candidate_assessments
    where candidate_id = ${candidateId}
    order by created_at desc
  `;
  return rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    assessmentType: row.assessment_type,
    takenAt: iso(row.taken_at),
    scoreSummary: row.score_summary,
    reportFileId: row.report_file_id,
    interpretedBy: row.interpreted_by,
    interpretationNotes: row.interpretation_notes,
    createdAt: row.created_at.toISOString(),
  }));
}

export async function insertAssessment(
  sql: Queryable,
  candidateId: string,
  input: {
    provider: string;
    assessmentType?: string | null;
    takenAt?: string | null;
    scoreSummary?: Record<string, unknown> | null;
    reportFileId?: string | null;
    interpretationNotes?: string | null;
    rawPayload?: Record<string, unknown> | null;
    interpretedBy: string | null;
  },
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into candidate_assessments
      (candidate_id, provider, assessment_type, taken_at, score_summary,
       report_file_id, interpreted_by, interpretation_notes, raw_payload)
    values (${candidateId}, ${input.provider}, ${input.assessmentType ?? null},
            ${input.takenAt ?? null},
            ${
              input.scoreSummary === undefined || input.scoreSummary === null
                ? null
                : sql.json(input.scoreSummary as postgres.JSONValue)
            },
            ${input.reportFileId ?? null},
            ${input.interpretationNotes == null ? null : input.interpretedBy},
            ${input.interpretationNotes ?? null},
            ${
              input.rawPayload === undefined || input.rawPayload === null
                ? null
                : sql.json(input.rawPayload as postgres.JSONValue)
            })
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('assessment insert returned no row');
  return row.id;
}

// ---------------------------------------------------------------------------
// Form submissions and their answers
//
// candidate_answers was write-only until now: nothing in the application read
// it, so every answer to a question outside CANDIDATE_MAPPED_QUESTION_KEYS was
// stored and displayed nowhere. These two functions are the read path.
// ---------------------------------------------------------------------------

export interface CandidateSubmissionRecord {
  id: string;
  formId: string;
  formKey: string;
  formLabel: string;
  formSlug: string;
  versionNumber: number;
  roleCategoryId: string | null;
  roleCategoryKey: string | null;
  roleCategoryLabel: string | null;
  source: string;
  submittedAt: Date;
}

export async function getSubmissionsForCandidate(
  sql: Queryable,
  candidateId: string,
): Promise<CandidateSubmissionRecord[]> {
  const rows = await sql<
    {
      id: string;
      form_id: string;
      form_key: string;
      form_label: string;
      form_slug: string;
      version_number: number;
      role_category_id: string | null;
      role_category_key: string | null;
      role_category_label: string | null;
      source: string;
      submitted_at: Date;
    }[]
  >`
    select s.id, s.form_id, f.key as form_key, f.label as form_label,
           f.slug as form_slug, v.version_number,
           s.role_category_id, rc.key as role_category_key,
           rc.label as role_category_label,
           s.source, s.submitted_at
      from candidate_form_submissions s
      join candidate_forms f on f.id = s.form_id
      join candidate_form_versions v on v.id = s.form_version_id
      left join role_categories rc on rc.id = s.role_category_id
     where s.candidate_id = ${candidateId}
     order by s.submitted_at desc, s.id
  `;
  return rows.map((row) => ({
    id: row.id,
    formId: row.form_id,
    formKey: row.form_key,
    formLabel: row.form_label,
    formSlug: row.form_slug,
    versionNumber: row.version_number,
    roleCategoryId: row.role_category_id,
    roleCategoryKey: row.role_category_key,
    roleCategoryLabel: row.role_category_label,
    source: row.source,
    submittedAt: row.submitted_at,
  }));
}

export interface CandidateAnswerRecord {
  id: string;
  submissionId: string | null;
  questionId: string;
  questionKey: string;
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  valueDate: string | null;
  valueJson: unknown;
  questionSnapshot: Record<string, unknown>;
  answeredBy: string | null;
  createdAt: string;
  updatedAt: string;
  selectedOptions: { value: string; label: string }[];
}

/** Modelled on getAnswersForRequisition, plus submission_id for grouping. */
export async function getAnswersForCandidate(
  sql: Queryable,
  candidateId: string,
): Promise<CandidateAnswerRecord[]> {
  const rows = await sql<
    {
      id: string;
      submission_id: string | null;
      question_id: string;
      question_key: string;
      value_text: string | null;
      value_number: string | null;
      value_boolean: boolean | null;
      value_date: string | null;
      value_json: unknown;
      question_snapshot: Record<string, unknown>;
      answered_by: string | null;
      created_at: Date;
      updated_at: Date;
    }[]
  >`
    select a.id, a.submission_id, a.question_id, a.question_key,
           a.value_text, a.value_number::text as value_number, a.value_boolean,
           a.value_date::text as value_date, a.value_json,
           a.question_snapshot, a.answered_by, a.created_at, a.updated_at
      from candidate_answers a
     where a.candidate_id = ${candidateId}
     order by a.created_at asc, a.id asc
  `;
  const answerIds = rows.map((row) => row.id);
  const optionRows =
    answerIds.length === 0
      ? []
      : await sql<{ answer_id: string; value: string; label: string }[]>`
          select ao.answer_id, o.value, o.label
            from candidate_answer_options ao
            join question_options o on o.id = ao.option_id
           where ao.answer_id in ${sql(answerIds)}
           order by o.sort_order, o.id
        `;
  const optionsByAnswer = new Map<string, { value: string; label: string }[]>();
  for (const option of optionRows) {
    const list = optionsByAnswer.get(option.answer_id) ?? [];
    list.push({ value: option.value, label: option.label });
    optionsByAnswer.set(option.answer_id, list);
  }
  return rows.map((row) => ({
    id: row.id,
    submissionId: row.submission_id,
    questionId: row.question_id,
    questionKey: row.question_key,
    valueText: row.value_text,
    valueNumber: row.value_number === null ? null : Number(row.value_number),
    valueBoolean: row.value_boolean,
    valueDate: row.value_date,
    valueJson: row.value_json,
    questionSnapshot: row.question_snapshot,
    answeredBy: row.answered_by,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    selectedOptions: optionsByAnswer.get(row.id) ?? [],
  }));
}
