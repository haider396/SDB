/**
 * Intake form rendering (docs/03-INTAKE-FORM-ENGINE.md §3.1–§3.2) and the
 * public taxonomy cascade, with the server-side cache honouring
 * `intake.form_cache_ttl_seconds` from app_settings.
 *
 * - The cache is in-process, keyed per role-category scope, and invalidated
 *   by every question/category/option write (services/questions.service.ts
 *   calls `clearCache()`).
 * - `now()` is injectable so AC-Q-01's clock-controlled TTL test needs no
 *   global timer mocking.
 * - `formVersionHash` is a stable SHA-256 of the serialised active
 *   configuration (rule 7): categories/questions/options are serialised in
 *   their deterministic sort order, excluding volatile fields (generatedAt).
 */
import { createHash } from 'node:crypto';
import type {
  IntakeFormCategory,
  IntakeFormQuestion,
  IntakeFormResponse,
  JsonValue,
  PublicTaxonomy,
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
import { getPublicTaxonomy } from '../repositories/taxonomy.repo.js';

export interface IntakeFormServiceDeps {
  db: Db;
  /** Injectable clock (epoch ms) for TTL control in tests. */
  now?: () => number;
}

export interface IntakeFormService {
  /** The public form payload for a role-category scope (null = universal only). */
  getForm(roleCategoryId: string | null): Promise<IntakeFormResponse>;
  getTaxonomy(): Promise<PublicTaxonomy>;
  /** Invalidate every cached payload — called on any question-config write. */
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
    // The write path guarantees a valid bag; parse keeps the response honest.
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

export function buildFormCategories(
  records: FormQuestionRecord[],
): IntakeFormCategory[] {
  const categories: IntakeFormCategory[] = [];
  const index = new Map<string, number>();
  for (const record of records) {
    let categoryIdx = index.get(record.categoryId);
    if (categoryIdx === undefined) {
      categoryIdx = categories.length;
      index.set(record.categoryId, categoryIdx);
      categories.push({
        id: record.categoryId,
        key: record.categoryKey,
        label: record.categoryLabel,
        description: record.categoryDescription,
        sortOrder: record.categorySortOrder,
        questions: [],
      });
    }
    categories[categoryIdx]?.questions.push(toFormQuestion(record));
  }
  // Rule 6: empty categories are omitted — impossible here by construction
  // (a category only appears when at least one visible question referenced it).
  return categories;
}

/** Stable SHA-256 over the deterministic serialisation of the active config. */
export function computeFormVersionHash(
  categories: IntakeFormCategory[],
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify(categories))
    .digest('hex');
  return `sha256:${digest}`;
}

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export function createIntakeFormService(
  deps: IntakeFormServiceDeps,
): IntakeFormService {
  const now = deps.now ?? Date.now;
  const formCache = new Map<string, CacheEntry<IntakeFormResponse>>();
  let taxonomyCache: CacheEntry<PublicTaxonomy> | null = null;

  return {
    async getForm(roleCategoryId) {
      const key = roleCategoryId ?? '*';
      const hit = formCache.get(key);
      if (hit !== undefined && hit.expiresAt > now()) return hit.value;

      const [records, ttlSeconds] = await Promise.all([
        getActiveFormQuestions(deps.db, roleCategoryId),
        getFormCacheTtlSeconds(deps.db),
      ]);
      const categories = buildFormCategories(records);
      const payload: IntakeFormResponse = {
        formVersionHash: computeFormVersionHash(categories),
        generatedAt: new Date(now()).toISOString(),
        categories,
      };
      formCache.set(key, { value: payload, expiresAt: now() + ttlSeconds * 1000 });
      return payload;
    },

    async getTaxonomy() {
      if (taxonomyCache !== null && taxonomyCache.expiresAt > now()) {
        return taxonomyCache.value;
      }
      const [taxonomy, ttlSeconds] = await Promise.all([
        getPublicTaxonomy(deps.db),
        getFormCacheTtlSeconds(deps.db),
      ]);
      taxonomyCache = { value: taxonomy, expiresAt: now() + ttlSeconds * 1000 };
      return taxonomy;
    },

    clearCache() {
      formCache.clear();
      taxonomyCache = null;
    },
  };
}
