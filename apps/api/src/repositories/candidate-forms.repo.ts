/**
 * SQL for candidate_forms, candidate_form_versions and candidate_form_blocks
 * (migration 0020). No business rules here — activation validation and the
 * guard rails live in services/candidate-forms.service.ts.
 */
import type postgres from 'postgres';
import type { Queryable } from '../lib/db.js';

/**
 * jsonb parameters MUST go through sql.json(): postgres.js JSON-encodes string
 * parameters bound to jsonb, so `${JSON.stringify(x)}::jsonb` double-encodes
 * and stores a jsonb string scalar instead of the object. Same helper, same
 * reason, as questions.repo.ts.
 */
function jsonb(sql: Queryable, value: unknown): postgres.Parameter {
  return sql.json(value as postgres.JSONValue);
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

export interface FormRecord {
  id: string;
  slug: string;
  key: string;
  label: string;
  description: string | null;
  roleCategoryId: string | null;
  roleCategoryKey: string | null;
  roleCategoryLabel: string | null;
  hasTypingTest: boolean;
  hasDocumentsStep: boolean;
  isDefault: boolean;
  status: 'draft' | 'active' | 'inactive';
  publishedVersionId: string | null;
  activatedAt: Date | null;
  deactivatedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  archivedAt: Date | null;
  submissionCount: number;
}

export interface VersionRecord {
  id: string;
  formId: string;
  versionNumber: number;
  pages: unknown;
  theme: unknown;
  createdAt: Date;
  publishedAt: Date | null;
}

export interface BlockRecord {
  id: string;
  formVersionId: string;
  parentBlockId: string | null;
  blockType: string;
  questionId: string | null;
  pageIndex: number;
  sortOrder: number;
  layout: unknown;
  style: unknown;
  props: unknown;
  isRequiredOverride: boolean | null;
  labelOverride: string | null;
  placeholderOverride: string | null;
  helpTextOverride: string | null;
  optionValueOverrides: string[] | null;
}

interface FormRow {
  id: string;
  slug: string;
  key: string;
  label: string;
  description: string | null;
  role_category_id: string | null;
  role_category_key: string | null;
  role_category_label: string | null;
  has_typing_test: boolean;
  has_documents_step: boolean;
  is_default: boolean;
  status: 'draft' | 'active' | 'inactive';
  published_version_id: string | null;
  activated_at: Date | null;
  deactivated_at: Date | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
  submission_count: string;
}

function toForm(row: FormRow): FormRecord {
  return {
    id: row.id,
    slug: row.slug,
    key: row.key,
    label: row.label,
    description: row.description,
    roleCategoryId: row.role_category_id,
    roleCategoryKey: row.role_category_key,
    roleCategoryLabel: row.role_category_label,
    hasTypingTest: row.has_typing_test,
    hasDocumentsStep: row.has_documents_step,
    isDefault: row.is_default,
    status: row.status,
    publishedVersionId: row.published_version_id,
    activatedAt: row.activated_at,
    deactivatedAt: row.deactivated_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at,
    // count(*) is bigint; postgres.js returns it as a string.
    submissionCount: Number(row.submission_count),
  };
}

const FORM_SELECT = (sql: Queryable) => sql`
  select f.id, f.slug, f.key, f.label, f.description,
         f.role_category_id, rc.key as role_category_key, rc.label as role_category_label,
         f.has_typing_test, f.has_documents_step, f.is_default, f.status,
         f.published_version_id, f.activated_at, f.deactivated_at,
         f.created_at, f.updated_at, f.archived_at,
         (select count(*) from candidate_form_submissions s where s.form_id = f.id)
           as submission_count
    from candidate_forms f
    left join role_categories rc on rc.id = f.role_category_id
`;

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

export interface ListFormsFilters {
  status?: 'draft' | 'active' | 'inactive';
  roleCategoryId?: string;
  includeArchived?: boolean;
}

export async function listForms(
  sql: Queryable,
  filters: ListFormsFilters = {},
): Promise<FormRecord[]> {
  const rows = await sql<FormRow[]>`
    ${FORM_SELECT(sql)}
    where (${filters.status ?? null}::text is null or f.status = ${filters.status ?? null})
      and (${filters.roleCategoryId ?? null}::uuid is null
           or f.role_category_id = ${filters.roleCategoryId ?? null})
      and (${filters.includeArchived ?? false} or f.archived_at is null)
    order by f.is_default desc, f.created_at desc
  `;
  return rows.map(toForm);
}

export async function getForm(
  sql: Queryable,
  id: string,
): Promise<FormRecord | null> {
  const rows = await sql<FormRow[]>`${FORM_SELECT(sql)} where f.id = ${id}`;
  const row = rows[0];
  return row === undefined ? null : toForm(row);
}

/** Resolve the seeded default form — the one /register serves. */
export async function getDefaultForm(sql: Queryable): Promise<FormRecord | null> {
  const rows = await sql<FormRow[]>`
    ${FORM_SELECT(sql)} where f.is_default and f.archived_at is null
  `;
  const row = rows[0];
  return row === undefined ? null : toForm(row);
}

export interface CreateFormInput {
  key: string;
  label: string;
  description: string | null;
  roleCategoryId: string | null;
  hasTypingTest: boolean;
  hasDocumentsStep: boolean;
  createdBy: string | null;
}

export async function insertForm(
  sql: Queryable,
  input: CreateFormInput,
): Promise<{ id: string; slug: string }> {
  // slug is DB-generated (default generate_public_id(12)) and never supplied.
  const rows = await sql<{ id: string; slug: string }[]>`
    insert into candidate_forms
      (key, label, description, role_category_id,
       has_typing_test, has_documents_step, created_by)
    values (${input.key}, ${input.label}, ${input.description},
            ${input.roleCategoryId}, ${input.hasTypingTest},
            ${input.hasDocumentsStep}, ${input.createdBy})
    returning id, slug
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('form insert returned no row');
  return row;
}

export interface UpdateFormPatch {
  label?: string;
  description?: string | null;
  roleCategoryId?: string | null;
  hasTypingTest?: boolean;
  hasDocumentsStep?: boolean;
}

export async function updateForm(
  sql: Queryable,
  id: string,
  patch: UpdateFormPatch,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update candidate_forms set
      label            = coalesce(${patch.label ?? null}, label),
      description      = ${patch.description === undefined ? sql`description` : patch.description},
      role_category_id = ${patch.roleCategoryId === undefined ? sql`role_category_id` : patch.roleCategoryId},
      has_typing_test  = coalesce(${patch.hasTypingTest ?? null}, has_typing_test),
      has_documents_step = coalesce(${patch.hasDocumentsStep ?? null}, has_documents_step)
    where id = ${id} and archived_at is null
    returning id
  `;
  return rows.length > 0;
}

export async function setFormStatus(
  sql: Queryable,
  id: string,
  status: 'draft' | 'active' | 'inactive',
  publishedVersionId: string | null,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update candidate_forms set
      status = ${status},
      published_version_id = coalesce(${publishedVersionId}, published_version_id),
      activated_at   = ${status === 'active' ? sql`now()` : sql`activated_at`},
      deactivated_at = ${status === 'inactive' ? sql`now()` : sql`deactivated_at`}
    where id = ${id} and archived_at is null
    returning id
  `;
  return rows.length > 0;
}

/** Soft delete, matching questions: nothing in this schema is hard-deleted. */
export async function archiveForm(sql: Queryable, id: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update candidate_forms set archived_at = now(), status = 'inactive'
    where id = ${id} and archived_at is null
    returning id
  `;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Versions
// ---------------------------------------------------------------------------

interface VersionRow {
  id: string;
  form_id: string;
  version_number: number;
  pages: unknown;
  theme: unknown;
  created_at: Date;
  published_at: Date | null;
}

function toVersion(row: VersionRow): VersionRecord {
  return {
    id: row.id,
    formId: row.form_id,
    versionNumber: row.version_number,
    pages: row.pages,
    theme: row.theme,
    createdAt: row.created_at,
    publishedAt: row.published_at,
  };
}

export async function insertVersion(
  sql: Queryable,
  input: {
    formId: string;
    pages: unknown;
    theme: unknown;
    createdBy: string | null;
  },
): Promise<VersionRecord> {
  const rows = await sql<VersionRow[]>`
    insert into candidate_form_versions (form_id, version_number, pages, theme, created_by)
    values (
      ${input.formId},
      coalesce((select max(version_number) + 1 from candidate_form_versions
                 where form_id = ${input.formId}), 1),
      ${jsonb(sql, input.pages)},
      ${jsonb(sql, input.theme)},
      ${input.createdBy}
    )
    returning id, form_id, version_number, pages, theme, created_at, published_at
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('version insert returned no row');
  return toVersion(row);
}

export async function getVersion(
  sql: Queryable,
  id: string,
): Promise<VersionRecord | null> {
  const rows = await sql<VersionRow[]>`
    select id, form_id, version_number, pages, theme, created_at, published_at
      from candidate_form_versions where id = ${id}
  `;
  const row = rows[0];
  return row === undefined ? null : toVersion(row);
}

/** The single editable version: the newest with publishedAt still null. */
export async function getDraftVersion(
  sql: Queryable,
  formId: string,
): Promise<VersionRecord | null> {
  const rows = await sql<VersionRow[]>`
    select id, form_id, version_number, pages, theme, created_at, published_at
      from candidate_form_versions
     where form_id = ${formId} and published_at is null
     order by version_number desc limit 1
  `;
  const row = rows[0];
  return row === undefined ? null : toVersion(row);
}

export async function updateVersionContent(
  sql: Queryable,
  id: string,
  input: { pages: unknown; theme: unknown },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update candidate_form_versions
       set pages = ${jsonb(sql, input.pages)}, theme = ${jsonb(sql, input.theme)}
     where id = ${id} and published_at is null
    returning id
  `;
  return rows.length > 0;
}

export async function markVersionPublished(
  sql: Queryable,
  id: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update candidate_form_versions set published_at = now()
     where id = ${id} and published_at is null
    returning id
  `;
  return rows.length > 0;
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

interface BlockRow {
  id: string;
  form_version_id: string;
  parent_block_id: string | null;
  block_type: string;
  question_id: string | null;
  page_index: number;
  sort_order: number;
  layout: unknown;
  style: unknown;
  props: unknown;
  is_required_override: boolean | null;
  label_override: string | null;
  placeholder_override: string | null;
  help_text_override: string | null;
  option_value_overrides: string[] | null;
}

function toBlock(row: BlockRow): BlockRecord {
  return {
    id: row.id,
    formVersionId: row.form_version_id,
    parentBlockId: row.parent_block_id,
    blockType: row.block_type,
    questionId: row.question_id,
    pageIndex: row.page_index,
    sortOrder: row.sort_order,
    layout: row.layout,
    style: row.style,
    props: row.props,
    isRequiredOverride: row.is_required_override,
    labelOverride: row.label_override,
    placeholderOverride: row.placeholder_override,
    helpTextOverride: row.help_text_override,
    optionValueOverrides: row.option_value_overrides,
  };
}

export async function getBlocks(
  sql: Queryable,
  versionId: string,
): Promise<BlockRecord[]> {
  const rows = await sql<BlockRow[]>`
    select id, form_version_id, parent_block_id, block_type, question_id,
           page_index, sort_order, layout, style, props, is_required_override,
           label_override, placeholder_override, help_text_override,
           option_value_overrides
      from candidate_form_blocks
     where form_version_id = ${versionId}
     order by page_index, sort_order, id
  `;
  return rows.map(toBlock);
}

export interface BlockInput {
  id?: string;
  parentBlockId: string | null;
  blockType: string;
  questionId: string | null;
  pageIndex: number;
  sortOrder: number;
  layout: unknown;
  style: unknown;
  props: unknown;
  isRequiredOverride: boolean | null;
  labelOverride?: string | null;
  placeholderOverride?: string | null;
  helpTextOverride?: string | null;
  optionValueOverrides?: string[] | null;
}

export async function insertBlock(
  sql: Queryable,
  versionId: string,
  input: BlockInput,
): Promise<{ id: string }> {
  const rows = await sql<{ id: string }[]>`
    insert into candidate_form_blocks
      (id, form_version_id, parent_block_id, block_type, question_id,
       page_index, sort_order, layout, style, props, is_required_override,
       label_override, placeholder_override, help_text_override,
       option_value_overrides)
    values (
      coalesce(${input.id ?? null}::uuid, gen_random_uuid()),
      ${versionId}, ${input.parentBlockId}, ${input.blockType}, ${input.questionId},
      ${input.pageIndex}, ${input.sortOrder},
      ${jsonb(sql, input.layout)}, ${jsonb(sql, input.style)}, ${jsonb(sql, input.props)},
      ${input.isRequiredOverride},
      ${input.labelOverride ?? null},
      ${input.placeholderOverride ?? null},
      ${input.helpTextOverride ?? null},
      ${input.optionValueOverrides ?? null}
    )
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('block insert returned no row');
  return row;
}

export interface BlockPatch {
  layout?: unknown;
  style?: unknown;
  props?: unknown;
  pageIndex?: number;
  sortOrder?: number;
  isRequiredOverride?: boolean | null;
  labelOverride?: string | null;
  placeholderOverride?: string | null;
  helpTextOverride?: string | null;
  optionValueOverrides?: string[] | null;
}

/** Single-row update — the drag/resize path, so concurrent edits don't clash. */
export async function updateBlock(
  sql: Queryable,
  versionId: string,
  blockId: string,
  patch: BlockPatch,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update candidate_form_blocks set
      layout     = ${patch.layout === undefined ? sql`layout` : jsonb(sql, patch.layout)},
      style      = ${patch.style === undefined ? sql`style` : jsonb(sql, patch.style)},
      props      = ${patch.props === undefined ? sql`props` : jsonb(sql, patch.props)},
      page_index = coalesce(${patch.pageIndex ?? null}, page_index),
      sort_order = coalesce(${patch.sortOrder ?? null}, sort_order),
      is_required_override = ${
        patch.isRequiredOverride === undefined
          ? sql`is_required_override`
          : patch.isRequiredOverride
      },
      label_override = ${
        patch.labelOverride === undefined ? sql`label_override` : patch.labelOverride
      },
      placeholder_override = ${
        patch.placeholderOverride === undefined
          ? sql`placeholder_override`
          : patch.placeholderOverride
      },
      help_text_override = ${
        patch.helpTextOverride === undefined
          ? sql`help_text_override`
          : patch.helpTextOverride
      },
      option_value_overrides = ${
        patch.optionValueOverrides === undefined
          ? sql`option_value_overrides`
          : patch.optionValueOverrides
      }
    where id = ${blockId} and form_version_id = ${versionId}
    returning id
  `;
  return rows.length > 0;
}

export async function deleteBlock(
  sql: Queryable,
  versionId: string,
  blockId: string,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    delete from candidate_form_blocks
     where id = ${blockId} and form_version_id = ${versionId}
    returning id
  `;
  return rows.length > 0;
}

export async function deleteAllBlocks(
  sql: Queryable,
  versionId: string,
): Promise<number> {
  const rows = await sql<{ id: string }[]>`
    delete from candidate_form_blocks where form_version_id = ${versionId}
    returning id
  `;
  return rows.length;
}

/**
 * Questions a version references, with the facts activation must check:
 * a form cannot go live pointing at an inactive, archived, or non-candidate
 * question (the last is AC-IF-02 enforced at build time).
 */
export interface ReferencedQuestion {
  questionId: string;
  key: string;
  label: string;
  audience: string;
  isActive: boolean;
  isArchived: boolean;
  conditionalOnQuestionId: string | null;
}

export async function getReferencedQuestions(
  sql: Queryable,
  versionId: string,
): Promise<ReferencedQuestion[]> {
  const rows = await sql<
    {
      question_id: string;
      key: string;
      label: string;
      audience: string;
      is_active: boolean;
      is_archived: boolean;
      conditional_on_question_id: string | null;
    }[]
  >`
    select q.id as question_id, q.key, q.label, q.audience::text as audience,
           q.is_active, (q.archived_at is not null) as is_archived,
           q.conditional_on_question_id
      from candidate_form_blocks b
      join questions q on q.id = b.question_id
     where b.form_version_id = ${versionId} and b.question_id is not null
     order by q.key
  `;
  return rows.map((row) => ({
    questionId: row.question_id,
    key: row.key,
    label: row.label,
    audience: row.audience,
    isActive: row.is_active,
    isArchived: row.is_archived,
    conditionalOnQuestionId: row.conditional_on_question_id,
  }));
}

/** Which live forms use a question — needed before archiving one. */
export async function listFormsUsingQuestion(
  sql: Queryable,
  questionId: string,
): Promise<{ formId: string; label: string; status: string }[]> {
  const rows = await sql<{ form_id: string; label: string; status: string }[]>`
    select distinct f.id as form_id, f.label, f.status
      from candidate_form_blocks b
      join candidate_form_versions v on v.id = b.form_version_id
      join candidate_forms f on f.id = v.form_id
     where b.question_id = ${questionId} and f.archived_at is null
     order by f.label
  `;
  return rows.map((row) => ({
    formId: row.form_id,
    label: row.label,
    status: row.status,
  }));
}

// ---------------------------------------------------------------------------
// Public serving + submissions
// ---------------------------------------------------------------------------

/**
 * Resolve a form for its PUBLIC link.
 *
 * Only an active, unarchived form with a published version resolves. A draft,
 * deactivated or archived form returns null and the route 404s — deliberately
 * indistinguishable from a slug that never existed, so a closed form does not
 * leak that it was ever open.
 */
export async function getPublishedFormBySlug(
  sql: Queryable,
  slug: string,
): Promise<(FormRecord & { publishedVersionId: string }) | null> {
  const rows = await sql<FormRow[]>`
    ${FORM_SELECT(sql)}
    where f.slug = ${slug}
      and f.status = 'active'
      and f.archived_at is null
      and f.published_version_id is not null
  `;
  const row = rows[0];
  if (row === undefined) return null;
  const form = toForm(row);
  return form.publishedVersionId === null
    ? null
    : { ...form, publishedVersionId: form.publishedVersionId };
}

/** The default form, resolved the same way — this is what /register serves. */
export async function getPublishedDefaultForm(
  sql: Queryable,
): Promise<(FormRecord & { publishedVersionId: string }) | null> {
  const rows = await sql<FormRow[]>`
    ${FORM_SELECT(sql)}
    where f.is_default
      and f.status = 'active'
      and f.archived_at is null
      and f.published_version_id is not null
  `;
  const row = rows[0];
  if (row === undefined) return null;
  const form = toForm(row);
  return form.publishedVersionId === null
    ? null
    : { ...form, publishedVersionId: form.publishedVersionId };
}

export interface InsertSubmissionInput {
  formId: string;
  formVersionId: string;
  candidateId: string;
  roleCategoryId: string | null;
  sessionId: string | null;
  source: 'public_form' | 'backfill' | 'admin';
  formVersionHash: string | null;
  isCreatedCandidate: boolean;
  answerCount: number;
  ipHash: string | null;
}

/**
 * One submission per form per candidate is enforced by
 * uq_submission_per_form_per_candidate, so a repeat raises 23505 here rather
 * than being checked-then-inserted (which races).
 */
export async function insertSubmission(
  sql: Queryable,
  input: InsertSubmissionInput,
): Promise<{ id: string }> {
  const rows = await sql<{ id: string }[]>`
    insert into candidate_form_submissions
      (form_id, form_version_id, candidate_id, role_category_id, session_id,
       source, form_version_hash, is_created_candidate, answer_count, ip_hash)
    values (${input.formId}, ${input.formVersionId}, ${input.candidateId},
            ${input.roleCategoryId}, ${input.sessionId}, ${input.source},
            ${input.formVersionHash}, ${input.isCreatedCandidate},
            ${input.answerCount}, ${input.ipHash})
    returning id
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('submission insert returned no row');
  return row;
}

/** Set the candidate's primary role only when they do not already have one. */
export async function setPrimaryRoleCategoryIfUnset(
  sql: Queryable,
  candidateId: string,
  roleCategoryId: string,
): Promise<void> {
  await sql`
    update candidates set primary_role_category_id = ${roleCategoryId}
     where id = ${candidateId} and primary_role_category_id is null
  `;
}
