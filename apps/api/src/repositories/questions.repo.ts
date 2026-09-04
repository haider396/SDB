/**
 * SQL for question_categories, questions, question_options, and
 * question_role_scopes (docs/02-DATABASE.md §6). No business logic here —
 * guard rails (03 §1.5) live in services/questions.service.ts.
 */
import type postgres from 'postgres';
import type { QuestionAudience, QuestionType } from '@sdb/contracts';
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
// Row → record mapping
// ---------------------------------------------------------------------------

export interface CategoryRecord {
  id: string;
  key: string;
  label: string;
  description: string | null;
  sortOrder: number;
  audience: QuestionAudience;
  isActive: boolean;
  questionCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface CategoryRow {
  id: string;
  key: string;
  label: string;
  description: string | null;
  sort_order: number;
  audience: QuestionAudience;
  is_active: boolean;
  question_count: string | number;
  created_at: Date;
  updated_at: Date;
}

function mapCategory(row: CategoryRow): CategoryRecord {
  return {
    id: row.id,
    key: row.key,
    label: row.label,
    description: row.description,
    sortOrder: row.sort_order,
    audience: row.audience,
    isActive: row.is_active,
    questionCount: Number(row.question_count),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface QuestionRecord {
  id: string;
  categoryId: string;
  key: string;
  label: string;
  helpText: string | null;
  placeholder: string | null;
  questionType: QuestionType;
  audience: QuestionAudience;
  isRequired: boolean;
  isActive: boolean;
  sortOrder: number;
  validation: Record<string, unknown>;
  conditionalOnQuestionId: string | null;
  /** Key of the controlling question, resolved by join. */
  conditionalKey: string | null;
  conditionalOperator: string | null;
  conditionalValue: unknown;
  answerCount: number;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
}

interface QuestionRow {
  id: string;
  category_id: string;
  key: string;
  label: string;
  help_text: string | null;
  placeholder: string | null;
  question_type: QuestionType;
  audience: QuestionAudience;
  is_required: boolean;
  is_active: boolean;
  sort_order: number;
  validation: Record<string, unknown>;
  conditional_on_question_id: string | null;
  conditional_key: string | null;
  conditional_operator: string | null;
  conditional_value: unknown;
  answer_count: number;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

function mapQuestion(row: QuestionRow): QuestionRecord {
  return {
    id: row.id,
    categoryId: row.category_id,
    key: row.key,
    label: row.label,
    helpText: row.help_text,
    placeholder: row.placeholder,
    questionType: row.question_type,
    audience: row.audience,
    isRequired: row.is_required,
    isActive: row.is_active,
    sortOrder: row.sort_order,
    validation: row.validation,
    conditionalOnQuestionId: row.conditional_on_question_id,
    conditionalKey: row.conditional_key,
    conditionalOperator: row.conditional_operator,
    conditionalValue: row.conditional_value,
    answerCount: row.answer_count,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
  };
}

export interface OptionRecord {
  id: string;
  questionId: string;
  value: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

interface OptionRow {
  id: string;
  question_id: string;
  value: string;
  label: string;
  sort_order: number;
  is_active: boolean;
}

function mapOption(row: OptionRow): OptionRecord {
  return {
    id: row.id,
    questionId: row.question_id,
    value: row.value,
    label: row.label,
    sortOrder: row.sort_order,
    isActive: row.is_active,
  };
}

export interface DependentRecord {
  id: string;
  key: string;
  label: string;
  isActive: boolean;
}

const QUESTION_SELECT = (sql: Queryable) => sql`
  select q.id, q.category_id, q.key, q.label, q.help_text, q.placeholder,
         q.question_type, q.audience, q.is_required, q.is_active, q.sort_order,
         q.validation, q.conditional_on_question_id, cq.key as conditional_key,
         q.conditional_operator, q.conditional_value, q.answer_count,
         q.created_at, q.updated_at, q.archived_at
  from questions q
  left join questions cq on cq.id = q.conditional_on_question_id
`;

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

export async function listCategories(
  sql: Queryable,
  filter: { isActive?: boolean; audience?: QuestionAudience } = {},
): Promise<CategoryRecord[]> {
  const rows = await sql<CategoryRow[]>`
    select c.*,
           (select count(*) from questions q
             where q.category_id = c.id
               and q.archived_at is null
               and q.audience = c.audience) as question_count
    from question_categories c
    where ${filter.isActive === undefined ? sql`true` : sql`c.is_active = ${filter.isActive}`}
      and ${
        filter.audience === undefined
          ? sql`true`
          : sql`c.audience = ${filter.audience}::question_audience`
      }
    order by c.sort_order, c.created_at, c.id
  `;
  return rows.map(mapCategory);
}

export async function findCategoryById(
  sql: Queryable,
  id: string,
): Promise<CategoryRecord | null> {
  const rows = await sql<CategoryRow[]>`
    select c.*,
           (select count(*) from questions q
             where q.category_id = c.id
               and q.archived_at is null
               and q.audience = c.audience) as question_count
    from question_categories c
    where c.id = ${id}
  `;
  const row = rows[0];
  return row === undefined ? null : mapCategory(row);
}

export async function listCategoryKeys(sql: Queryable): Promise<string[]> {
  const rows = await sql<{ key: string }[]>`select key from question_categories`;
  return rows.map((row) => row.key);
}

export async function insertCategory(
  sql: Queryable,
  input: {
    key: string;
    label: string;
    description: string | null;
    sortOrder: number;
    audience: QuestionAudience;
  },
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into question_categories (key, label, description, sort_order, audience)
    values (${input.key}, ${input.label}, ${input.description}, ${input.sortOrder},
            ${input.audience}::question_audience)
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('category insert returned no row');
  return row.id;
}

export async function updateCategory(
  sql: Queryable,
  id: string,
  patch: { label?: string; description?: string | null; sortOrder?: number },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update question_categories set
      label       = coalesce(${patch.label ?? null}, label),
      description = ${patch.description === undefined ? sql`description` : patch.description},
      sort_order  = coalesce(${patch.sortOrder ?? null}, sort_order)
    where id = ${id}
    returning id
  `;
  return rows.length > 0;
}

export async function setCategoryActive(
  sql: Queryable,
  id: string,
  isActive: boolean,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update question_categories set is_active = ${isActive}
    where id = ${id}
    returning id
  `;
  return rows.length > 0;
}

export async function reorderCategories(
  sql: Queryable,
  orderedCategoryIds: string[],
): Promise<void> {
  for (const [index, id] of orderedCategoryIds.entries()) {
    await sql`
      update question_categories set sort_order = ${index + 1} where id = ${id}
    `;
  }
}

// ---------------------------------------------------------------------------
// Questions
// ---------------------------------------------------------------------------

export async function listQuestions(
  sql: Queryable,
  filter: {
    categoryId?: string;
    isActive?: boolean;
    roleCategoryId?: string;
    audience?: QuestionAudience;
  } = {},
): Promise<QuestionRecord[]> {
  const rows = await sql<QuestionRow[]>`
    ${QUESTION_SELECT(sql)}
    where q.archived_at is null
      and ${filter.categoryId === undefined ? sql`true` : sql`q.category_id = ${filter.categoryId}`}
      and ${filter.isActive === undefined ? sql`true` : sql`q.is_active = ${filter.isActive}`}
      and ${
        filter.audience === undefined
          ? sql`true`
          : sql`q.audience = ${filter.audience}::question_audience`
      }
      and ${
        filter.roleCategoryId === undefined
          ? sql`true`
          : sql`(
              not exists (select 1 from question_role_scopes s where s.question_id = q.id)
              or exists (select 1 from question_role_scopes s
                          where s.question_id = q.id
                            and s.role_category_id = ${filter.roleCategoryId})
            )`
      }
    order by q.sort_order, q.created_at, q.id
  `;
  return rows.map(mapQuestion);
}

export async function findQuestionById(
  sql: Queryable,
  id: string,
): Promise<QuestionRecord | null> {
  const rows = await sql<QuestionRow[]>`
    ${QUESTION_SELECT(sql)}
    where q.id = ${id}
  `;
  const row = rows[0];
  return row === undefined ? null : mapQuestion(row);
}

export async function findQuestionByKey(
  sql: Queryable,
  key: string,
): Promise<QuestionRecord | null> {
  const rows = await sql<QuestionRow[]>`
    ${QUESTION_SELECT(sql)}
    where q.key = ${key}
  `;
  const row = rows[0];
  return row === undefined ? null : mapQuestion(row);
}

export async function listQuestionKeys(sql: Queryable): Promise<string[]> {
  const rows = await sql<{ key: string }[]>`select key from questions`;
  return rows.map((row) => row.key);
}

export async function insertQuestion(
  sql: Queryable,
  input: {
    categoryId: string;
    key: string;
    label: string;
    helpText: string | null;
    placeholder: string | null;
    questionType: QuestionType;
    audience: QuestionAudience;
    isRequired: boolean;
    isActive: boolean;
    sortOrder: number;
    validation: Record<string, unknown>;
    conditionalOnQuestionId: string | null;
    conditionalOperator: string | null;
    conditionalValue: unknown;
    createdBy: string | null;
  },
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into questions (
      category_id, key, label, help_text, placeholder, question_type, audience,
      is_required, is_active, sort_order, validation,
      conditional_on_question_id, conditional_operator, conditional_value,
      created_by
    ) values (
      ${input.categoryId}, ${input.key}, ${input.label}, ${input.helpText},
      ${input.placeholder}, ${input.questionType}, ${input.audience},
      ${input.isRequired}, ${input.isActive}, ${input.sortOrder},
      ${jsonb(sql, input.validation)},
      ${input.conditionalOnQuestionId}, ${input.conditionalOperator},
      ${input.conditionalValue === null || input.conditionalValue === undefined ? null : jsonb(sql, input.conditionalValue)},
      ${input.createdBy}
    )
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('question insert returned no row');
  return row.id;
}

export interface QuestionUpdatePatch {
  categoryId?: string;
  label?: string;
  helpText?: string | null;
  placeholder?: string | null;
  questionType?: QuestionType;
  audience?: QuestionAudience;
  isRequired?: boolean;
  sortOrder?: number;
  validation?: Record<string, unknown>;
  /** `null` clears the conditional; undefined leaves it untouched. */
  conditional?: {
    conditionalOnQuestionId: string;
    conditionalOperator: string;
    conditionalValue: unknown;
  } | null;
}

export async function updateQuestion(
  sql: Queryable,
  id: string,
  patch: QuestionUpdatePatch,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update questions set
      category_id   = coalesce(${patch.categoryId ?? null}, category_id),
      label         = coalesce(${patch.label ?? null}, label),
      help_text     = ${patch.helpText === undefined ? sql`help_text` : patch.helpText},
      placeholder   = ${patch.placeholder === undefined ? sql`placeholder` : patch.placeholder},
      question_type = coalesce(${patch.questionType ?? null}, question_type),
      audience      = coalesce(${patch.audience ?? null}, audience),
      is_required   = coalesce(${patch.isRequired ?? null}, is_required),
      sort_order    = coalesce(${patch.sortOrder ?? null}, sort_order),
      validation    = ${patch.validation === undefined ? sql`validation` : jsonb(sql, patch.validation)},
      conditional_on_question_id = ${
        patch.conditional === undefined
          ? sql`conditional_on_question_id`
          : patch.conditional === null
            ? null
            : patch.conditional.conditionalOnQuestionId
      },
      conditional_operator = ${
        patch.conditional === undefined
          ? sql`conditional_operator`
          : patch.conditional === null
            ? null
            : patch.conditional.conditionalOperator
      },
      conditional_value = ${
        patch.conditional === undefined
          ? sql`conditional_value`
          : patch.conditional === null || patch.conditional.conditionalValue === null
            ? null
            : jsonb(sql, patch.conditional.conditionalValue)
      }
    where id = ${id}
    returning id
  `;
  return rows.length > 0;
}

export async function setQuestionActive(
  sql: Queryable,
  id: string,
  isActive: boolean,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update questions set is_active = ${isActive} where id = ${id} returning id
  `;
  return rows.length > 0;
}

/** Soft delete (03 conventions): archived questions leave every answer intact. */
export async function archiveQuestion(
  sql: Queryable,
  id: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update questions set archived_at = now(), is_active = false
    where id = ${id} and archived_at is null
    returning id
  `;
  return rows.length > 0;
}

export async function reorderQuestions(
  sql: Queryable,
  categoryId: string,
  orderedQuestionIds: string[],
): Promise<void> {
  for (const [index, id] of orderedQuestionIds.entries()) {
    await sql`
      update questions set sort_order = ${index + 1}
      where id = ${id} and category_id = ${categoryId}
    `;
  }
}

/** Questions conditionally dependent on the given question. */
export async function listDependents(
  sql: Queryable,
  questionId: string,
): Promise<DependentRecord[]> {
  const rows = await sql<
    { id: string; key: string; label: string; is_active: boolean }[]
  >`
    select id, key, label, is_active
    from questions
    where conditional_on_question_id = ${questionId}
      and archived_at is null
    order by sort_order, id
  `;
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    label: row.label,
    isActive: row.is_active,
  }));
}

/**
 * Cross-category conditional dependents (UX 2.7): ACTIVE, un-archived
 * questions living OUTSIDE the given category whose conditional controller
 * lives INSIDE it — the questions that silently stop appearing when the
 * category is deactivated. `controllerKey` names the controlling question
 * for the warning message.
 */
export async function listCategoryConditionalDependents(
  sql: Queryable,
  categoryId: string,
): Promise<(DependentRecord & { controllerKey: string })[]> {
  const rows = await sql<
    {
      id: string;
      key: string;
      label: string;
      is_active: boolean;
      controller_key: string;
    }[]
  >`
    select q.id, q.key, q.label, q.is_active, ctrl.key as controller_key
    from questions q
    join questions ctrl on ctrl.id = q.conditional_on_question_id
    where ctrl.category_id = ${categoryId}
      and q.category_id <> ${categoryId}
      and q.is_active = true
      and q.archived_at is null
      and ctrl.archived_at is null
    order by q.sort_order, q.id
  `;
  return rows.map((row) => ({
    id: row.id,
    key: row.key,
    label: row.label,
    isActive: row.is_active,
    controllerKey: row.controller_key,
  }));
}

/** id → conditional_on_question_id for every question (cycle detection). */
export async function getConditionalEdges(
  sql: Queryable,
): Promise<Map<string, string | null>> {
  const rows = await sql<
    { id: string; conditional_on_question_id: string | null }[]
  >`
    select id, conditional_on_question_id from questions
  `;
  return new Map(rows.map((row) => [row.id, row.conditional_on_question_id]));
}

export async function getLastAnsweredAt(
  sql: Queryable,
  questionIds: string[],
): Promise<Map<string, Date>> {
  if (questionIds.length === 0) return new Map();
  const rows = await sql<{ question_id: string; last_answered_at: Date }[]>`
    select question_id, max(created_at) as last_answered_at
    from requisition_answers
    where question_id in ${sql(questionIds)}
    group by question_id
  `;
  return new Map(rows.map((row) => [row.question_id, row.last_answered_at]));
}

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export async function listOptionsForQuestions(
  sql: Queryable,
  questionIds: string[],
): Promise<Map<string, OptionRecord[]>> {
  if (questionIds.length === 0) return new Map();
  const rows = await sql<OptionRow[]>`
    select id, question_id, value, label, sort_order, is_active
    from question_options
    where question_id in ${sql(questionIds)}
    order by sort_order, id
  `;
  const byQuestion = new Map<string, OptionRecord[]>();
  for (const row of rows) {
    const list = byQuestion.get(row.question_id) ?? [];
    list.push(mapOption(row));
    byQuestion.set(row.question_id, list);
  }
  return byQuestion;
}

export async function findOption(
  sql: Queryable,
  questionId: string,
  optionId: string,
): Promise<OptionRecord | null> {
  const rows = await sql<OptionRow[]>`
    select id, question_id, value, label, sort_order, is_active
    from question_options
    where id = ${optionId} and question_id = ${questionId}
  `;
  const row = rows[0];
  return row === undefined ? null : mapOption(row);
}

export async function insertOption(
  sql: Queryable,
  input: {
    questionId: string;
    value: string;
    label: string;
    sortOrder: number;
  },
): Promise<string> {
  const rows = await sql<{ id: string }[]>`
    insert into question_options (question_id, value, label, sort_order)
    values (${input.questionId}, ${input.value}, ${input.label}, ${input.sortOrder})
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('option insert returned no row');
  return row.id;
}

export async function updateOption(
  sql: Queryable,
  optionId: string,
  patch: { label?: string; sortOrder?: number; value?: string },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update question_options set
      label      = coalesce(${patch.label ?? null}, label),
      sort_order = coalesce(${patch.sortOrder ?? null}, sort_order),
      value      = coalesce(${patch.value ?? null}, value)
    where id = ${optionId}
    returning id
  `;
  return rows.length > 0;
}

export async function setOptionActive(
  sql: Queryable,
  optionId: string,
  isActive: boolean,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update question_options set is_active = ${isActive}
    where id = ${optionId}
    returning id
  `;
  return rows.length > 0;
}

/** Whether any answer references the option (03 §1.5: value frozen once used). */
export async function isOptionReferenced(
  sql: Queryable,
  optionId: string,
): Promise<boolean> {
  const rows = await sql<{ exists: boolean }[]>`
    select exists (
      select 1 from requisition_answer_options where option_id = ${optionId}
    ) as exists
  `;
  return rows[0]?.exists === true;
}

// ---------------------------------------------------------------------------
// Role scopes
// ---------------------------------------------------------------------------

export async function getRoleScopes(
  sql: Queryable,
  questionIds: string[],
): Promise<Map<string, string[]>> {
  if (questionIds.length === 0) return new Map();
  const rows = await sql<{ question_id: string; role_category_id: string }[]>`
    select question_id, role_category_id
    from question_role_scopes
    where question_id in ${sql(questionIds)}
  `;
  const byQuestion = new Map<string, string[]>();
  for (const row of rows) {
    const list = byQuestion.get(row.question_id) ?? [];
    list.push(row.role_category_id);
    byQuestion.set(row.question_id, list);
  }
  return byQuestion;
}

export async function replaceRoleScopes(
  sql: Queryable,
  questionId: string,
  roleCategoryIds: string[],
): Promise<void> {
  await sql`delete from question_role_scopes where question_id = ${questionId}`;
  for (const roleCategoryId of roleCategoryIds) {
    await sql`
      insert into question_role_scopes (question_id, role_category_id)
      values (${questionId}, ${roleCategoryId})
      on conflict do nothing
    `;
  }
}
