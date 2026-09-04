/**
 * Candidate registration form rendering (T38).
 *
 * The candidate twin of intake-form.service. Same engine, same cache
 * discipline, same stable `formVersionHash` — the only differences are the
 * audience ('candidate') and the absence of a role-category scope: a
 * registering candidate is not applying to one role, so every active
 * candidate-audience question is returned.
 *
 * `audience` is pinned here and never taken from the request, so
 * `audience=internal` is unreachable from outside (AC-IF-02 applies equally
 * to this endpoint).
 */
import { createHash } from 'node:crypto';
import type {
  CandidateRegistrationFormResponse,
  IntakeFormCategory,
  IntakeFormQuestion,
  JsonValue,
} from '@sdb/contracts';
import {
  ConditionalOperatorSchema,
  ValidationRulesSchema,
} from '@sdb/contracts';
import type { Db } from '../lib/db.js';
import {
  getActiveFormQuestions,
  getFormCacheTtlSeconds,
  type FormQuestionRecord,
} from '../repositories/intake.repo.js';

export interface CandidateRegistrationFormServiceDeps {
  db: Db;
  /** Injectable clock (epoch ms) so TTL behaviour is testable without timers. */
  now?: () => number;
}

export interface CandidateRegistrationFormService {
  getForm(): Promise<CandidateRegistrationFormResponse>;
  /** Invalidate the cached payload — called on any question-config write. */
  clearCache(): void;
}

function toFormQuestion(record: FormQuestionRecord): IntakeFormQuestion {
  const operator = ConditionalOperatorSchema.safeParse(
    record.conditionalOperator,
  );
  return {
    id: record.id,
    key: record.key,
    label: record.label,
    helpText: record.helpText,
    placeholder: record.placeholder,
    questionType: record.questionType,
    isRequired: record.isRequired,
    sortOrder: record.sortOrder,
    validation: ValidationRulesSchema.parse(record.validation),
    options: record.options.map((option) => ({
      value: option.value,
      label: option.label,
    })),
    conditional:
      record.conditionalKey !== null && operator.success
        ? {
            questionKey: record.conditionalKey,
            operator: operator.data,
            value: (record.conditionalValue ?? null) as JsonValue | null,
          }
        : null,
  };
}

/** Group flat question records into their categories, preserving sort order. */
function toCategories(records: FormQuestionRecord[]): IntakeFormCategory[] {
  const categories = new Map<string, IntakeFormCategory>();
  for (const record of records) {
    let category = categories.get(record.categoryId);
    if (category === undefined) {
      category = {
        id: record.categoryId,
        key: record.categoryKey,
        label: record.categoryLabel,
        description: record.categoryDescription,
        sortOrder: record.categorySortOrder,
        questions: [],
      };
      categories.set(record.categoryId, category);
    }
    category.questions.push(toFormQuestion(record));
  }
  // Rule 6: a category with no visible questions is omitted entirely — which
  // this grouping gives for free, since a category only appears if a question
  // put it there.
  return [...categories.values()];
}

/**
 * Stable hash of the active configuration. Excludes volatile fields
 * (generatedAt) so an unchanged question set always hashes identically.
 */
function hashForm(categories: IntakeFormCategory[]): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(categories))
    .digest('hex');
  return `sha256:${digest}`;
}

export function createCandidateRegistrationFormService(
  deps: CandidateRegistrationFormServiceDeps,
): CandidateRegistrationFormService {
  const now = deps.now ?? (() => Date.now());
  let cached: { payload: CandidateRegistrationFormResponse; expiresAt: number } | null =
    null;

  return {
    async getForm() {
      const current = now();
      if (cached !== null && cached.expiresAt > current) {
        return cached.payload;
      }
      const [records, ttlSeconds] = await Promise.all([
        getActiveFormQuestions(deps.db, null, 'candidate'),
        getFormCacheTtlSeconds(deps.db),
      ]);
      const categories = toCategories(records);
      const payload: CandidateRegistrationFormResponse = {
        formVersionHash: hashForm(categories),
        generatedAt: new Date(current).toISOString(),
        categories,
      };
      cached = { payload, expiresAt: current + ttlSeconds * 1000 };
      return payload;
    },

    clearCache() {
      cached = null;
    },
  };
}
