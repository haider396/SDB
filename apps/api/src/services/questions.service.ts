/**
 * Question-management business rules (docs/03-INTAKE-FORM-ENGINE.md §1.5, §2;
 * docs/04-API.md §4). No HTTP types, no SQL strings.
 *
 * Guard rails enforced here:
 * - `key` immutable after creation (auto-slug from label at create only)
 * - `question_type` frozen once answered → 409 QUESTION_TYPE_LOCKED
 * - mapped question keys cannot be archived or re-keyed → 409 MAPPED_QUESTION_PROTECTED
 * - validation bag strict-parsed → 422 INVALID_VALIDATION_RULE
 * - conditional cycles rejected → 422 CIRCULAR_CONDITION
 * - deactivating a question with conditional dependents → 200 + warnings[]
 * - option `value` frozen once referenced by any answer; options never hard-deleted
 * - every create/update/toggle writes an events row (AC-Q-12)
 * - every write invalidates the intake-form cache
 */
import {
  ValidationRulesSchema,
  isMappedQuestionKey,
  type CreateQuestionBody,
  type CreateQuestionCategoryBody,
  type CreateQuestionOptionBody,
  type ListQuestionsQuery,
  type Question,
  type QuestionCategory,
  type QuestionConditional,
  type QuestionDeactivateWarning,
  type QuestionDetail,
  type ReorderQuestionCategoriesBody,
  type ReorderQuestionsBody,
  type UpdateQuestionBody,
  type UpdateQuestionCategoryBody,
  type UpdateQuestionOptionBody,
  type UserRoleKey,
  type ValidationRules,
} from '@sdb/contracts';
import { withTransaction, type Db, type Queryable } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import {
  archiveQuestion as archiveQuestionRow,
  findCategoryById,
  findOption,
  findQuestionById,
  findQuestionByKey,
  getConditionalEdges,
  getLastAnsweredAt,
  getRoleScopes,
  insertCategory,
  insertOption,
  insertQuestion,
  isOptionReferenced,
  listCategories,
  listCategoryKeys,
  listDependents,
  listOptionsForQuestions,
  listQuestionKeys,
  listQuestions,
  reorderCategories,
  reorderQuestions,
  replaceRoleScopes,
  setCategoryActive,
  setOptionActive,
  setQuestionActive,
  updateCategory,
  updateOption,
  updateQuestion,
  type CategoryRecord,
  type QuestionRecord,
} from '../repositories/questions.repo.js';
import { emitEvent } from './events.js';

export interface Actor {
  userId: string;
  role: UserRoleKey | null;
}

export interface QuestionsServiceDeps {
  db: Db;
  /** Intake-form cache invalidation hook — called on every write. */
  invalidateFormCache: () => void;
}

const SELECT_TYPES = new Set(['single_select', 'multi_select']);

/** SQLSTATE of trg_block_question_type_change (object_not_in_prerequisite_state). */
const PG_TYPE_LOCKED = '55000';
const PG_UNIQUE_VIOLATION = '23505';

function pgCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_')
    .replaceAll(/^_+|_+$/g, '')
    .replaceAll(/_{2,}/g, '_');
  const bounded = slug.slice(0, 80).replace(/_+$/, '');
  if (bounded.length === 0) return 'question';
  return /^[a-z]/.test(bounded) ? bounded : `q_${bounded}`;
}

function uniqueKey(base: string, existing: Set<string>): string {
  if (!existing.has(base)) return base;
  for (let n = 2; ; n += 1) {
    const candidate = `${base}_${n}`;
    if (!existing.has(candidate)) return candidate;
  }
}

function parseValidationBag(
  validation: Record<string, unknown> | undefined,
): ValidationRules {
  const result = ValidationRulesSchema.safeParse(validation ?? {});
  if (!result.success) {
    throw new ApiError(
      'INVALID_VALIDATION_RULE',
      'The validation rules contain unknown or invalid keys.',
      {
        issues: result.error.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
        })),
      },
    );
  }
  return result.data;
}

function assertConditionalCoherent(conditional: QuestionConditional): void {
  const { operator, value } = conditional;
  if ((operator === 'equals' || operator === 'not_equals') && value === null) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `Conditional operator '${operator}' requires a comparison value.`,
      { fields: { conditional: 'A comparison value is required.' } },
    );
  }
  if (operator === 'in' && !Array.isArray(value)) {
    throw new ApiError(
      'VALIDATION_FAILED',
      "Conditional operator 'in' requires an array value.",
      { fields: { conditional: 'An array value is required.' } },
    );
  }
}

/**
 * Walk the conditional chain from `questionId` with the proposed controller
 * edge applied. Any return to the start (or an existing loop reached from it)
 * is a cycle → 422 CIRCULAR_CONDITION (03 §2.3).
 */
function assertNoConditionalCycle(
  edges: Map<string, string | null>,
  questionId: string,
  proposedControllerId: string,
): void {
  if (proposedControllerId === questionId) {
    throw new ApiError(
      'CIRCULAR_CONDITION',
      'A question cannot depend on itself.',
    );
  }
  const next = new Map(edges);
  next.set(questionId, proposedControllerId);
  const visited = new Set<string>([questionId]);
  let current: string | null = proposedControllerId;
  while (current !== null) {
    if (visited.has(current)) {
      throw new ApiError(
        'CIRCULAR_CONDITION',
        'This conditional chain forms a cycle.',
        { questionId, controllerId: proposedControllerId },
      );
    }
    visited.add(current);
    current = next.get(current) ?? null;
  }
}

async function resolveConditional(
  sql: Queryable,
  conditional: QuestionConditional,
): Promise<{ controllerId: string; operator: string; value: unknown }> {
  assertConditionalCoherent(conditional);
  const controller = await findQuestionByKey(sql, conditional.questionKey);
  if (controller === null || controller.archivedAt !== null) {
    throw new ApiError(
      'VALIDATION_FAILED',
      `Conditional references unknown question '${conditional.questionKey}'.`,
      { fields: { conditional: 'Unknown controlling question.' } },
    );
  }
  return {
    controllerId: controller.id,
    operator: conditional.operator,
    value: conditional.value,
  };
}

function toIso(date: Date): string {
  return date.toISOString();
}

// ---------------------------------------------------------------------------
// Assembly (records → contract shapes)
// ---------------------------------------------------------------------------

function mapCategory(record: CategoryRecord): QuestionCategory {
  return {
    id: record.id,
    key: record.key,
    label: record.label,
    description: record.description,
    sortOrder: record.sortOrder,
    isActive: record.isActive,
    questionCount: record.questionCount,
    createdAt: toIso(record.createdAt),
    updatedAt: toIso(record.updatedAt),
  };
}

export interface QuestionsService {
  listQuestions(query: ListQuestionsQuery): Promise<Question[]>;
  getQuestion(id: string): Promise<QuestionDetail>;
  createQuestion(body: CreateQuestionBody, actor: Actor): Promise<QuestionDetail>;
  updateQuestion(
    id: string,
    body: UpdateQuestionBody,
    actor: Actor,
  ): Promise<QuestionDetail>;
  setQuestionActive(
    id: string,
    isActive: boolean,
    actor: Actor,
  ): Promise<{ question: QuestionDetail; warnings: QuestionDeactivateWarning[] }>;
  archiveQuestion(id: string, actor: Actor): Promise<void>;
  duplicateQuestion(id: string, actor: Actor): Promise<QuestionDetail>;
  reorderQuestions(body: ReorderQuestionsBody, actor: Actor): Promise<void>;
  addOption(
    questionId: string,
    body: CreateQuestionOptionBody,
    actor: Actor,
  ): Promise<QuestionDetail>;
  updateOption(
    questionId: string,
    optionId: string,
    body: UpdateQuestionOptionBody,
    actor: Actor,
  ): Promise<QuestionDetail>;
  deactivateOption(
    questionId: string,
    optionId: string,
    actor: Actor,
  ): Promise<QuestionDetail>;
  listCategories(filter: { isActive?: boolean }): Promise<QuestionCategory[]>;
  createCategory(
    body: CreateQuestionCategoryBody,
    actor: Actor,
  ): Promise<QuestionCategory>;
  updateCategory(
    id: string,
    body: UpdateQuestionCategoryBody,
    actor: Actor,
  ): Promise<QuestionCategory>;
  setCategoryActive(
    id: string,
    isActive: boolean,
    actor: Actor,
  ): Promise<QuestionCategory>;
  reorderCategories(
    body: ReorderQuestionCategoriesBody,
    actor: Actor,
  ): Promise<void>;
}

export function createQuestionsService(
  deps: QuestionsServiceDeps,
): QuestionsService {
  const { db } = deps;

  async function assemble(
    records: QuestionRecord[],
    opts: { includeLastAnswered?: boolean } = {},
  ): Promise<Question[]> {
    const ids = records.map((record) => record.id);
    const [options, scopes, lastAnswered] = await Promise.all([
      listOptionsForQuestions(db, ids),
      getRoleScopes(db, ids),
      opts.includeLastAnswered === true
        ? getLastAnsweredAt(db, ids)
        : Promise.resolve(new Map<string, Date>()),
    ]);
    return records.map((record) => {
      const question: Question = {
        id: record.id,
        categoryId: record.categoryId,
        key: record.key,
        label: record.label,
        helpText: record.helpText,
        placeholder: record.placeholder,
        questionType: record.questionType,
        audience: record.audience,
        isRequired: record.isRequired,
        isActive: record.isActive,
        sortOrder: record.sortOrder,
        validation: ValidationRulesSchema.parse(record.validation),
        conditional:
          record.conditionalKey !== null && record.conditionalOperator !== null
            ? ({
                questionKey: record.conditionalKey,
                operator: record.conditionalOperator,
                value: record.conditionalValue ?? null,
              } as QuestionConditional)
            : null,
        options: (options.get(record.id) ?? []).map((option) => ({
          id: option.id,
          value: option.value,
          label: option.label,
          sortOrder: option.sortOrder,
          isActive: option.isActive,
        })),
        roleCategoryIds: scopes.get(record.id) ?? [],
        answerCount: record.answerCount,
        createdAt: toIso(record.createdAt),
        updatedAt: toIso(record.updatedAt),
        archivedAt: record.archivedAt === null ? null : toIso(record.archivedAt),
      };
      if (opts.includeLastAnswered === true) {
        const at = lastAnswered.get(record.id);
        question.lastAnsweredAt = at === undefined ? null : toIso(at);
      }
      return question;
    });
  }

  async function getDetail(id: string): Promise<QuestionDetail> {
    const record = await findQuestionById(db, id);
    if (record === null || record.archivedAt !== null) {
      throw new ApiError('NOT_FOUND', 'Question not found.');
    }
    const [assembled] = await assemble([record], { includeLastAnswered: true });
    if (assembled === undefined) {
      throw new ApiError('NOT_FOUND', 'Question not found.');
    }
    const dependents = await listDependents(db, id);
    return {
      ...assembled,
      lastAnsweredAt: assembled.lastAnsweredAt ?? null,
      dependents,
    };
  }

  async function requireQuestion(id: string): Promise<QuestionRecord> {
    const record = await findQuestionById(db, id);
    if (record === null || record.archivedAt !== null) {
      throw new ApiError('NOT_FOUND', 'Question not found.');
    }
    return record;
  }

  return {
    async listQuestions(query) {
      const records = await listQuestions(db, {
        ...(query.categoryId !== undefined ? { categoryId: query.categoryId } : {}),
        ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
        ...(query.roleCategoryId !== undefined
          ? { roleCategoryId: query.roleCategoryId }
          : {}),
      });
      return assemble(records, {
        includeLastAnswered: query.includeAnswerCounts === true,
      });
    },

    async getQuestion(id) {
      return getDetail(id);
    },

    async createQuestion(body, actor) {
      const category = await findCategoryById(db, body.categoryId);
      if (category === null) {
        throw new ApiError('NOT_FOUND', 'Question category not found.');
      }
      const validation = parseValidationBag(body.validation);
      if (
        body.options !== undefined &&
        body.options.length > 0 &&
        !SELECT_TYPES.has(body.questionType)
      ) {
        throw new ApiError(
          'VALIDATION_FAILED',
          `Options are only valid for select question types, not '${body.questionType}'.`,
          { fields: { options: 'Not a select question type.' } },
        );
      }

      const existingKeys = new Set(await listQuestionKeys(db));
      let key: string;
      if (body.key !== undefined) {
        if (existingKeys.has(body.key)) {
          throw new ApiError(
            'VALIDATION_FAILED',
            `A question with key '${body.key}' already exists.`,
            { fields: { key: 'Key already in use.' } },
          );
        }
        key = body.key;
      } else {
        key = uniqueKey(slugify(body.label), existingKeys);
      }

      const conditional =
        body.conditional === undefined || body.conditional === null
          ? null
          : await resolveConditional(db, body.conditional);

      const siblings = await listQuestions(db, { categoryId: body.categoryId });
      const sortOrder = body.sortOrder ?? siblings.length + 1;
      const isActive = body.isActive ?? true;

      let questionId: string;
      try {
        questionId = await withTransaction(db, async (tx) => {
          const id = await insertQuestion(tx, {
            categoryId: body.categoryId,
            key,
            label: body.label,
            helpText: body.helpText ?? null,
            placeholder: body.placeholder ?? null,
            questionType: body.questionType,
            audience: body.audience,
            isRequired: body.isRequired,
            isActive,
            sortOrder,
            validation: validation as Record<string, unknown>,
            conditionalOnQuestionId: conditional?.controllerId ?? null,
            conditionalOperator: conditional?.operator ?? null,
            conditionalValue: conditional?.value ?? null,
            createdBy: actor.userId,
          });
          for (const [index, option] of (body.options ?? []).entries()) {
            await insertOption(tx, {
              questionId: id,
              value: option.value,
              label: option.label,
              sortOrder: option.sortOrder ?? index + 1,
            });
          }
          await replaceRoleScopes(tx, id, body.roleCategoryIds ?? []);
          await emitEvent(tx, {
            entityType: 'question',
            entityId: id,
            eventType: 'question_created',
            actorId: actor.userId,
            actorRole: actor.role,
            fromValue: null,
            toValue: isActive ? 'active' : 'inactive',
            metadata: {
              key,
              questionType: body.questionType,
              categoryId: body.categoryId,
              audience: body.audience,
            },
          });
          return id;
        });
      } catch (error) {
        if (pgCode(error) === PG_UNIQUE_VIOLATION) {
          throw new ApiError(
            'VALIDATION_FAILED',
            'A question with this key or a duplicate option value already exists.',
            { fields: { key: 'Duplicate key or option value.' } },
          );
        }
        throw error;
      }
      deps.invalidateFormCache();
      return getDetail(questionId);
    },

    async updateQuestion(id, body, actor) {
      const current = await requireQuestion(id);

      // Guard rail: `key` is immutable after creation (03 §1.5, AC-Q-06/07).
      if (body.key !== undefined && body.key !== current.key) {
        if (isMappedQuestionKey(current.key)) {
          throw new ApiError(
            'MAPPED_QUESTION_PROTECTED',
            `'${current.key}' is a mapped question; its key cannot be changed.`,
            { key: current.key },
          );
        }
        throw new ApiError(
          'VALIDATION_FAILED',
          'A question key is immutable after creation.',
          { fields: { key: 'Key is immutable after creation.' } },
        );
      }

      // Guard rail: question_type frozen once answered (03 §1.5, AC-Q-05).
      if (
        body.questionType !== undefined &&
        body.questionType !== current.questionType &&
        current.answerCount > 0
      ) {
        throw new ApiError(
          'QUESTION_TYPE_LOCKED',
          `Question '${current.key}' has ${current.answerCount} answer(s); its type cannot change. Create a new question and deactivate this one.`,
          { from: current.questionType, to: body.questionType },
        );
      }

      const validation =
        body.validation === undefined
          ? undefined
          : parseValidationBag(body.validation);

      if (body.categoryId !== undefined) {
        const category = await findCategoryById(db, body.categoryId);
        if (category === null) {
          throw new ApiError('NOT_FOUND', 'Question category not found.');
        }
      }

      let conditionalPatch:
        | { conditionalOnQuestionId: string; conditionalOperator: string; conditionalValue: unknown }
        | null
        | undefined;
      if (body.conditional === undefined) {
        conditionalPatch = undefined;
      } else if (body.conditional === null) {
        conditionalPatch = null;
      } else {
        const resolved = await resolveConditional(db, body.conditional);
        const edges = await getConditionalEdges(db);
        assertNoConditionalCycle(edges, id, resolved.controllerId);
        conditionalPatch = {
          conditionalOnQuestionId: resolved.controllerId,
          conditionalOperator: resolved.operator,
          conditionalValue: resolved.value,
        };
      }

      const changes: Record<string, { from: unknown; to: unknown }> = {};
      if (body.label !== undefined && body.label !== current.label) {
        changes['label'] = { from: current.label, to: body.label };
      }
      if (body.helpText !== undefined && body.helpText !== current.helpText) {
        changes['helpText'] = { from: current.helpText, to: body.helpText };
      }
      if (body.placeholder !== undefined && body.placeholder !== current.placeholder) {
        changes['placeholder'] = { from: current.placeholder, to: body.placeholder };
      }
      if (body.questionType !== undefined && body.questionType !== current.questionType) {
        changes['questionType'] = { from: current.questionType, to: body.questionType };
      }
      if (body.audience !== undefined && body.audience !== current.audience) {
        changes['audience'] = { from: current.audience, to: body.audience };
      }
      if (body.isRequired !== undefined && body.isRequired !== current.isRequired) {
        changes['isRequired'] = { from: current.isRequired, to: body.isRequired };
      }
      if (body.sortOrder !== undefined && body.sortOrder !== current.sortOrder) {
        changes['sortOrder'] = { from: current.sortOrder, to: body.sortOrder };
      }
      if (body.categoryId !== undefined && body.categoryId !== current.categoryId) {
        changes['categoryId'] = { from: current.categoryId, to: body.categoryId };
      }
      if (validation !== undefined) {
        changes['validation'] = { from: current.validation, to: validation };
      }
      if (body.conditional !== undefined) {
        changes['conditional'] = {
          from: current.conditionalKey,
          to: body.conditional?.questionKey ?? null,
        };
      }
      if (body.roleCategoryIds !== undefined) {
        changes['roleCategoryIds'] = { from: null, to: body.roleCategoryIds };
      }

      try {
        await withTransaction(db, async (tx) => {
          await updateQuestion(tx, id, {
            ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
            ...(body.label !== undefined ? { label: body.label } : {}),
            ...(body.helpText !== undefined ? { helpText: body.helpText } : {}),
            ...(body.placeholder !== undefined
              ? { placeholder: body.placeholder }
              : {}),
            ...(body.questionType !== undefined
              ? { questionType: body.questionType }
              : {}),
            ...(body.audience !== undefined ? { audience: body.audience } : {}),
            ...(body.isRequired !== undefined
              ? { isRequired: body.isRequired }
              : {}),
            ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
            ...(validation !== undefined
              ? { validation: validation as Record<string, unknown> }
              : {}),
            ...(conditionalPatch !== undefined
              ? { conditional: conditionalPatch }
              : {}),
          });
          if (body.roleCategoryIds !== undefined) {
            await replaceRoleScopes(tx, id, body.roleCategoryIds);
          }
          await emitEvent(tx, {
            entityType: 'question',
            entityId: id,
            eventType: 'question_updated',
            actorId: actor.userId,
            actorRole: actor.role,
            metadata: { key: current.key, changes },
          });
        });
      } catch (error) {
        // Backstop: trg_block_question_type_change (AC-DB-09) raises 55000.
        if (pgCode(error) === PG_TYPE_LOCKED) {
          throw new ApiError(
            'QUESTION_TYPE_LOCKED',
            `Question '${current.key}' has answers; its type cannot change.`,
            { from: current.questionType, to: body.questionType ?? null },
          );
        }
        throw error;
      }
      deps.invalidateFormCache();
      return getDetail(id);
    },

    async setQuestionActive(id, isActive, actor) {
      const current = await requireQuestion(id);
      const warnings: QuestionDeactivateWarning[] = [];

      if (!isActive) {
        const dependents = await listDependents(db, id);
        for (const dependent of dependents.filter((entry) => entry.isActive)) {
          warnings.push({
            code: 'CONDITIONAL_DEPENDENT',
            message: `Question '${dependent.label}' (${dependent.key}) is conditionally shown based on this question and will no longer appear.`,
            dependent,
          });
        }
      }

      if (current.isActive !== isActive) {
        await withTransaction(db, async (tx) => {
          await setQuestionActive(tx, id, isActive);
          await emitEvent(tx, {
            entityType: 'question',
            entityId: id,
            eventType: isActive ? 'question_activated' : 'question_deactivated',
            actorId: actor.userId,
            actorRole: actor.role,
            fromValue: current.isActive ? 'active' : 'inactive',
            toValue: isActive ? 'active' : 'inactive',
            metadata: { key: current.key },
          });
        });
        deps.invalidateFormCache();
      }

      return { question: await getDetail(id), warnings };
    },

    async archiveQuestion(id, actor) {
      const current = await requireQuestion(id);
      // Guard rail: mapped questions cannot be deleted (03 §3.4, AC-Q-07).
      if (isMappedQuestionKey(current.key)) {
        throw new ApiError(
          'MAPPED_QUESTION_PROTECTED',
          `'${current.key}' is a mapped question and cannot be deleted. Deactivate it instead.`,
          { key: current.key },
        );
      }
      await withTransaction(db, async (tx) => {
        await archiveQuestionRow(tx, id);
        await emitEvent(tx, {
          entityType: 'question',
          entityId: id,
          eventType: 'question_archived',
          actorId: actor.userId,
          actorRole: actor.role,
          fromValue: current.isActive ? 'active' : 'inactive',
          toValue: 'archived',
          metadata: { key: current.key },
        });
      });
      deps.invalidateFormCache();
    },

    async duplicateQuestion(id, actor) {
      const source = await requireQuestion(id);
      const [options, scopes, existingKeys] = await Promise.all([
        listOptionsForQuestions(db, [id]),
        getRoleScopes(db, [id]),
        listQuestionKeys(db),
      ]);
      const key = uniqueKey(`${source.key}_copy`, new Set(existingKeys));

      const newId = await withTransaction(db, async (tx) => {
        const created = await insertQuestion(tx, {
          categoryId: source.categoryId,
          key,
          label: source.label,
          helpText: source.helpText,
          placeholder: source.placeholder,
          questionType: source.questionType,
          audience: source.audience,
          isRequired: source.isRequired,
          isActive: false, // duplicates start inactive (04 §4)
          sortOrder: source.sortOrder + 1,
          validation: source.validation,
          conditionalOnQuestionId: source.conditionalOnQuestionId,
          conditionalOperator: source.conditionalOperator,
          conditionalValue: source.conditionalValue,
          createdBy: actor.userId,
        });
        for (const option of options.get(id) ?? []) {
          await insertOption(tx, {
            questionId: created,
            value: option.value,
            label: option.label,
            sortOrder: option.sortOrder,
          });
        }
        await replaceRoleScopes(tx, created, scopes.get(id) ?? []);
        await emitEvent(tx, {
          entityType: 'question',
          entityId: created,
          eventType: 'question_created',
          actorId: actor.userId,
          actorRole: actor.role,
          fromValue: null,
          toValue: 'inactive',
          metadata: { key, duplicatedFrom: source.key },
        });
        return created;
      });
      deps.invalidateFormCache();
      return getDetail(newId);
    },

    async reorderQuestions(body, actor) {
      const category = await findCategoryById(db, body.categoryId);
      if (category === null) {
        throw new ApiError('NOT_FOUND', 'Question category not found.');
      }
      const siblings = await listQuestions(db, { categoryId: body.categoryId });
      const siblingIds = new Set(siblings.map((entry) => entry.id));
      const foreign = body.orderedQuestionIds.filter((qid) => !siblingIds.has(qid));
      if (foreign.length > 0) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'orderedQuestionIds contains questions outside this category.',
          { fields: { orderedQuestionIds: `Unknown ids: ${foreign.join(', ')}` } },
        );
      }
      await withTransaction(db, async (tx) => {
        await reorderQuestions(tx, body.categoryId, body.orderedQuestionIds);
        await emitEvent(tx, {
          entityType: 'question_category',
          entityId: body.categoryId,
          eventType: 'questions_reordered',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: { orderedQuestionIds: body.orderedQuestionIds },
        });
      });
      deps.invalidateFormCache();
    },

    async addOption(questionId, body, actor) {
      const question = await requireQuestion(questionId);
      const existing = await listOptionsForQuestions(db, [questionId]);
      const count = (existing.get(questionId) ?? []).length;
      try {
        await withTransaction(db, async (tx) => {
          const optionId = await insertOption(tx, {
            questionId,
            value: body.value,
            label: body.label,
            sortOrder: body.sortOrder ?? count + 1,
          });
          await emitEvent(tx, {
            entityType: 'question',
            entityId: questionId,
            eventType: 'question_updated',
            actorId: actor.userId,
            actorRole: actor.role,
            metadata: {
              key: question.key,
              optionAdded: { id: optionId, value: body.value, label: body.label },
            },
          });
        });
      } catch (error) {
        if (pgCode(error) === PG_UNIQUE_VIOLATION) {
          throw new ApiError(
            'VALIDATION_FAILED',
            `An option with value '${body.value}' already exists on this question.`,
            { fields: { value: 'Duplicate option value.' } },
          );
        }
        throw error;
      }
      deps.invalidateFormCache();
      return getDetail(questionId);
    },

    async updateOption(questionId, optionId, body, actor) {
      const question = await requireQuestion(questionId);
      const option = await findOption(db, questionId, optionId);
      if (option === null) {
        throw new ApiError('NOT_FOUND', 'Option not found.');
      }
      // Guard rail: option value frozen once referenced by any answer (03 §1.5).
      if (body.value !== undefined && body.value !== option.value) {
        if (await isOptionReferenced(db, optionId)) {
          throw new ApiError(
            'VALIDATION_FAILED',
            'This option is referenced by existing answers; its value cannot change. Edit the label instead.',
            { fields: { value: 'Value is frozen once referenced by answers.' } },
          );
        }
      }
      await withTransaction(db, async (tx) => {
        await updateOption(tx, optionId, {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          ...(body.value !== undefined ? { value: body.value } : {}),
        });
        await emitEvent(tx, {
          entityType: 'question',
          entityId: questionId,
          eventType: 'question_updated',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: {
            key: question.key,
            optionUpdated: { id: optionId, from: option, to: body },
          },
        });
      });
      deps.invalidateFormCache();
      return getDetail(questionId);
    },

    async deactivateOption(questionId, optionId, actor) {
      const question = await requireQuestion(questionId);
      const option = await findOption(db, questionId, optionId);
      if (option === null) {
        throw new ApiError('NOT_FOUND', 'Option not found.');
      }
      if (option.isActive) {
        await withTransaction(db, async (tx) => {
          await setOptionActive(tx, optionId, false);
          await emitEvent(tx, {
            entityType: 'question',
            entityId: questionId,
            eventType: 'question_updated',
            actorId: actor.userId,
            actorRole: actor.role,
            metadata: {
              key: question.key,
              optionDeactivated: { id: optionId, value: option.value },
            },
          });
        });
        deps.invalidateFormCache();
      }
      return getDetail(questionId);
    },

    async listCategories(filter) {
      const records = await listCategories(db, filter);
      return records.map(mapCategory);
    },

    async createCategory(body, actor) {
      const existingKeys = new Set(await listCategoryKeys(db));
      let key: string;
      if (body.key !== undefined) {
        if (existingKeys.has(body.key)) {
          throw new ApiError(
            'VALIDATION_FAILED',
            `A category with key '${body.key}' already exists.`,
            { fields: { key: 'Key already in use.' } },
          );
        }
        key = body.key;
      } else {
        key = uniqueKey(slugify(body.label), existingKeys);
      }
      const siblings = await listCategories(db);
      const id = await withTransaction(db, async (tx) => {
        const created = await insertCategory(tx, {
          key,
          label: body.label,
          description: body.description ?? null,
          sortOrder: body.sortOrder ?? siblings.length + 1,
        });
        await emitEvent(tx, {
          entityType: 'question_category',
          entityId: created,
          eventType: 'category_created',
          actorId: actor.userId,
          actorRole: actor.role,
          fromValue: null,
          toValue: 'active',
          metadata: { key, label: body.label },
        });
        return created;
      });
      deps.invalidateFormCache();
      const record = await findCategoryById(db, id);
      if (record === null) throw new ApiError('NOT_FOUND', 'Category not found.');
      return mapCategory(record);
    },

    async updateCategory(id, body, actor) {
      const current = await findCategoryById(db, id);
      if (current === null) {
        throw new ApiError('NOT_FOUND', 'Question category not found.');
      }
      await withTransaction(db, async (tx) => {
        await updateCategory(tx, id, {
          ...(body.label !== undefined ? { label: body.label } : {}),
          ...(body.description !== undefined
            ? { description: body.description }
            : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
        });
        await emitEvent(tx, {
          entityType: 'question_category',
          entityId: id,
          eventType: 'category_updated',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: { key: current.key, changes: body },
        });
      });
      deps.invalidateFormCache();
      const record = await findCategoryById(db, id);
      if (record === null) throw new ApiError('NOT_FOUND', 'Category not found.');
      return mapCategory(record);
    },

    async setCategoryActive(id, isActive, actor) {
      const current = await findCategoryById(db, id);
      if (current === null) {
        throw new ApiError('NOT_FOUND', 'Question category not found.');
      }
      if (current.isActive !== isActive) {
        await withTransaction(db, async (tx) => {
          // Cascades visibility only — per-question is_active is untouched, so
          // reactivating restores the previous per-question state (03 §2.1).
          await setCategoryActive(tx, id, isActive);
          await emitEvent(tx, {
            entityType: 'question_category',
            entityId: id,
            eventType: isActive ? 'category_activated' : 'category_deactivated',
            actorId: actor.userId,
            actorRole: actor.role,
            fromValue: current.isActive ? 'active' : 'inactive',
            toValue: isActive ? 'active' : 'inactive',
            metadata: { key: current.key },
          });
        });
        deps.invalidateFormCache();
      }
      const record = await findCategoryById(db, id);
      if (record === null) throw new ApiError('NOT_FOUND', 'Category not found.');
      return mapCategory(record);
    },

    async reorderCategories(body, actor) {
      const all = await listCategories(db);
      const known = new Set(all.map((entry) => entry.id));
      const foreign = body.orderedCategoryIds.filter((cid) => !known.has(cid));
      if (foreign.length > 0) {
        throw new ApiError(
          'VALIDATION_FAILED',
          'orderedCategoryIds contains unknown categories.',
          { fields: { orderedCategoryIds: `Unknown ids: ${foreign.join(', ')}` } },
        );
      }
      const first = body.orderedCategoryIds[0];
      if (first === undefined) return;
      await withTransaction(db, async (tx) => {
        await reorderCategories(tx, body.orderedCategoryIds);
        await emitEvent(tx, {
          entityType: 'question_category',
          entityId: first,
          eventType: 'categories_reordered',
          actorId: actor.userId,
          actorRole: actor.role,
          metadata: { orderedCategoryIds: body.orderedCategoryIds },
        });
      });
      deps.invalidateFormCache();
    },
  };
}
