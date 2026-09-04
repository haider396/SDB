/**
 * Serving a built form at its public link.
 *
 * ── THE INTERSECTION IS THE SECURITY BOUNDARY ───────────────────────────────
 * A form's blocks name question ids. Rather than trusting those rows, this
 * service computes the candidate-audience question set independently —
 * `getActiveFormQuestions(db, roleCategoryId, 'candidate')`, with the audience
 * PINNED in code exactly as candidate-registration-form.service.ts does — and
 * then intersects the blocks against it.
 *
 * So AC-IF-02 ("internal questions are never exposed publicly") becomes a
 * property of the query rather than a guard someone could forget: even if an
 * internal-audience block row existed, it could neither render nor be
 * answered. The same intersection handles deactivated and archived questions
 * for free.
 *
 * The response carries `categories` in the EXISTING shape as well as the new
 * block/theme payload, so the current renderer keeps working unchanged while
 * the canvas renderer is built.
 */
import { createHash } from 'node:crypto';
import type {
  FormBlock,
  FormPage,
  FormTheme,
  IntakeFormCategory,
  IntakeFormQuestion,
  JsonValue,
} from '@sdb/contracts';
import {
  ConditionalOperatorSchema,
  FormBlockSchema,
  FormPageSchema,
  FormThemeSchema,
  ValidationRulesSchema,
} from '@sdb/contracts';
import type { Db } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import {
  getActiveFormQuestions,
  getFormCacheTtlSeconds,
  type FormQuestionRecord,
} from '../repositories/intake.repo.js';
import * as formsRepo from '../repositories/candidate-forms.repo.js';

export interface PublicFormPayload {
  form: {
    slug: string;
    key: string;
    label: string;
    description: string | null;
    hasTypingTest: boolean;
    hasDocumentsStep: boolean;
    isDefault: boolean;
    roleCategory: { id: string; key: string; label: string } | null;
  };
  formVersionId: string;
  formVersionHash: string;
  generatedAt: string;
  theme: FormTheme;
  pages: FormPage[];
  blocks: FormBlock[];
  /** The existing renderer's shape, kept so nothing has to change at once. */
  categories: IntakeFormCategory[];
}

/**
 * The resolved question scope for a form, used by BOTH the public payload and
 * the submit path so the two can never disagree about what the form asks.
 */
export interface ResolvedFormScope {
  form: formsRepo.FormRecord & { publishedVersionId: string };
  versionId: string;
  /** Only questions that survived the intersection, with overrides applied. */
  scope: FormQuestionRecord[];
  blocks: formsRepo.BlockRecord[];
  pages: FormPage[];
  theme: FormTheme;
}

export interface CandidateFormPublicServiceDeps {
  db: Db;
  now?: () => number;
}

export interface CandidateFormPublicService {
  /** Payload for /f/:slug. Throws NOT_FOUND for anything not live. */
  getBySlug(slug: string): Promise<PublicFormPayload>;
  /** Payload for /register — the seeded default form. */
  getDefault(): Promise<PublicFormPayload>;
  /** Scope resolution for the submit path. */
  resolveScope(slug: string | null): Promise<ResolvedFormScope>;
  clearCache(): void;
}

function toFormQuestion(record: FormQuestionRecord): IntakeFormQuestion {
  const operator = ConditionalOperatorSchema.safeParse(record.conditionalOperator);
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

/**
 * Overlay a block's per-form overrides onto the library question.
 *
 * `null` means "use the library's"; an empty STRING is a real override — a
 * deliberately blank help line — so the checks below are against null, never
 * against falsiness.
 *
 * Choice overrides are a SUBSET, filtered from the question's own options and
 * ordered as the form lists them. A value the question does not have is
 * ignored rather than invented, so an answer can never reference an option row
 * that does not exist.
 *
 * Exported for tests: the property that matters — the snapshot records the
 * wording the candidate SAW — is a consequence of this running before
 * buildSnapshot, and that is worth pinning directly.
 */
export function applyBlockOverrides(
  question: FormQuestionRecord,
  block: formsRepo.BlockRecord,
): FormQuestionRecord {
  const next: FormQuestionRecord = { ...question };

  if (block.isRequiredOverride !== null) {
    next.isRequired = block.isRequiredOverride;
  }
  if (block.labelOverride !== null) next.label = block.labelOverride;
  if (block.placeholderOverride !== null) {
    next.placeholder = block.placeholderOverride;
  }
  if (block.helpTextOverride !== null) next.helpText = block.helpTextOverride;

  if (block.optionValueOverrides !== null) {
    const byValue = new Map(question.options.map((option) => [option.value, option]));
    next.options = block.optionValueOverrides
      .map((value) => byValue.get(value))
      .filter((option): option is (typeof question.options)[number] => option !== undefined);
  }
  return next;
}

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
  return [...categories.values()];
}

/** Stable across requests: excludes generatedAt, includes layout and theme. */
function hashPayload(
  categories: IntakeFormCategory[],
  blocks: FormBlock[],
  theme: FormTheme,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ categories, blocks, theme }))
    .digest('hex');
  return `sha256:${digest}`;
}

export function createCandidateFormPublicService(
  deps: CandidateFormPublicServiceDeps,
): CandidateFormPublicService {
  const now = deps.now ?? (() => Date.now());
  const cache = new Map<string, { payload: PublicFormPayload; expiresAt: number }>();

  /**
   * Resolve a live form, then intersect its blocks with the independently
   * computed candidate-audience scope. Shared by the payload and the submit
   * path so both agree on exactly what the form asks.
   */
  async function resolve(slug: string | null): Promise<ResolvedFormScope> {
    const form =
      slug === null
        ? await formsRepo.getPublishedDefaultForm(deps.db)
        : await formsRepo.getPublishedFormBySlug(deps.db, slug);

    // A draft, deactivated, archived or unknown slug are all the same 404 —
    // a closed form must not leak that it was ever open.
    if (form === null) {
      throw new ApiError('NOT_FOUND', 'This form is not available.');
    }

    const versionId = form.publishedVersionId;
    const [blocks, version, candidateQuestions] = await Promise.all([
      formsRepo.getBlocks(deps.db, versionId),
      formsRepo.getVersion(deps.db, versionId),
      // AUDIENCE PINNED IN CODE — never read from the request (AC-IF-02).
      getActiveFormQuestions(deps.db, form.roleCategoryId, 'candidate'),
    ]);
    if (version === null) {
      throw new ApiError('NOT_FOUND', 'This form is not available.');
    }

    const allowed = new Map(candidateQuestions.map((q) => [q.id, q]));
    const liveBlocks = blocks.filter(
      (block) => block.questionId === null || allowed.has(block.questionId),
    );

    /*
     * Block order is the form's order, and a block may override the question's
     * wording, its choices and whether it is required.
     *
     * ⚠ These are applied HERE, before validateSubmission and therefore before
     * buildSnapshot, and that ordering is the whole design. The snapshot is the
     * record of what a candidate was asked (03 §1.4) — if the override were
     * applied later, at render time only, the snapshot would record the library
     * wording while the candidate saw something else, and the historical record
     * would be a lie.
     *
     * The validator itself needs no knowledge of forms as a result.
     */
    const scope: FormQuestionRecord[] = [];
    for (const block of liveBlocks) {
      if (block.questionId === null) continue;
      const question = allowed.get(block.questionId);
      if (question === undefined) continue;
      scope.push(applyBlockOverrides(question, block));
    }

    return {
      form,
      versionId,
      scope,
      blocks: liveBlocks,
      pages: FormPageSchema.array().parse(version.pages),
      theme: FormThemeSchema.parse(version.theme),
    };
  }

  function toPayload(resolved: ResolvedFormScope, current: number): PublicFormPayload {
    const categories = toCategories(resolved.scope);
    const blocks = resolved.blocks.map((block) =>
      FormBlockSchema.parse({
        id: block.id,
        parentBlockId: block.parentBlockId,
        blockType: block.blockType,
        questionId: block.questionId,
        pageIndex: block.pageIndex,
        sortOrder: block.sortOrder,
        layout: block.layout,
        style: block.style,
        props: block.props,
        isRequiredOverride: block.isRequiredOverride,
        // Reported for completeness. The renderer takes its wording from
        // `categories`, which resolve() has ALREADY overridden — these are the
        // same values, not a second place to apply them. Returning null here
        // while the row holds a value would make the payload lie to whoever
        // reads it next.
        labelOverride: block.labelOverride,
        placeholderOverride: block.placeholderOverride,
        helpTextOverride: block.helpTextOverride,
        optionValueOverrides: block.optionValueOverrides,
      }),
    );
    return {
      form: {
        slug: resolved.form.slug,
        key: resolved.form.key,
        label: resolved.form.label,
        description: resolved.form.description,
        hasTypingTest: resolved.form.hasTypingTest,
        hasDocumentsStep: resolved.form.hasDocumentsStep,
        isDefault: resolved.form.isDefault,
        roleCategory:
          resolved.form.roleCategoryId === null ||
          resolved.form.roleCategoryKey === null ||
          resolved.form.roleCategoryLabel === null
            ? null
            : {
                id: resolved.form.roleCategoryId,
                key: resolved.form.roleCategoryKey,
                label: resolved.form.roleCategoryLabel,
              },
      },
      formVersionId: resolved.versionId,
      formVersionHash: hashPayload(categories, blocks, resolved.theme),
      generatedAt: new Date(current).toISOString(),
      theme: resolved.theme,
      pages: resolved.pages,
      blocks,
      categories,
    };
  }

  async function serve(slug: string | null): Promise<PublicFormPayload> {
    const key = slug ?? '__default';
    const current = now();
    const hit = cache.get(key);
    if (hit !== undefined && hit.expiresAt > current) return hit.payload;

    const resolved = await resolve(slug);
    const payload = toPayload(resolved, current);
    const ttlSeconds = await getFormCacheTtlSeconds(deps.db);
    cache.set(key, { payload, expiresAt: current + ttlSeconds * 1000 });
    return payload;
  }

  return {
    getBySlug: (slug) => serve(slug),
    getDefault: () => serve(null),
    resolveScope: (slug) => resolve(slug),
    clearCache() {
      cache.clear();
    },
  };
}
