/**
 * Intake submission engine (docs/03-INTAKE-FORM-ENGINE.md §3.3–§3.5,
 * docs/06-BACKEND.md §2.1).
 *
 * One engine, two entry points:
 * - `submitPublic`  → POST /api/v1/intake-submissions (unauthenticated):
 *   creates the prospect client + requisition.
 * - `submitInPortal` → POST /api/v1/requisitions (authenticated): attaches to
 *   an existing client.
 *
 * The 6-step validation pipeline runs IN ORDER and fails fast with field-level
 * error maps. On success everything is written in ONE transaction: client
 * (public only), requisition (sequence-backed reference), one answer row per
 * answer with `question_snapshot`, answer-option rows, the `intake_submitted`
 * event, and one queued notification_log row per active admin (dispatch is P7).
 */
import {
  AccentStrengthSchema,
  EngagementTypeSchema,
  LanguageLevelSchema,
  RateUnitSchema,
  type IntakeAnswer,
  type IntakeSubmission,
  type QuestionType,
  type UserRoleKey,
} from '@sdb/contracts';
import { withTransaction, type Db } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import {
  clientExists,
  enqueueNotification,
  findDepartmentIdByKey,
  findEngineIdByKey,
  findRoleCategoryLineage,
  getActiveAdmins,
  getActiveFormQuestions,
  insertAnswer,
  insertAnswerOptions,
  insertProspectClient,
  insertRequisition,
  type FormQuestionRecord,
  type RequisitionInsert,
} from '../repositories/intake.repo.js';
import { emitEvent } from './events.js';
import type { IntakeFormService } from './intake-form.service.js';

// ---------------------------------------------------------------------------
// Value plumbing
// ---------------------------------------------------------------------------

type ValueField =
  | 'valueText'
  | 'valueNumber'
  | 'valueBoolean'
  | 'valueDate'
  | 'valueJson';

const VALUE_FIELDS: readonly ValueField[] = [
  'valueText',
  'valueNumber',
  'valueBoolean',
  'valueDate',
  'valueJson',
];

/** Value column expected per question type — mirrors trg_answer_value_shape. */
const EXPECTED_FIELD: Record<QuestionType, ValueField> = {
  short_text: 'valueText',
  long_text: 'valueText',
  email: 'valueText',
  phone: 'valueText',
  single_select: 'valueText',
  number: 'valueNumber',
  scale: 'valueNumber',
  yes_no: 'valueBoolean',
  date: 'valueDate',
  multi_select: 'valueJson',
  currency_range: 'valueJson',
  file_upload: 'valueJson',
};

function providedField(answer: IntakeAnswer): ValueField {
  for (const field of VALUE_FIELDS) {
    if (answer[field] !== undefined) return field;
  }
  // Unreachable: the contract enforces exactly one populated field.
  throw new ApiError('MALFORMED_REQUEST', 'Answer carries no value field.');
}

/** "Non-empty" per 03 §3.3 step 2 — mirrors the web's isBlank. */
function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.length === 0;
  if (typeof value === 'number') return Number.isNaN(value);
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return false;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Conditional evaluation — identical semantics to the web renderer
 * (apps/web/src/features/intake-form/conditional.ts): an UNANSWERED controller
 * satisfies NO operator, including not_equals.
 */
function evaluateConditional(
  operator: string,
  conditionValue: unknown,
  answer: unknown,
): boolean {
  if (isBlank(answer)) return false;
  switch (operator) {
    case 'equals':
      return deepEqual(answer, conditionValue);
    case 'not_equals':
      return !deepEqual(answer, conditionValue);
    case 'in':
      return (
        Array.isArray(conditionValue) &&
        conditionValue.some((candidate) =>
          Array.isArray(answer)
            ? answer.some((item) => deepEqual(item, candidate))
            : deepEqual(answer, candidate),
        )
      );
    case 'is_true':
      return answer === true;
    case 'is_false':
      return answer === false;
    default:
      return false;
  }
}

function isQuestionVisible(
  question: FormQuestionRecord,
  byKey: Map<string, FormQuestionRecord>,
  values: Map<string, unknown>,
  visiting: ReadonlySet<string> = new Set(),
): boolean {
  if (question.conditionalKey === null || question.conditionalOperator === null) {
    return true;
  }
  if (visiting.has(question.key)) return false;
  const controller = byKey.get(question.conditionalKey);
  // Controller inactive / out of scope → the dependent stays hidden.
  if (controller === undefined) return false;
  const nextVisiting = new Set(visiting);
  nextVisiting.add(question.key);
  if (!isQuestionVisible(controller, byKey, values, nextVisiting)) return false;
  return evaluateConditional(
    question.conditionalOperator,
    question.conditionalValue ?? null,
    values.get(controller.key),
  );
}

// ---------------------------------------------------------------------------
// Validation pipeline (03 §3.3, in order, fail fast)
// ---------------------------------------------------------------------------

export interface PreparedAnswer {
  question: FormQuestionRecord;
  valueText: string | null;
  valueNumber: number | null;
  valueBoolean: boolean | null;
  valueDate: string | null;
  valueJson: unknown;
  optionIds: string[];
}

interface CurrencyRange {
  min: number;
  max: number;
  unit: string;
  currency: string;
}

function isCurrencyRange(value: unknown): value is CurrencyRange {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    typeof (value as CurrencyRange).min === 'number' &&
    typeof (value as CurrencyRange).max === 'number' &&
    typeof (value as CurrencyRange).unit === 'string' &&
    typeof (value as CurrencyRange).currency === 'string'
  );
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function isFileRefs(value: unknown): value is { fileIds: string[] } {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    isStringArray((value as { fileIds: unknown }).fileIds)
  );
}

function jsonShapeOk(questionType: QuestionType, value: unknown): boolean {
  switch (questionType) {
    case 'multi_select':
      return isStringArray(value);
    case 'currency_range':
      return isCurrencyRange(value);
    case 'file_upload':
      return isFileRefs(value);
    default:
      return true;
  }
}

/** Step 4 — the `validation` rule bag. Returns an error message or null. */
function checkValidationRules(
  question: FormQuestionRecord,
  answer: IntakeAnswer,
): string | null {
  const rules = question.validation as {
    minLength?: number;
    maxLength?: number;
    pattern?: string;
    min?: number;
    max?: number;
    minSelections?: number;
    maxSelections?: number;
    scaleMin?: number;
    scaleMax?: number;
    currency?: string;
    allowedUnits?: string[];
  };

  const text = answer.valueText;
  if (typeof text === 'string') {
    if (rules.minLength !== undefined && text.length < rules.minLength) {
      return `Must be at least ${rules.minLength} characters.`;
    }
    if (rules.maxLength !== undefined && text.length > rules.maxLength) {
      return `Must be at most ${rules.maxLength} characters.`;
    }
    if (rules.pattern !== undefined) {
      try {
        if (!new RegExp(rules.pattern).test(text)) {
          return 'Does not match the required format.';
        }
      } catch {
        // An invalid stored pattern must not break submissions.
      }
    }
  }

  const num = answer.valueNumber;
  if (typeof num === 'number') {
    const min = rules.min ?? rules.scaleMin;
    const max = rules.max ?? rules.scaleMax;
    if (min !== undefined && num < min) return `Must be at least ${min}.`;
    if (max !== undefined && num > max) return `Must be at most ${max}.`;
  }

  if (question.questionType === 'multi_select' && isStringArray(answer.valueJson)) {
    const count = answer.valueJson.length;
    if (rules.minSelections !== undefined && count < rules.minSelections) {
      return `Select at least ${rules.minSelections}.`;
    }
    if (rules.maxSelections !== undefined && count > rules.maxSelections) {
      return `Select at most ${rules.maxSelections}.`;
    }
  }

  if (
    question.questionType === 'currency_range' &&
    isCurrencyRange(answer.valueJson)
  ) {
    const range = answer.valueJson;
    if (range.min > range.max) return 'Minimum exceeds maximum.';
    if (
      rules.allowedUnits !== undefined &&
      !rules.allowedUnits.includes(range.unit)
    ) {
      return `Unit must be one of: ${rules.allowedUnits.join(', ')}.`;
    }
    if (rules.currency !== undefined && range.currency !== rules.currency) {
      return `Currency must be ${rules.currency}.`;
    }
    if (rules.min !== undefined && range.min < rules.min) {
      return `Minimum must be at least ${rules.min}.`;
    }
    if (rules.max !== undefined && range.max > rules.max) {
      return `Maximum must be at most ${rules.max}.`;
    }
  }

  return null;
}

function fieldError(
  code: 'UNKNOWN_QUESTION' | 'VALUE_TYPE_MISMATCH' | 'VALIDATION_FAILED' | 'INVALID_OPTION' | 'CONDITION_NOT_MET',
  message: string,
  fields: Record<string, string>,
): ApiError {
  return new ApiError(code, message, { fields });
}

/**
 * Runs the full pipeline against the active scope and returns prepared answer
 * rows. Throws the documented 422s; performs no writes.
 */
export function validateSubmission(
  scope: FormQuestionRecord[],
  answers: IntakeAnswer[],
): PreparedAnswer[] {
  const byKey = new Map(scope.map((question) => [question.key, question]));

  // Duplicate answer keys would violate unique(requisition_id, question_id).
  const seen = new Set<string>();
  const duplicates: Record<string, string> = {};
  for (const answer of answers) {
    if (seen.has(answer.questionKey)) {
      duplicates[answer.questionKey] = 'Answered more than once.';
    }
    seen.add(answer.questionKey);
  }
  if (Object.keys(duplicates).length > 0) {
    throw fieldError(
      'VALIDATION_FAILED',
      'Some questions are answered more than once.',
      duplicates,
    );
  }

  // Step 1 — every questionKey resolves to an active question in scope.
  const unknown: Record<string, string> = {};
  for (const answer of answers) {
    if (!byKey.has(answer.questionKey)) {
      unknown[answer.questionKey] = 'Unknown or out-of-scope question.';
    }
  }
  if (Object.keys(unknown).length > 0) {
    throw fieldError(
      'UNKNOWN_QUESTION',
      'Some answers reference unknown or out-of-scope questions.',
      unknown,
    );
  }

  // Value map for conditional evaluation (raw provided values).
  const values = new Map<string, unknown>();
  for (const answer of answers) {
    values.set(answer.questionKey, answer[providedField(answer)]);
  }

  // Step 2 — every active, in-scope, VISIBLE required question is present and
  // non-empty. Hidden required questions are not required (their condition is
  // unsatisfied), mirroring the renderer.
  const missingKeys: string[] = [];
  for (const question of scope) {
    if (!question.isRequired) continue;
    if (!isQuestionVisible(question, byKey, values)) continue;
    const value = values.get(question.key);
    if (isBlank(value)) missingKeys.push(question.key);
  }
  if (missingKeys.length > 0) {
    throw new ApiError(
      'REQUIRED_ANSWER_MISSING',
      'Some required answers are missing.',
      { missingKeys },
    );
  }

  // Blank optional answers carry no information — drop them before typing.
  const nonBlank = answers.filter(
    (answer) => !isBlank(answer[providedField(answer)]),
  );

  // Step 3 — the provided value field matches the question type.
  const typeErrors: Record<string, string> = {};
  for (const answer of nonBlank) {
    const question = byKey.get(answer.questionKey);
    if (question === undefined) continue;
    const expected = EXPECTED_FIELD[question.questionType];
    const provided = providedField(answer);
    if (provided !== expected) {
      typeErrors[answer.questionKey] =
        `Expected ${expected} for question type '${question.questionType}', received ${provided}.`;
    } else if (
      provided === 'valueJson' &&
      !jsonShapeOk(question.questionType, answer.valueJson)
    ) {
      typeErrors[answer.questionKey] =
        `The valueJson shape does not match question type '${question.questionType}'.`;
    }
  }
  if (Object.keys(typeErrors).length > 0) {
    throw fieldError(
      'VALUE_TYPE_MISMATCH',
      'Some answer values do not match their question type.',
      typeErrors,
    );
  }

  // Step 4 — validation rules.
  const ruleErrors: Record<string, string> = {};
  for (const answer of nonBlank) {
    const question = byKey.get(answer.questionKey);
    if (question === undefined) continue;
    const message = checkValidationRules(question, answer);
    if (message !== null) ruleErrors[answer.questionKey] = message;
  }
  if (Object.keys(ruleErrors).length > 0) {
    throw fieldError(
      'VALIDATION_FAILED',
      'Some answers failed validation.',
      ruleErrors,
    );
  }

  // Step 5 — select answers reference active options of that question.
  // (Scope options are already active-only.)
  const optionErrors: Record<string, string> = {};
  const optionIdsByKey = new Map<string, string[]>();
  for (const answer of nonBlank) {
    const question = byKey.get(answer.questionKey);
    if (question === undefined) continue;
    if (question.questionType === 'single_select') {
      const option = question.options.find(
        (candidate) => candidate.value === answer.valueText,
      );
      if (option === undefined) {
        optionErrors[answer.questionKey] =
          'Not an active option of this question.';
      } else {
        optionIdsByKey.set(answer.questionKey, [option.id]);
      }
    }
    if (question.questionType === 'multi_select' && isStringArray(answer.valueJson)) {
      const ids: string[] = [];
      for (const value of answer.valueJson) {
        const option = question.options.find(
          (candidate) => candidate.value === value,
        );
        if (option === undefined) {
          optionErrors[answer.questionKey] =
            `'${value}' is not an active option of this question.`;
          break;
        }
        ids.push(option.id);
      }
      if (optionErrors[answer.questionKey] === undefined) {
        optionIdsByKey.set(answer.questionKey, ids);
      }
    }
  }
  if (Object.keys(optionErrors).length > 0) {
    throw fieldError(
      'INVALID_OPTION',
      'Some answers reference inactive or foreign options.',
      optionErrors,
    );
  }

  // Step 6 — conditional questions only accepted when their condition is met.
  const conditionErrors: Record<string, string> = {};
  for (const answer of nonBlank) {
    const question = byKey.get(answer.questionKey);
    if (question === undefined || question.conditionalKey === null) continue;
    if (!isQuestionVisible(question, byKey, values)) {
      conditionErrors[answer.questionKey] =
        'This question is hidden by its condition and cannot be answered.';
    }
  }
  if (Object.keys(conditionErrors).length > 0) {
    throw fieldError(
      'CONDITION_NOT_MET',
      'Some conditional answers were submitted while hidden.',
      conditionErrors,
    );
  }

  return nonBlank.map((answer) => {
    const question = byKey.get(answer.questionKey);
    if (question === undefined) {
      throw new ApiError('INTERNAL_ERROR', 'Question scope lookup failed.');
    }
    return {
      question,
      valueText: answer.valueText ?? null,
      valueNumber: answer.valueNumber ?? null,
      valueBoolean: answer.valueBoolean ?? null,
      valueDate: answer.valueDate ?? null,
      valueJson: answer.valueJson === undefined ? null : answer.valueJson,
      optionIds: optionIdsByKey.get(answer.questionKey) ?? [],
    };
  });
}

// ---------------------------------------------------------------------------
// Snapshot (03 §1.4)
// ---------------------------------------------------------------------------

export function buildSnapshot(
  question: FormQuestionRecord,
  capturedAt: string,
): Record<string, unknown> {
  const snapshot: Record<string, unknown> = {
    questionKey: question.key,
    label: question.label,
    questionType: question.questionType,
    categoryKey: question.categoryKey,
    capturedAt,
  };
  if (question.helpText !== null) snapshot['helpText'] = question.helpText;
  if (question.options.length > 0) {
    snapshot['options'] = question.options.map((option) => ({
      value: option.value,
      label: option.label,
    }));
  }
  if (Object.keys(question.validation).length > 0) {
    snapshot['validation'] = question.validation;
  }
  return snapshot;
}

// ---------------------------------------------------------------------------
// Mapped-question projection (03 §3.4)
// ---------------------------------------------------------------------------

interface MappedProjection {
  companyName: string | null;
  requisition: Omit<RequisitionInsert, 'clientId' | 'intakeCompletedBy'>;
}

async function projectMappedAnswers(
  db: Db,
  roleCategoryId: string,
  prepared: PreparedAnswer[],
): Promise<MappedProjection> {
  const lineage = await findRoleCategoryLineage(db, roleCategoryId);
  if (lineage === null) {
    throw new ApiError('VALIDATION_FAILED', 'Unknown role category.', {
      fields: { roleCategoryId: 'Unknown role category.' },
    });
  }

  const byKey = new Map(prepared.map((entry) => [entry.question.key, entry]));
  const text = (key: string): string | null => byKey.get(key)?.valueText ?? null;
  const num = (key: string): number | null => byKey.get(key)?.valueNumber ?? null;

  // engine / department: derived from the role-category lineage; an explicit
  // answer whose value resolves to a real taxonomy key overrides.
  let engineId: string | null = lineage.engineId;
  let departmentId: string | null = lineage.departmentId;
  const engineAnswer = text('engine');
  if (engineAnswer !== null) {
    engineId = (await findEngineIdByKey(db, engineAnswer)) ?? engineId;
  }
  const departmentAnswer = text('department');
  if (departmentAnswer !== null) {
    departmentId =
      (await findDepartmentIdByKey(db, departmentAnswer)) ?? departmentId;
  }

  let budgetMin: number | null = null;
  let budgetMax: number | null = null;
  let budgetUnit: string | null = null;
  let budgetCurrency: string | null = null;
  const budget = byKey.get('budget_range')?.valueJson;
  if (isCurrencyRange(budget)) {
    budgetMin = budget.min;
    budgetMax = budget.max;
    const unit = RateUnitSchema.safeParse(budget.unit);
    budgetUnit = unit.success ? unit.data : null;
    budgetCurrency = budget.currency.length === 3 ? budget.currency : null;
  }

  const engagementParse = EngagementTypeSchema.safeParse(
    text('engagement_type'),
  );
  const spokenParse = LanguageLevelSchema.safeParse(
    text('english_spoken_required'),
  );
  const writtenParse = LanguageLevelSchema.safeParse(
    text('english_written_required'),
  );
  const accentParse = AccentStrengthSchema.safeParse(
    text('max_accent_strength'),
  );

  // overlap_window: '09:00-14:00 America/Chicago' text, or
  // { start, end, timezone } json. Unparseable answers are stored but not
  // projected — the mapping is a derived projection, never load-bearing.
  let overlapStart: string | null = null;
  let overlapEnd: string | null = null;
  let overlapTimezone: string | null = null;
  const overlapEntry = byKey.get('overlap_window');
  const overlapText = overlapEntry?.valueText ?? null;
  if (overlapText !== null) {
    const match = /^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s+(\S+)$/.exec(
      overlapText,
    );
    if (match !== null) {
      overlapStart = match[1] ?? null;
      overlapEnd = match[2] ?? null;
      overlapTimezone = match[3] ?? null;
    }
  } else if (
    typeof overlapEntry?.valueJson === 'object' &&
    overlapEntry.valueJson !== null &&
    !Array.isArray(overlapEntry.valueJson)
  ) {
    const json = overlapEntry.valueJson as Record<string, unknown>;
    if (typeof json['start'] === 'string') overlapStart = json['start'];
    if (typeof json['end'] === 'string') overlapEnd = json['end'];
    if (typeof json['timezone'] === 'string') overlapTimezone = json['timezone'];
  }

  const hours = num('hours_per_week');
  const headcount = num('headcount');

  return {
    companyName: text('company_name'),
    requisition: {
      engineId,
      departmentId,
      roleCategoryId: lineage.id,
      headcount:
        headcount !== null && Number.isFinite(headcount) && headcount >= 1
          ? Math.round(headcount)
          : null,
      budgetMin,
      budgetMax,
      budgetUnit,
      budgetCurrency,
      engagementType: engagementParse.success ? engagementParse.data : null,
      hoursPerWeek:
        hours !== null && Number.isFinite(hours) ? Math.round(hours) : null,
      overlapStart,
      overlapEnd,
      overlapTimezone,
      targetStartDate: byKey.get('target_start_date')?.valueDate ?? null,
      regionPreference: text('region_preference'),
      englishSpokenRequired: spokenParse.success ? spokenParse.data : null,
      englishWrittenRequired: writtenParse.success ? writtenParse.data : null,
      maxAccentStrength: accentParse.success ? accentParse.data : null,
      intakeContactName: text('contact_name'),
      intakeContactEmail: text('contact_email'),
    },
  };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export interface SubmissionLogger {
  info(obj: Record<string, unknown>, msg: string): void;
}

export interface IntakeSubmissionServiceDeps {
  db: Db;
  formService: IntakeFormService;
  /** Diagnostics only — hash mismatches are accepted but logged (03 §3.2 r7). */
  logger?: SubmissionLogger;
  now?: () => number;
}

export interface PortalActor {
  userId: string;
  role: UserRoleKey | null;
  /** Resolved caller scope (client member) — null for admin callers. */
  ownClientId: string | null;
}

export interface IntakeSubmissionService {
  submitPublic(
    submission: IntakeSubmission,
  ): Promise<{ requisitionReference: string }>;
  submitInPortal(
    submission: IntakeSubmission,
    actor: PortalActor,
    requestedClientId: string | undefined,
  ): Promise<{ id: string; requisitionReference: string }>;
}

export function createIntakeSubmissionService(
  deps: IntakeSubmissionServiceDeps,
): IntakeSubmissionService {
  const now = deps.now ?? Date.now;

  async function prepare(submission: IntakeSubmission): Promise<{
    prepared: PreparedAnswer[];
    projection: MappedProjection;
    hashMatched: boolean;
  }> {
    // Projection also validates roleCategoryId existence — run it first so a
    // bogus id fails before any per-answer noise.
    const scope = await getActiveFormQuestions(deps.db, submission.roleCategoryId);
    const prepared = validateSubmission(scope, submission.answers);
    const projection = await projectMappedAnswers(
      deps.db,
      submission.roleCategoryId,
      prepared,
    );

    const currentForm = await deps.formService.getForm(submission.roleCategoryId);
    const hashMatched = currentForm.formVersionHash === submission.formVersionHash;
    if (!hashMatched) {
      deps.logger?.info(
        {
          submittedHash: submission.formVersionHash,
          currentHash: currentForm.formVersionHash,
          roleCategoryId: submission.roleCategoryId,
        },
        'intake submission formVersionHash mismatch (accepted)',
      );
    }
    return { prepared, projection, hashMatched };
  }

  interface WriteArgs {
    submission: IntakeSubmission;
    prepared: PreparedAnswer[];
    projection: MappedProjection;
    hashMatched: boolean;
    clientId: string | null; // null → create a prospect client (public)
    actor: { userId: string | null; role: UserRoleKey | null };
  }

  async function write(
    args: WriteArgs,
  ): Promise<{ id: string; reference: string }> {
    const capturedAt = new Date(now()).toISOString();
    const admins = await getActiveAdmins(deps.db);

    return withTransaction(deps.db, async (tx) => {
      const clientId =
        args.clientId ??
        (await insertProspectClient(tx, {
          companyName:
            args.projection.companyName ??
            args.projection.requisition.intakeContactName ??
            'Unknown company',
        }));

      const requisition = await insertRequisition(tx, {
        ...args.projection.requisition,
        clientId,
        intakeCompletedBy: args.actor.userId,
      });

      for (const entry of args.prepared) {
        const answerId = await insertAnswer(tx, {
          requisitionId: requisition.id,
          questionId: entry.question.id,
          questionKey: entry.question.key,
          valueText: entry.valueText,
          valueNumber: entry.valueNumber,
          valueBoolean: entry.valueBoolean,
          valueDate: entry.valueDate,
          valueJson: entry.valueJson,
          questionSnapshot: buildSnapshot(entry.question, capturedAt),
          answeredBy: args.actor.userId,
        });
        if (entry.optionIds.length > 0) {
          await insertAnswerOptions(tx, answerId, entry.optionIds);
        }
      }

      await emitEvent(tx, {
        entityType: 'requisition',
        entityId: requisition.id,
        eventType: 'intake_submitted',
        actorId: args.actor.userId,
        actorRole: args.actor.role,
        fromValue: null,
        toValue: 'submitted',
        metadata: {
          clientId,
          reference: requisition.reference,
          roleCategoryId: args.submission.roleCategoryId,
          formVersionHash: args.submission.formVersionHash,
          formVersionHashMatched: args.hashMatched,
          answerCount: args.prepared.length,
        },
      });

      for (const admin of admins) {
        await enqueueNotification(tx, {
          event: 'intake_submitted',
          recipientEmail: admin.email,
          recipientUserId: admin.id,
          entityType: 'requisition',
          entityId: requisition.id,
          payload: {
            event: 'intake_submitted',
            recipient: {
              email: admin.email,
              fullName: admin.fullName,
              userId: admin.id,
            },
            context: {
              requisitionReference: requisition.reference,
              companyName: args.projection.companyName,
              roleCategoryId: args.submission.roleCategoryId,
            },
            sentAt: null,
          },
        });
      }

      return requisition;
    });
  }

  return {
    async submitPublic(submission) {
      const { prepared, projection, hashMatched } = await prepare(submission);
      const requisition = await write({
        submission,
        prepared,
        projection,
        hashMatched,
        clientId: null,
        actor: { userId: null, role: null },
      });
      // 201 { requisitionReference } and NOTHING else — no internal ids leave
      // the API for unauthenticated callers (03 §3.3 step 7, AC-IF-14).
      return { requisitionReference: requisition.reference };
    },

    async submitInPortal(submission, actor, requestedClientId) {
      // 04 §1.3: a client-scoped caller's clientId comes from their membership,
      // never from the request. Admin callers must name the client.
      let clientId: string;
      if (actor.ownClientId !== null) {
        clientId = actor.ownClientId;
      } else {
        if (requestedClientId === undefined) {
          throw new ApiError(
            'VALIDATION_FAILED',
            'clientId is required for admin callers.',
            { fields: { clientId: 'Required for admin callers.' } },
          );
        }
        if (!(await clientExists(deps.db, requestedClientId))) {
          throw new ApiError('NOT_FOUND', 'Client not found.');
        }
        clientId = requestedClientId;
      }

      const { prepared, projection, hashMatched } = await prepare(submission);
      const requisition = await write({
        submission,
        prepared,
        projection,
        hashMatched,
        clientId,
        actor: { userId: actor.userId, role: actor.role },
      });
      return {
        id: requisition.id,
        requisitionReference: requisition.reference,
      };
    },
  };
}
