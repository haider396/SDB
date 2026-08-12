/**
 * SQL for the intake form engine read side and the intake-submission write
 * side (docs/03-INTAKE-FORM-ENGINE.md §3, docs/06-BACKEND.md §2.1). No
 * business logic — the validation pipeline and mapped projection live in
 * services/intake-submission.service.ts.
 */
import type postgres from 'postgres';
import type { QuestionType } from '@sdb/contracts';
import type { Queryable } from '../lib/db.js';

/**
 * jsonb parameters MUST go through sql.json(): postgres.js JSON-encodes string
 * parameters bound to jsonb, so `${JSON.stringify(x)}::jsonb` double-encodes
 * and stores a jsonb string scalar instead of the object.
 */
function jsonb(sql: Queryable, value: unknown): postgres.Parameter {
  return sql.json(value as postgres.JSONValue);
}

// ---------------------------------------------------------------------------
// Form read side
// ---------------------------------------------------------------------------

/** One active, in-scope, client-audience question with its category context. */
export interface FormQuestionRecord {
  id: string;
  key: string;
  label: string;
  helpText: string | null;
  placeholder: string | null;
  questionType: QuestionType;
  isRequired: boolean;
  sortOrder: number;
  validation: Record<string, unknown>;
  conditionalKey: string | null;
  conditionalOperator: string | null;
  conditionalValue: unknown;
  categoryId: string;
  categoryKey: string;
  categoryLabel: string;
  categoryDescription: string | null;
  categorySortOrder: number;
  options: { id: string; value: string; label: string }[];
}

interface FormQuestionRow {
  id: string;
  key: string;
  label: string;
  help_text: string | null;
  placeholder: string | null;
  question_type: QuestionType;
  is_required: boolean;
  sort_order: number;
  validation: Record<string, unknown>;
  conditional_key: string | null;
  conditional_operator: string | null;
  conditional_value: unknown;
  category_id: string;
  category_key: string;
  category_label: string;
  category_description: string | null;
  category_sort_order: number;
}

/**
 * The active configuration for the public form (03 §3.2 rules 1–5):
 * active questions in active categories, audience 'client' only, universal
 * questions always, scoped questions only for the matching role category —
 * universal-only when roleCategoryId is null. Options: active only.
 */
export async function getActiveFormQuestions(
  sql: Queryable,
  roleCategoryId: string | null,
): Promise<FormQuestionRecord[]> {
  const rows = await sql<FormQuestionRow[]>`
    select q.id, q.key, q.label, q.help_text, q.placeholder, q.question_type,
           q.is_required, q.sort_order, q.validation,
           cq.key as conditional_key, q.conditional_operator, q.conditional_value,
           c.id as category_id, c.key as category_key, c.label as category_label,
           c.description as category_description, c.sort_order as category_sort_order
    from questions q
    join question_categories c on c.id = q.category_id
    left join questions cq on cq.id = q.conditional_on_question_id
    where q.is_active
      and q.archived_at is null
      and c.is_active
      and q.audience = 'client'
      and (
        not exists (select 1 from question_role_scopes s where s.question_id = q.id)
        ${
          roleCategoryId === null
            ? sql``
            : sql`or exists (select 1 from question_role_scopes s
                              where s.question_id = q.id
                                and s.role_category_id = ${roleCategoryId})`
        }
      )
    order by c.sort_order, c.created_at, c.id, q.sort_order, q.created_at, q.id
  `;

  const questionIds = rows.map((row) => row.id);
  const optionRows =
    questionIds.length === 0
      ? []
      : await sql<
          { id: string; question_id: string; value: string; label: string }[]
        >`
          select id, question_id, value, label
          from question_options
          where question_id in ${sql(questionIds)}
            and is_active
          order by sort_order, id
        `;
  const optionsByQuestion = new Map<
    string,
    { id: string; value: string; label: string }[]
  >();
  for (const option of optionRows) {
    const list = optionsByQuestion.get(option.question_id) ?? [];
    list.push({ id: option.id, value: option.value, label: option.label });
    optionsByQuestion.set(option.question_id, list);
  }

  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    label: row.label,
    helpText: row.help_text,
    placeholder: row.placeholder,
    questionType: row.question_type,
    isRequired: row.is_required,
    sortOrder: row.sort_order,
    validation: row.validation,
    conditionalKey: row.conditional_key,
    conditionalOperator: row.conditional_operator,
    conditionalValue: row.conditional_value,
    categoryId: row.category_id,
    categoryKey: row.category_key,
    categoryLabel: row.category_label,
    categoryDescription: row.category_description,
    categorySortOrder: row.category_sort_order,
    options: optionsByQuestion.get(row.id) ?? [],
  }));
}

/** `intake.form_cache_ttl_seconds` from app_settings; default 60 (02 §10). */
export async function getFormCacheTtlSeconds(sql: Queryable): Promise<number> {
  const rows = await sql<{ value: unknown }[]>`
    select value from app_settings where key = 'intake.form_cache_ttl_seconds'
  `;
  const value = rows[0]?.value;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : 60;
}

// ---------------------------------------------------------------------------
// Taxonomy resolution (mapped-question projection)
// ---------------------------------------------------------------------------

export interface RoleCategoryLineage {
  id: string;
  key: string;
  departmentId: string;
  departmentKey: string;
  engineId: string;
  engineKey: string;
}

export async function findRoleCategoryLineage(
  sql: Queryable,
  roleCategoryId: string,
): Promise<RoleCategoryLineage | null> {
  const rows = await sql<
    {
      id: string;
      key: string;
      department_id: string;
      department_key: string;
      engine_id: string;
      engine_key: string;
    }[]
  >`
    select rc.id, rc.key, d.id as department_id, d.key as department_key,
           e.id as engine_id, e.key as engine_key
    from role_categories rc
    join departments d on d.id = rc.department_id
    join engines e on e.id = d.engine_id
    where rc.id = ${roleCategoryId}
  `;
  const row = rows[0];
  return row === undefined
    ? null
    : {
        id: row.id,
        key: row.key,
        departmentId: row.department_id,
        departmentKey: row.department_key,
        engineId: row.engine_id,
        engineKey: row.engine_key,
      };
}

export async function findEngineIdByKey(
  sql: Queryable,
  key: string,
): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    select id from engines where key = ${key} and is_active
  `;
  return rows[0]?.id ?? null;
}

export async function findDepartmentIdByKey(
  sql: Queryable,
  key: string,
): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    select id from departments where key = ${key} and is_active
    order by sort_order limit 1
  `;
  return rows[0]?.id ?? null;
}

export async function clientExists(
  sql: Queryable,
  clientId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    select id from clients where id = ${clientId} and archived_at is null
  `;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Submission write side (one transaction — docs/06-BACKEND.md §2.1)
// ---------------------------------------------------------------------------

export async function insertProspectClient(
  sql: Queryable,
  input: { companyName: string },
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into clients (company_name, status)
    values (${input.companyName}, 'prospect')
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('client insert returned no row');
  return row.id;
}

export interface RequisitionInsert {
  clientId: string;
  engineId: string | null;
  departmentId: string | null;
  roleCategoryId: string | null;
  headcount: number | null;
  budgetMin: number | null;
  budgetMax: number | null;
  budgetUnit: string | null;
  budgetCurrency: string | null;
  engagementType: string | null;
  hoursPerWeek: number | null;
  overlapStart: string | null;
  overlapEnd: string | null;
  overlapTimezone: string | null;
  targetStartDate: string | null;
  regionPreference: string | null;
  englishSpokenRequired: string | null;
  englishWrittenRequired: string | null;
  maxAccentStrength: string | null;
  intakeContactName: string | null;
  intakeContactEmail: string | null;
  intakeCompletedBy: string | null;
}

/**
 * Reference generated inline from the dedicated sequence (migration 0013):
 * `nextval()` is safe under concurrent submissions — no max()+1 races.
 */
export async function insertRequisition(
  sql: Queryable,
  input: RequisitionInsert,
): Promise<{ id: string; reference: string }> {
  const rows = await sql<{ id: string; reference: string }[]>`
    insert into requisitions (
      reference, client_id, engine_id, department_id,
      role_category_id, primary_role_category_id,
      headcount, status,
      budget_min, budget_max, budget_unit, budget_currency,
      engagement_type, hours_per_week,
      overlap_start, overlap_end, overlap_timezone,
      target_start_date, region_preference,
      english_spoken_required, english_written_required, max_accent_strength,
      intake_contact_name, intake_contact_email, intake_completed_by
    ) values (
      'REQ-' || lpad(nextval('requisition_reference_seq')::text, 6, '0'),
      ${input.clientId}, ${input.engineId}, ${input.departmentId},
      ${input.roleCategoryId}, ${input.roleCategoryId},
      ${input.headcount ?? 1}, 'submitted',
      ${input.budgetMin}, ${input.budgetMax},
      ${input.budgetUnit}::rate_unit, ${input.budgetCurrency ?? 'USD'},
      ${input.engagementType}::engagement_type, ${input.hoursPerWeek},
      ${input.overlapStart}::time, ${input.overlapEnd}::time, ${input.overlapTimezone},
      ${input.targetStartDate}::date, ${input.regionPreference},
      ${input.englishSpokenRequired}::language_level,
      ${input.englishWrittenRequired}::language_level,
      ${input.maxAccentStrength}::accent_strength,
      ${input.intakeContactName}, ${input.intakeContactEmail}, ${input.intakeCompletedBy}
    )
    returning id, reference
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('requisition insert returned no row');
  return row;
}

export interface AnswerInsert {
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

export async function insertAnswer(
  sql: Queryable,
  input: AnswerInsert,
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
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('answer insert returned no row');
  return row.id;
}

export async function insertAnswerOptions(
  sql: Queryable,
  answerId: string,
  optionIds: string[],
): Promise<void> {
  for (const optionId of optionIds) {
    await sql`
      insert into requisition_answer_options (answer_id, option_id)
      values (${answerId}, ${optionId})
    `;
  }
}

// ---------------------------------------------------------------------------
// Notification enqueue (dispatch is P7 — enqueue only, 06 §4.3)
// ---------------------------------------------------------------------------

export interface AdminRecipient {
  id: string;
  email: string;
  fullName: string;
}

export async function getActiveAdmins(
  sql: Queryable,
): Promise<AdminRecipient[]> {
  const rows = await sql<{ id: string; email: string; full_name: string }[]>`
    select distinct u.id, u.email, u.full_name
    from users u
    join user_roles ur on ur.user_id = u.id
    join roles r on r.id = ur.role_id
    where r.key in ('super_admin', 'admin')
      and u.is_active
      and u.archived_at is null
    order by u.email
  `;
  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    fullName: row.full_name,
  }));
}

export async function enqueueNotification(
  sql: Queryable,
  input: {
    event: string;
    recipientEmail: string;
    recipientUserId: string | null;
    entityType: string;
    entityId: string;
    payload: Record<string, unknown>;
  },
): Promise<void> {
  await sql`
    insert into notification_log (
      event, recipient_email, recipient_user_id, entity_type, entity_id,
      payload, status
    ) values (
      ${input.event}::notification_event, ${input.recipientEmail},
      ${input.recipientUserId}, ${input.entityType}, ${input.entityId},
      ${jsonb(sql, input.payload)}, 'queued'
    )
  `;
}
