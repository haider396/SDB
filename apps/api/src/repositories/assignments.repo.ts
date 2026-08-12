/**
 * SQL for assignments and rejections (docs/02-DATABASE.md §9, docs/04-API.md
 * §9). No business logic — the stage machine, consent gate, actor derivation,
 * and the present/place transactions live in services/assignments.service.ts.
 *
 * ADMIN SURFACE ONLY. These functions join `candidates` and return internal
 * fields; nothing here may ever serve a client-scoped read. Client reads go
 * through repositories/client-visible.repo.ts, which queries the
 * `client_visible_assignments` view exclusively (CLAUDE.md rules 3–4).
 */
import type {
  Assignment,
  AdminAssignmentRow,
  AssignmentStage,
  RejectionActor,
} from '@sdb/contracts';
import type { Queryable } from '../lib/db.js';

const iso = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

// ---------------------------------------------------------------------------
// Row shapes and mapping
// ---------------------------------------------------------------------------

interface AssignmentRowBase {
  id: string;
  requisition_id: string;
  candidate_id: string;
  stage: AssignmentStage;
  presented_at: Date | null;
  client_decision_at: Date | null;
  assigned_by: string;
  presented_by: string | null;
  admin_note: string | null;
  client_note: string | null;
  sort_order: number;
  created_at: Date;
  updated_at: Date;
}

interface AdminAssignmentJoinedRow extends AssignmentRowBase {
  requisition_reference: string;
  client_id: string;
  c_reference: string;
  c_first_name: string;
  c_last_name: string;
  c_display_name: string;
  c_email: string | null;
  c_current_title: string | null;
  c_country: string | null;
  c_seniority_level: AdminAssignmentRow['candidate']['seniorityLevel'];
  c_vetting_status: AdminAssignmentRow['candidate']['vettingStatus'];
  c_recruiter_rating: number | null;
  c_pool_status: AdminAssignmentRow['candidate']['poolStatus'];
  c_data_completeness: AdminAssignmentRow['candidate']['dataCompleteness'];
  c_has_consent_to_share_profile: boolean;
}

function mapAssignment(row: AssignmentRowBase): Assignment {
  return {
    id: row.id,
    requisitionId: row.requisition_id,
    candidateId: row.candidate_id,
    stage: row.stage,
    presentedAt: iso(row.presented_at),
    clientDecisionAt: iso(row.client_decision_at),
    assignedBy: row.assigned_by,
    presentedBy: row.presented_by,
    adminNote: row.admin_note,
    clientNote: row.client_note,
    sortOrder: row.sort_order,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function mapAdminRow(row: AdminAssignmentJoinedRow): AdminAssignmentRow {
  return {
    ...mapAssignment(row),
    requisitionReference: row.requisition_reference,
    clientId: row.client_id,
    candidate: {
      id: row.candidate_id,
      reference: row.c_reference,
      firstName: row.c_first_name,
      lastName: row.c_last_name,
      displayName: row.c_display_name,
      email: row.c_email,
      currentTitle: row.c_current_title,
      country: row.c_country,
      seniorityLevel: row.c_seniority_level,
      vettingStatus: row.c_vetting_status,
      recruiterRating: row.c_recruiter_rating,
      poolStatus: row.c_pool_status,
      dataCompleteness: row.c_data_completeness,
      hasConsentToShareProfile: row.c_has_consent_to_share_profile,
    },
  };
}

const ADMIN_ROW_COLUMNS = `
  a.id, a.requisition_id, a.candidate_id, a.stage,
  a.presented_at, a.client_decision_at, a.assigned_by, a.presented_by,
  a.admin_note, a.client_note, a.sort_order, a.created_at, a.updated_at,
  r.reference as requisition_reference, r.client_id,
  c.reference as c_reference, c.first_name as c_first_name,
  c.last_name as c_last_name, c.display_name as c_display_name,
  c.email::text as c_email, c.current_title as c_current_title,
  c.country as c_country, c.seniority_level as c_seniority_level,
  c.vetting_status as c_vetting_status, c.recruiter_rating as c_recruiter_rating,
  c.pool_status as c_pool_status, c.data_completeness as c_data_completeness,
  c.has_consent_to_share_profile as c_has_consent_to_share_profile
`;

// ---------------------------------------------------------------------------
// Reads (admin)
// ---------------------------------------------------------------------------

export async function findAdminAssignmentById(
  sql: Queryable,
  assignmentId: string,
): Promise<AdminAssignmentRow | null> {
  const rows = await sql<AdminAssignmentJoinedRow[]>`
    select ${sql.unsafe(ADMIN_ROW_COLUMNS)}
    from assignments a
    join requisitions r on r.id = a.requisition_id
    join candidates c on c.id = a.candidate_id
    where a.id = ${assignmentId}
  `;
  const row = rows[0];
  return row === undefined ? null : mapAdminRow(row);
}

export async function listAdminAssignmentsForRequisition(
  sql: Queryable,
  requisitionId: string,
): Promise<AdminAssignmentRow[]> {
  const rows = await sql<AdminAssignmentJoinedRow[]>`
    select ${sql.unsafe(ADMIN_ROW_COLUMNS)}
    from assignments a
    join requisitions r on r.id = a.requisition_id
    join candidates c on c.id = a.candidate_id
    where a.requisition_id = ${requisitionId}
    order by a.sort_order asc, a.created_at asc, a.id asc
  `;
  return rows.map(mapAdminRow);
}

/**
 * Consent + do-not-present flags for a candidate batch — the inputs to the
 * assign/present validations (J4/J5). Order of the result is unspecified.
 */
export interface CandidatePresentabilityRecord {
  id: string;
  hasConsentToShareProfile: boolean;
  doNotPresentToClientIds: string[];
  archivedAt: string | null;
}

export async function getCandidatePresentability(
  sql: Queryable,
  candidateIds: string[],
): Promise<CandidatePresentabilityRecord[]> {
  if (candidateIds.length === 0) return [];
  const rows = await sql<
    {
      id: string;
      has_consent_to_share_profile: boolean;
      do_not_present_to_client_ids: string[];
      archived_at: Date | null;
    }[]
  >`
    select id, has_consent_to_share_profile,
           do_not_present_to_client_ids::text[] as do_not_present_to_client_ids,
           archived_at
    from candidates
    where id in ${sql(candidateIds)}
  `;
  return rows.map((row) => ({
    id: row.id,
    hasConsentToShareProfile: row.has_consent_to_share_profile,
    doNotPresentToClientIds: row.do_not_present_to_client_ids,
    archivedAt: iso(row.archived_at),
  }));
}

/**
 * Which of the given candidates are already assigned to this requisition —
 * the friendly pre-check behind 409 DUPLICATE_ASSIGNMENT (AC-PL-03). The
 * unique constraint remains the authority; a race between the check and the
 * insert still surfaces as SQLSTATE 23505 and maps to the same error.
 */
export async function findExistingAssignmentCandidateIds(
  sql: Queryable,
  requisitionId: string,
  candidateIds: string[],
): Promise<string[]> {
  if (candidateIds.length === 0) return [];
  const rows = await sql<{ candidate_id: string }[]>`
    select candidate_id
    from assignments
    where requisition_id = ${requisitionId}
      and candidate_id in ${sql(candidateIds)}
  `;
  return rows.map((row) => row.candidate_id);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface InsertAssignmentInput {
  requisitionId: string;
  candidateId: string;
  assignedBy: string;
  adminNote: string | null;
}

/**
 * Insert at `sourced`. A duplicate (requisition_id, candidate_id) violates
 * the unique constraint — SQLSTATE 23505 — which the service maps to
 * 409 DUPLICATE_ASSIGNMENT (AC-PL-03).
 */
export async function insertAssignment(
  sql: Queryable,
  input: InsertAssignmentInput,
): Promise<Assignment> {
  const rows = await sql<AssignmentRowBase[]>`
    insert into assignments (requisition_id, candidate_id, assigned_by, admin_note)
    values (${input.requisitionId}, ${input.candidateId}, ${input.assignedBy},
            ${input.adminNote})
    returning id, requisition_id, candidate_id, stage, presented_at,
              client_decision_at, assigned_by, presented_by, admin_note,
              client_note, sort_order, created_at, updated_at
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('assignment insert returned no row');
  return mapAssignment(row);
}

/**
 * Stage write — called ONLY by the service's transition paths, which have
 * already validated the move against ASSIGNMENT_TRANSITIONS (06 §2.2). The
 * compare-and-set on `stage` makes concurrent transitions safe: the loser
 * matches zero rows and the service raises INVALID_TRANSITION.
 */
export async function writeAssignmentStage(
  sql: Queryable,
  assignmentId: string,
  fromStage: AssignmentStage,
  toStage: AssignmentStage,
  stamps: {
    /** Set presented_at/presented_by (first presentation wins). */
    presentedBy?: string;
    /** Stamp client_decision_at = now(). */
    clientDecisionAt?: boolean;
    /** Overwrite client_note alongside the stage write (present flow). */
    clientNote?: string;
  } = {},
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update assignments
    set stage = ${toStage},
        updated_at = now()
        ${
          stamps.presentedBy === undefined
            ? sql``
            : sql`, presented_at = coalesce(presented_at, now()),
                   presented_by = coalesce(presented_by, ${stamps.presentedBy})`
        }
        ${stamps.clientDecisionAt === true ? sql`, client_decision_at = now()` : sql``}
        ${stamps.clientNote === undefined ? sql`` : sql`, client_note = ${stamps.clientNote}`}
    where id = ${assignmentId}
      and stage = ${fromStage}
    returning id
  `;
  return rows.length > 0;
}

export interface AssignmentPatch {
  adminNote?: string | null;
  clientNote?: string | null;
  sortOrder?: number;
}

export async function updateAssignment(
  sql: Queryable,
  assignmentId: string,
  patch: AssignmentPatch,
): Promise<boolean> {
  const assignments: Record<string, unknown> = {};
  if (patch.adminNote !== undefined) assignments['admin_note'] = patch.adminNote;
  if (patch.clientNote !== undefined) assignments['client_note'] = patch.clientNote;
  if (patch.sortOrder !== undefined) assignments['sort_order'] = patch.sortOrder;
  if (Object.keys(assignments).length === 0) return true;
  const rows = await sql<{ id: string }[]>`
    update assignments
    set ${sql(assignments)}, updated_at = now()
    where id = ${assignmentId}
    returning id
  `;
  return rows.length > 0;
}

/**
 * The placement flow's sibling sweep (J8): every other assignment on the
 * requisition still at a non-terminal stage. Locked `for update` so the
 * subsequent per-row CAS writes cannot race a concurrent transition.
 */
export async function listSiblingsForPlacement(
  sql: Queryable,
  requisitionId: string,
  placedAssignmentId: string,
  nonTerminalStages: AssignmentStage[],
): Promise<{ id: string; stage: AssignmentStage; candidateId: string }[]> {
  const rows = await sql<
    { id: string; stage: AssignmentStage; candidate_id: string }[]
  >`
    select id, stage, candidate_id
    from assignments
    where requisition_id = ${requisitionId}
      and id <> ${placedAssignmentId}
      and stage in ${sql(nonTerminalStages)}
    order by created_at asc, id asc
    for update
  `;
  return rows.map((row) => ({
    id: row.id,
    stage: row.stage,
    candidateId: row.candidate_id,
  }));
}

/** Candidate pool_status write for the placement flow (J8 step 4). */
export async function setCandidatePoolStatus(
  sql: Queryable,
  candidateId: string,
  poolStatus: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update candidates
    set pool_status = ${poolStatus}::pool_status, updated_at = now()
    where id = ${candidateId}
    returning id
  `;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Rejections (02 §9)
// ---------------------------------------------------------------------------

export interface RejectionReasonRecord {
  id: string;
  key: string;
  label: string;
  actor: RejectionActor;
  isActive: boolean;
}

export async function findRejectionReasonById(
  sql: Queryable,
  reasonId: string,
): Promise<RejectionReasonRecord | null> {
  const rows = await sql<
    { id: string; key: string; label: string; actor: RejectionActor; is_active: boolean }[]
  >`
    select id, key, label, actor, is_active
    from rejection_reasons
    where id = ${reasonId}
  `;
  const row = rows[0];
  return row === undefined
    ? null
    : {
        id: row.id,
        key: row.key,
        label: row.label,
        actor: row.actor,
        isActive: row.is_active,
      };
}

export interface InsertRejectionInput {
  assignmentId: string;
  actor: RejectionActor;
  rejectedBy: string;
  reasonId: string | null;
  reasonOther: string | null;
  detail: string | null;
}

export async function insertRejection(
  sql: Queryable,
  input: InsertRejectionInput,
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into rejections (assignment_id, actor, rejected_by, reason_id, reason_other, detail)
    values (${input.assignmentId}, ${input.actor}, ${input.rejectedBy},
            ${input.reasonId}, ${input.reasonOther}, ${input.detail})
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('rejection insert returned no row');
  return row.id;
}
