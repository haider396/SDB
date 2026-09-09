/**
 * SQL for the requisition lifecycle (docs/02-DATABASE.md §7, docs/04-API.md
 * §7). No business logic — the state machine, principal identity rule, and
 * commercials gating live in services/requisitions.service.ts.
 */
import type postgres from 'postgres';
import type {
  EngagementType,
  RateUnit,
  RequisitionPriority,
  RequisitionStatus,
  SeniorityLevel,
  ServiceTier,
  UserRoleKey,
} from '@sdb/contracts';
import type { Queryable } from '../lib/db.js';
import { resolvePublicId } from './public-ids.repo.js';

function jsonb(sql: Queryable, value: unknown): postgres.Parameter {
  return sql.json(value as postgres.JSONValue);
}

// ---------------------------------------------------------------------------
// Row shapes and mapping
// ---------------------------------------------------------------------------

/** Full internal record — commercials included; the service strips them. */
export interface RequisitionRecord {
  id: string;
  publicId: string;
  reference: string;
  clientId: string;
  clientName: string;
  engineId: string | null;
  departmentId: string | null;
  roleCategoryId: string | null;
  advertisedTitle: string | null;
  headcount: number;
  status: RequisitionStatus;
  seniorityLevel: SeniorityLevel | null;
  engagementType: EngagementType | null;
  hoursPerWeek: number | null;
  startsPartTime: boolean | null;
  fullTimeTransitionAfter: string | null;
  overlapStart: string | null;
  overlapEnd: string | null;
  overlapTimezone: string | null;
  targetStartDate: string | null;
  urgency: string | null;
  /** SDB's ranking (0030). Distinct from `urgency`, the client's own answer. */
  priority: RequisitionPriority;
  regionPreference: string | null;
  briefMarkdown: string | null;
  jobDescription: string | null;
  roleDescription: string | null;
  principalUserId: string | null;
  principalApprovedAt: string | null;
  principalChangeRequest: string | null;
  intakeContactName: string | null;
  intakeContactEmail: string | null;
  submittedAt: string;
  sourcingStartedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Commercial fields (gated at the service layer — AC-RQ-06)
  budgetMin: number | null;
  budgetMax: number | null;
  budgetUnit: RateUnit | null;
  budgetCurrency: string | null;
  budgetIsFlexible: boolean | null;
  serviceTier: ServiceTier | null;
}

interface RequisitionRow {
  id: string;
  public_id: string;
  reference: string;
  client_id: string;
  client_name: string;
  engine_id: string | null;
  department_id: string | null;
  role_category_id: string | null;
  advertised_title: string | null;
  headcount: number;
  status: RequisitionStatus;
  seniority_level: SeniorityLevel | null;
  engagement_type: EngagementType | null;
  hours_per_week: number | null;
  starts_part_time: boolean | null;
  full_time_transition_after: string | null;
  overlap_start: string | null;
  overlap_end: string | null;
  overlap_timezone: string | null;
  target_start_date: string | null;
  urgency: string | null;
  priority: RequisitionPriority;
  region_preference: string | null;
  brief_markdown: string | null;
  job_description: string | null;
  role_description: string | null;
  principal_user_id: string | null;
  principal_approved_at: Date | null;
  principal_change_request: string | null;
  intake_contact_name: string | null;
  intake_contact_email: string | null;
  submitted_at: Date;
  sourcing_started_at: Date | null;
  closed_at: Date | null;
  created_at: Date;
  updated_at: Date;
  budget_min: string | null;
  budget_max: string | null;
  budget_unit: RateUnit | null;
  budget_currency: string | null;
  budget_is_flexible: boolean | null;
  service_tier: ServiceTier | null;
}

const iso = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();
const num = (value: string | null): number | null =>
  value === null ? null : Number(value);

function mapRequisition(row: RequisitionRow): RequisitionRecord {
  return {
    id: row.id,
    publicId: row.public_id,
    reference: row.reference,
    clientId: row.client_id,
    clientName: row.client_name,
    engineId: row.engine_id,
    departmentId: row.department_id,
    roleCategoryId: row.role_category_id,
    advertisedTitle: row.advertised_title,
    headcount: row.headcount,
    status: row.status,
    seniorityLevel: row.seniority_level,
    engagementType: row.engagement_type,
    hoursPerWeek: row.hours_per_week,
    startsPartTime: row.starts_part_time,
    fullTimeTransitionAfter: row.full_time_transition_after,
    overlapStart: row.overlap_start,
    overlapEnd: row.overlap_end,
    overlapTimezone: row.overlap_timezone,
    targetStartDate: row.target_start_date,
    urgency: row.urgency,
    priority: row.priority,
    regionPreference: row.region_preference,
    briefMarkdown: row.brief_markdown,
    jobDescription: row.job_description,
    roleDescription: row.role_description,
    principalUserId: row.principal_user_id,
    principalApprovedAt: iso(row.principal_approved_at),
    principalChangeRequest: row.principal_change_request,
    intakeContactName: row.intake_contact_name,
    intakeContactEmail: row.intake_contact_email,
    submittedAt: row.submitted_at.toISOString(),
    sourcingStartedAt: iso(row.sourcing_started_at),
    closedAt: iso(row.closed_at),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    budgetMin: num(row.budget_min),
    budgetMax: num(row.budget_max),
    budgetUnit: row.budget_unit,
    budgetCurrency: row.budget_currency,
    budgetIsFlexible: row.budget_is_flexible,
    serviceTier: row.service_tier,
  };
}

const REQUISITION_COLUMNS = `
  r.id, r.public_id, r.reference, r.client_id, c.company_name as client_name,
  r.engine_id, r.department_id, r.role_category_id,
  r.advertised_title, r.headcount, r.status,
  r.seniority_level, r.engagement_type, r.hours_per_week,
  r.overlap_start::text as overlap_start, r.overlap_end::text as overlap_end,
  r.overlap_timezone,
  r.target_start_date::text as target_start_date, r.urgency, r.priority,
  r.region_preference,
  r.brief_markdown, r.job_description, r.role_description,
  r.starts_part_time, r.full_time_transition_after,
  r.principal_user_id, r.principal_approved_at,
  r.principal_change_request, r.intake_contact_name, r.intake_contact_email,
  r.submitted_at, r.sourcing_started_at, r.closed_at, r.created_at, r.updated_at,
  r.budget_min::text as budget_min, r.budget_max::text as budget_max,
  r.budget_unit, r.budget_currency, r.budget_is_flexible, r.service_tier
`;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ListRequisitionsFilters {
  /** Mandatory tenant filter for client-scoped callers (04 §1.3). */
  clientId?: string;
  status?: RequisitionStatus;
  engineId?: string;
  roleCategoryId?: string;
  search?: string;
  limit: number;
  cursor?: { createdAt: string; id: string };
}

/**
 * `total` is the full filtered count via `count(*) over ()` — accurate only
 * when no cursor predicate narrows the window (the service surfaces it on
 * first pages only, UX 2.9). 0 when the page is empty.
 */
export async function listRequisitions(
  sql: Queryable,
  filters: ListRequisitionsFilters,
): Promise<{ data: RequisitionRecord[]; total: number }> {
  const rows = await sql<(RequisitionRow & { total: string })[]>`
    select ${sql.unsafe(REQUISITION_COLUMNS)}, count(*) over ()::text as total
    from requisitions r
    join clients c on c.id = r.client_id
    where r.archived_at is null
      ${filters.clientId === undefined ? sql`` : sql`and r.client_id = ${filters.clientId}`}
      ${filters.status === undefined ? sql`` : sql`and r.status = ${filters.status}`}
      ${filters.engineId === undefined ? sql`` : sql`and r.engine_id = ${filters.engineId}`}
      ${
        filters.roleCategoryId === undefined
          ? sql``
          : sql`and r.role_category_id = ${filters.roleCategoryId}`
      }
      ${
        filters.search === undefined
          ? sql``
          : sql`and (r.reference ilike ${'%' + filters.search + '%'}
                 or r.advertised_title ilike ${'%' + filters.search + '%'}
                 or c.company_name ilike ${'%' + filters.search + '%'})`
      }
      ${
        filters.cursor === undefined
          ? sql``
          : sql`and (r.created_at, r.id) < (${filters.cursor.createdAt}::timestamptz, ${filters.cursor.id}::uuid)`
      }
    order by r.created_at desc, r.id desc
    limit ${filters.limit}
  `;
  return {
    data: rows.map(mapRequisition),
    total: Number(rows[0]?.total ?? '0'),
  };
}

/**
 * Single requisition; `clientId` (when given) is the mandatory tenant filter —
 * a cross-tenant id yields null, surfacing as 404 (04 §1.3).
 * `requisitionRef` is a uuid OR a public_id (0015) — resolved here.
 */
export async function findRequisitionById(
  sql: Queryable,
  requisitionRef: string,
  clientId?: string,
): Promise<RequisitionRecord | null> {
  const requisitionId = await resolvePublicId(sql, 'requisitions', requisitionRef);
  if (requisitionId === null) return null;
  const rows = await sql<RequisitionRow[]>`
    select ${sql.unsafe(REQUISITION_COLUMNS)}
    from requisitions r
    join clients c on c.id = r.client_id
    where r.id = ${requisitionId}
      and r.archived_at is null
      ${clientId === undefined ? sql`` : sql`and r.client_id = ${clientId}`}
  `;
  const row = rows[0];
  return row === undefined ? null : mapRequisition(row);
}

export interface TaxonomyLabelRecord {
  id: string;
  key: string;
  label: string;
}

export interface RequisitionTaxonomyLabels {
  engine: TaxonomyLabelRecord | null;
  department: TaxonomyLabelRecord | null;
  roleCategory: TaxonomyLabelRecord | null;
}

export async function getTaxonomyLabels(
  sql: Queryable,
  ids: {
    engineId: string | null;
    departmentId: string | null;
    roleCategoryId: string | null;
  },
): Promise<RequisitionTaxonomyLabels> {
  const pick = async (
    table: 'engines' | 'departments' | 'role_categories',
    id: string | null,
  ): Promise<TaxonomyLabelRecord | null> => {
    if (id === null) return null;
    const rows =
      table === 'engines'
        ? await sql<TaxonomyLabelRecord[]>`select id, key, label from engines where id = ${id}`
        : table === 'departments'
          ? await sql<TaxonomyLabelRecord[]>`select id, key, label from departments where id = ${id}`
          : await sql<TaxonomyLabelRecord[]>`select id, key, label from role_categories where id = ${id}`;
    return rows[0] ?? null;
  };
  const [engine, department, roleCategory] = await Promise.all([
    pick('engines', ids.engineId),
    pick('departments', ids.departmentId),
    pick('role_categories', ids.roleCategoryId),
  ]);
  return { engine, department, roleCategory };
}

// ---------------------------------------------------------------------------
// Answers (detail read + upsert)
// ---------------------------------------------------------------------------

export interface StoredAnswerRecord {
  id: string;
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

interface AnswerRow {
  id: string;
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
}

export async function getAnswersForRequisition(
  sql: Queryable,
  requisitionId: string,
): Promise<StoredAnswerRecord[]> {
  const rows = await sql<AnswerRow[]>`
    select a.id, a.question_id, a.question_key,
           a.value_text, a.value_number::text as value_number, a.value_boolean,
           a.value_date::text as value_date, a.value_json,
           a.question_snapshot, a.answered_by, a.created_at, a.updated_at
    from requisition_answers a
    where a.requisition_id = ${requisitionId}
    order by a.created_at asc, a.id asc
  `;
  const answerIds = rows.map((row) => row.id);
  const optionRows =
    answerIds.length === 0
      ? []
      : await sql<{ answer_id: string; value: string; label: string }[]>`
          select ao.answer_id, o.value, o.label
          from requisition_answer_options ao
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
    questionId: row.question_id,
    questionKey: row.question_key,
    valueText: row.value_text,
    valueNumber: num(row.value_number),
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

export interface UpsertAnswerInput {
  requisitionId: string;
  questionId: string;
  questionKey: string;
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  valueDate: string | null;
  valueJson: unknown;
  questionSnapshot: Record<string, unknown>;
  answeredBy: string | null;
}

/** Insert-or-update on (requisition_id, question_id); snapshot refreshed. */
export async function upsertAnswer(
  sql: Queryable,
  input: UpsertAnswerInput,
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into requisition_answers (
      requisition_id, question_id, question_key,
      value_text, value_number, value_boolean, value_date, value_json,
      question_snapshot, answered_by
    ) values (
      ${input.requisitionId}, ${input.questionId}, ${input.questionKey},
      ${input.valueText}, ${input.valueNumber}, ${input.valueBoolean},
      ${input.valueDate}::date,
      ${input.valueJson === null || input.valueJson === undefined ? null : jsonb(sql, input.valueJson)},
      ${jsonb(sql, input.questionSnapshot)}, ${input.answeredBy}
    )
    on conflict (requisition_id, question_id) do update set
      value_text = excluded.value_text,
      value_number = excluded.value_number,
      value_boolean = excluded.value_boolean,
      value_date = excluded.value_date,
      value_json = excluded.value_json,
      question_snapshot = excluded.question_snapshot,
      answered_by = excluded.answered_by,
      updated_at = now()
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('answer upsert returned no row');
  return row.id;
}

export async function replaceAnswerOptions(
  sql: Queryable,
  answerId: string,
  optionIds: string[],
): Promise<void> {
  await sql`delete from requisition_answer_options where answer_id = ${answerId}`;
  for (const optionId of optionIds) {
    await sql`
      insert into requisition_answer_options (answer_id, option_id)
      values (${answerId}, ${optionId})
    `;
  }
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface RequisitionPatch {
  advertisedTitle?: string | null;
  briefMarkdown?: string | null;
  jobDescription?: string | null;
  roleDescription?: string | null;
  headcount?: number;
  budgetMin?: number | null;
  budgetMax?: number | null;
  budgetUnit?: RateUnit | null;
  budgetCurrency?: string | null;
  budgetIsFlexible?: boolean | null;
  serviceTier?: ServiceTier | null;
  seniorityLevel?: SeniorityLevel | null;
  engagementType?: EngagementType | null;
  hoursPerWeek?: number | null;
  startsPartTime?: boolean | null;
  fullTimeTransitionAfter?: string | null;
  overlapStart?: string | null;
  overlapEnd?: string | null;
  overlapTimezone?: string | null;
  targetStartDate?: string | null;
  urgency?: string | null;
  priority?: RequisitionPriority;
  regionPreference?: string | null;
  principalUserId?: string | null;
}

export async function updateRequisition(
  sql: Queryable,
  requisitionId: string,
  patch: RequisitionPatch,
): Promise<boolean> {
  const assignments: Record<string, unknown> = {};
  if (patch.advertisedTitle !== undefined) assignments['advertised_title'] = patch.advertisedTitle;
  if (patch.briefMarkdown !== undefined) assignments['brief_markdown'] = patch.briefMarkdown;
  if (patch.jobDescription !== undefined) assignments['job_description'] = patch.jobDescription;
  if (patch.roleDescription !== undefined) assignments['role_description'] = patch.roleDescription;
  if (patch.headcount !== undefined) assignments['headcount'] = patch.headcount;
  if (patch.budgetMin !== undefined) assignments['budget_min'] = patch.budgetMin;
  if (patch.budgetMax !== undefined) assignments['budget_max'] = patch.budgetMax;
  if (patch.budgetUnit !== undefined) assignments['budget_unit'] = patch.budgetUnit;
  if (patch.budgetCurrency !== undefined) assignments['budget_currency'] = patch.budgetCurrency;
  if (patch.budgetIsFlexible !== undefined) {
    assignments['budget_is_flexible'] = patch.budgetIsFlexible;
  }
  if (patch.serviceTier !== undefined) assignments['service_tier'] = patch.serviceTier;
  if (patch.seniorityLevel !== undefined) assignments['seniority_level'] = patch.seniorityLevel;
  if (patch.engagementType !== undefined) assignments['engagement_type'] = patch.engagementType;
  if (patch.hoursPerWeek !== undefined) assignments['hours_per_week'] = patch.hoursPerWeek;
  if (patch.startsPartTime !== undefined) assignments['starts_part_time'] = patch.startsPartTime;
  if (patch.fullTimeTransitionAfter !== undefined) assignments['full_time_transition_after'] = patch.fullTimeTransitionAfter;
  if (patch.overlapStart !== undefined) assignments['overlap_start'] = patch.overlapStart;
  if (patch.overlapEnd !== undefined) assignments['overlap_end'] = patch.overlapEnd;
  if (patch.overlapTimezone !== undefined) {
    assignments['overlap_timezone'] = patch.overlapTimezone;
  }
  if (patch.targetStartDate !== undefined) assignments['target_start_date'] = patch.targetStartDate;
  if (patch.urgency !== undefined) assignments['urgency'] = patch.urgency;
  if (patch.priority !== undefined) assignments['priority'] = patch.priority;
  if (patch.regionPreference !== undefined) assignments['region_preference'] = patch.regionPreference;
  if (patch.principalUserId !== undefined) assignments['principal_user_id'] = patch.principalUserId;
  if (Object.keys(assignments).length === 0) return true;
  const rows = await sql<{ id: string }[]>`
    update requisitions
    set ${sql(assignments)}, updated_at = now()
    where id = ${requisitionId}
      and archived_at is null
    returning id
  `;
  return rows.length > 0;
}

/**
 * Status write — called ONLY by the service's transition path, which has
 * already validated the move against REQUISITION_TRANSITIONS (06 §2.2).
 * The compare-and-set on `status` makes concurrent transitions safe: the
 * second writer matches zero rows and the service raises INVALID_TRANSITION.
 */
export async function writeRequisitionStatus(
  sql: Queryable,
  requisitionId: string,
  fromStatus: RequisitionStatus,
  toStatus: RequisitionStatus,
  stamps: {
    principalApprovedAt?: boolean;
    sourcingStartedAt?: boolean;
    closedAt?: boolean;
    principalChangeRequest?: string | null;
  } = {},
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update requisitions
    set status = ${toStatus},
        updated_at = now()
        ${stamps.principalApprovedAt === true ? sql`, principal_approved_at = now()` : sql``}
        ${stamps.sourcingStartedAt === true ? sql`, sourcing_started_at = coalesce(sourcing_started_at, now())` : sql``}
        ${stamps.closedAt === true ? sql`, closed_at = now()` : sql``}
        ${
          stamps.principalChangeRequest === undefined
            ? sql``
            : sql`, principal_change_request = ${stamps.principalChangeRequest}`
        }
    where id = ${requisitionId}
      and status = ${fromStatus}
      and archived_at is null
    returning id
  `;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Stage counts (detail read)
// ---------------------------------------------------------------------------

/** Admin variant: counts over the raw assignments table. */
export async function getStageCounts(
  sql: Queryable,
  requisitionId: string,
): Promise<Record<string, number>> {
  const rows = await sql<{ stage: string; count: string }[]>`
    select stage::text as stage, count(*)::text as count
    from assignments
    where requisition_id = ${requisitionId}
    group by stage
  `;
  return Object.fromEntries(rows.map((row) => [row.stage, Number(row.count)]));
}

/**
 * Client variant: counts over client_visible_assignments ONLY — internal
 * stages are structurally invisible (CLAUDE.md rule 3).
 */
export async function getClientVisibleStageCounts(
  sql: Queryable,
  clientId: string,
  requisitionId: string,
): Promise<Record<string, number>> {
  const rows = await sql<{ stage: string; count: string }[]>`
    select stage::text as stage, count(*)::text as count
    from client_visible_assignments
    where requisition_id = ${requisitionId}
      and client_id = ${clientId}
    group by stage
  `;
  return Object.fromEntries(rows.map((row) => [row.stage, Number(row.count)]));
}

// ---------------------------------------------------------------------------
// Events (04 §7 GET /requisitions/:id/events)
// ---------------------------------------------------------------------------

export interface EventRecord {
  id: string;
  entityType: string;
  entityId: string;
  eventType: string;
  actorId: string | null;
  /** users.full_name of the actor, joined at read time (UX 2.10). */
  actorName: string | null;
  actorRole: UserRoleKey | null;
  fromValue: string | null;
  toValue: string | null;
  metadata: Record<string, unknown>;
  occurredAt: string;
}

interface EventRow {
  id: string;
  entity_type: string;
  entity_id: string;
  event_type: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: UserRoleKey | null;
  from_value: string | null;
  to_value: string | null;
  metadata: Record<string, unknown>;
  occurred_at: Date;
}

/** Chronological (oldest first) events for one entity, with actor names. */
export async function listEventsForEntity(
  sql: Queryable,
  entityType: string,
  entityId: string,
): Promise<EventRecord[]> {
  const rows = await sql<EventRow[]>`
    select e.id, e.entity_type, e.entity_id, e.event_type, e.actor_id,
           u.full_name as actor_name, e.actor_role,
           e.from_value, e.to_value, e.metadata, e.occurred_at
    from events e
    left join users u on u.id = e.actor_id
    where e.entity_type = ${entityType}
      and e.entity_id = ${entityId}
    order by e.occurred_at asc, e.id asc
  `;
  return rows.map((row) => ({
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    eventType: row.event_type,
    actorId: row.actor_id,
    actorName: row.actor_name,
    actorRole: row.actor_role,
    fromValue: row.from_value,
    toValue: row.to_value,
    metadata: row.metadata,
    occurredAt: row.occurred_at.toISOString(),
  }));
}
