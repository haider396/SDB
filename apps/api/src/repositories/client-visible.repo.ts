/**
 * CLIENT-SCOPED candidate reads (docs/02-DATABASE.md §11, docs/06-BACKEND.md
 * §3). Every function here queries the `client_visible_assignments` view —
 * never the `candidates` table — so the presented-stage gate and the PII
 * nulling are enforced by SQL, not by application code (CLAUDE.md rules 3–4).
 *
 * Every function takes `clientId` as a required first parameter; there is no
 * variant without it (06 §3). The view already restricts rows to the eight
 * client-visible stages, and emits NULL for the gated PII columns until the
 * stage reaches interview_scheduled; the tenant filter is applied here on the
 * view's own client_id column.
 *
 * The only base-table touch is `candidate_files ... where is_client_visible`
 * — the documented companion filter for client file references (02 §11),
 * joined against the view so only client-visibly assigned candidates' files
 * can ever be listed.
 */
import type {
  AccentStrength,
  AutonomyLevel,
  ClientVisibleAssignment,
  ClientVisibleFileRef,
  EngagementType,
  LanguageLevel,
  SeniorityLevel,
} from '@sdb/contracts';
import type { Queryable } from '../lib/db.js';

const iso = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();
const num = (value: string | null): number | null =>
  value === null ? null : Number(value);

interface ViewRow {
  assignment_id: string;
  requisition_id: string;
  stage: ClientVisibleAssignment['stage'];
  presented_at: Date | null;
  interview_requested_at: Date | null;
  rejection_reason_label: string | null;
  rejection_detail: string | null;
  client_note: string | null;
  client_id: string;
  candidate_id: string;
  reference: string;
  display_name: string;
  photo_path: string | null;
  country: string | null;
  region_state: string | null;
  city: string | null;
  timezone: string | null;
  english_spoken_level: LanguageLevel | null;
  english_written_level: LanguageLevel | null;
  accent_strength: AccentStrength | null;
  years_experience_total: string | null;
  years_experience_relevant: string | null;
  current_title: string | null;
  seniority_level: SeniorityLevel | null;
  has_management_experience: boolean | null;
  team_size_managed: number | null;
  has_client_facing_experience: boolean | null;
  has_us_client_experience: boolean | null;
  remote_experience_years: string | null;
  available_from: string | null;
  engagement_types: string[] | null;
  hours_available_per_week: number | null;
  overlap_start: string | null;
  overlap_end: string | null;
  overlap_timezone: string | null;
  autonomy: AutonomyLevel | null;
  can_manage_up: boolean | null;
  recruiter_recommendation: string | null;
  strengths: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  whatsapp: string | null;
  linkedin_url: string | null;
  current_employer: string | null;
}

/** View row → API shape; `files` are attached by the callers below. */
function mapViewRow(
  row: ViewRow,
  files: ClientVisibleFileRef[],
): ClientVisibleAssignment {
  return {
    assignmentId: row.assignment_id,
    requisitionId: row.requisition_id,
    stage: row.stage,
    presentedAt: iso(row.presented_at),
    interviewRequestedAt: iso(row.interview_requested_at),
    rejectionReasonLabel: row.rejection_reason_label,
    rejectionDetail: row.rejection_detail,
    clientNote: row.client_note,
    clientId: row.client_id,
    candidateId: row.candidate_id,
    reference: row.reference,
    displayName: row.display_name,
    photoPath: row.photo_path,
    // Signed at read time by the service (lib/photo-urls.ts) — the repo has
    // no storage access on purpose.
    photoUrl: null,
    country: row.country,
    regionState: row.region_state,
    city: row.city,
    timezone: row.timezone,
    englishSpokenLevel: row.english_spoken_level,
    englishWrittenLevel: row.english_written_level,
    accentStrength: row.accent_strength,
    yearsExperienceTotal: num(row.years_experience_total),
    yearsExperienceRelevant: num(row.years_experience_relevant),
    currentTitle: row.current_title,
    seniorityLevel: row.seniority_level,
    hasManagementExperience: row.has_management_experience,
    teamSizeManaged: row.team_size_managed,
    hasClientFacingExperience: row.has_client_facing_experience,
    hasUsClientExperience: row.has_us_client_experience,
    remoteExperienceYears: num(row.remote_experience_years),
    availableFrom: row.available_from,
    engagementTypes: (row.engagement_types ?? null) as EngagementType[] | null,
    hoursAvailablePerWeek: row.hours_available_per_week,
    overlapStart: row.overlap_start,
    overlapEnd: row.overlap_end,
    overlapTimezone: row.overlap_timezone,
    autonomy: row.autonomy,
    canManageUp: row.can_manage_up,
    recruiterRecommendation: row.recruiter_recommendation,
    strengths: row.strengths,
    firstName: row.first_name,
    lastName: row.last_name,
    email: row.email,
    phone: row.phone,
    whatsapp: row.whatsapp,
    linkedinUrl: row.linkedin_url,
    currentEmployer: row.current_employer,
    files,
  };
}

/**
 * Decision-state companions (UX 3.2), computed alongside the view row:
 * - `interview_requested_at`: the latest `interview_requested` event for the
 *   assignment (the client's request leaves no column, only an event)
 * - rejection reason/detail: from the latest CLIENT-actor rejections row —
 *   `rj.actor = 'client'` is a hard filter, so admin rejection internals can
 *   never surface here, and the stage CASE keeps both null on every stage
 *   except `rejected_by_client` (defence in depth; the view only shows
 *   clients that stage for client rejections anyway).
 */
const DECISION_STATE_SELECT = `
  ir.interview_requested_at,
  case when cva.stage = 'rejected_by_client'
       then rej.rejection_reason_label end as rejection_reason_label,
  case when cva.stage = 'rejected_by_client'
       then rej.rejection_detail end as rejection_detail
`;

const DECISION_STATE_JOINS = `
  left join lateral (
    select max(e.occurred_at) as interview_requested_at
    from events e
    where e.entity_type = 'assignment'
      and e.entity_id = cva.assignment_id
      and e.event_type = 'interview_requested'
  ) ir on true
  left join lateral (
    select coalesce(rr.label, rj.reason_other) as rejection_reason_label,
           rj.detail as rejection_detail
    from rejections rj
    left join rejection_reasons rr on rr.id = rj.reason_id
    where rj.assignment_id = cva.assignment_id
      and rj.actor = 'client'
    order by rj.created_at desc, rj.id desc
    limit 1
  ) rej on true
`;

const VIEW_COLUMNS = `
  assignment_id, requisition_id, stage, presented_at, client_note, client_id,
  candidate_id, reference, display_name, photo_path, country, region_state,
  city, timezone, english_spoken_level, english_written_level, accent_strength,
  years_experience_total::text as years_experience_total,
  years_experience_relevant::text as years_experience_relevant,
  current_title, seniority_level, has_management_experience, team_size_managed,
  has_client_facing_experience, has_us_client_experience,
  remote_experience_years::text as remote_experience_years,
  available_from::text as available_from,
  engagement_types::text[] as engagement_types, hours_available_per_week,
  overlap_start::text as overlap_start, overlap_end::text as overlap_end,
  overlap_timezone, autonomy, can_manage_up, recruiter_recommendation, strengths,
  first_name, last_name, email, phone, whatsapp, linkedin_url, current_employer
`;

interface ClientFileRow {
  id: string;
  candidate_id: string;
  file_type: ClientVisibleFileRef['fileType'];
  original_filename: string;
  mime_type: string;
  size_bytes: string;
}

/**
 * Client-visible, upload-confirmed file refs for the given candidates —
 * restricted to candidates that actually have a client-visible assignment to
 * this client, so a stray candidateId cannot leak files across the gate.
 */
async function listClientVisibleFiles(
  sql: Queryable,
  clientId: string,
  candidateIds: string[],
): Promise<Map<string, ClientVisibleFileRef[]>> {
  const byCandidate = new Map<string, ClientVisibleFileRef[]>();
  if (candidateIds.length === 0) return byCandidate;
  const rows = await sql<ClientFileRow[]>`
    select f.id, f.candidate_id, f.file_type, f.original_filename,
           f.mime_type, f.size_bytes::text as size_bytes
    from candidate_files f
    where f.candidate_id in ${sql(candidateIds)}
      and f.is_client_visible = true
      and f.virus_scan_status = 'complete'
      and exists (
        select 1 from client_visible_assignments cva
        where cva.candidate_id = f.candidate_id
          and cva.client_id = ${clientId}
      )
    order by f.uploaded_at asc, f.id asc
  `;
  for (const row of rows) {
    const list = byCandidate.get(row.candidate_id) ?? [];
    list.push({
      id: row.id,
      fileType: row.file_type,
      originalFilename: row.original_filename,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes),
    });
    byCandidate.set(row.candidate_id, list);
  }
  return byCandidate;
}

/**
 * All client-visible assignments of one requisition, for the caller's own
 * client. Internal stages are structurally absent — the view's WHERE clause
 * excludes them before this query ever runs (AC-PL-07).
 */
export async function listClientVisibleAssignments(
  sql: Queryable,
  clientId: string,
  requisitionId: string,
): Promise<ClientVisibleAssignment[]> {
  const rows = await sql<ViewRow[]>`
    select ${sql.unsafe(VIEW_COLUMNS)}, ${sql.unsafe(DECISION_STATE_SELECT)}
    from client_visible_assignments cva
    ${sql.unsafe(DECISION_STATE_JOINS)}
    where client_id = ${clientId}
      and requisition_id = ${requisitionId}
    order by presented_at asc nulls last, assignment_id asc
  `;
  const files = await listClientVisibleFiles(
    sql,
    clientId,
    [...new Set(rows.map((row) => row.candidate_id))],
  );
  return rows.map((row) => mapViewRow(row, files.get(row.candidate_id) ?? []));
}

/**
 * One assignment through the view, tenant-filtered. Null covers everything a
 * client must not distinguish: nonexistent id, another tenant's assignment,
 * and a stage outside the client-visible eight — all surface as 404.
 */
export async function findClientVisibleAssignment(
  sql: Queryable,
  clientId: string,
  assignmentId: string,
): Promise<ClientVisibleAssignment | null> {
  const rows = await sql<ViewRow[]>`
    select ${sql.unsafe(VIEW_COLUMNS)}, ${sql.unsafe(DECISION_STATE_SELECT)}
    from client_visible_assignments cva
    ${sql.unsafe(DECISION_STATE_JOINS)}
    where client_id = ${clientId}
      and assignment_id = ${assignmentId}
  `;
  const row = rows[0];
  if (row === undefined) return null;
  const files = await listClientVisibleFiles(sql, clientId, [row.candidate_id]);
  return mapViewRow(row, files.get(row.candidate_id) ?? []);
}
