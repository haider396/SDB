# Repeating Group Question Type — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `repeating_group` question type to the SDB question engine — a question whose answer is a list of rows with defined columns and an "Add another" button — purely additively, so that every existing form, renderer and stored answer is byte-for-byte unaffected.

**Architecture:** One new member of the `question_type` enum. Column definitions live in the existing `questions.validation` jsonb under a `repeatingGroup` key, so they flow to all three renderers with no wire-shape change and are captured by `buildSnapshot()` for free. The answer is `value_json = { rows: [...] }`. All three submission paths already share `validateSubmission` and `buildSnapshot`, so the API is taught in one place. The builder canvas's fixed 8px row grid is handled by sizing the block for its base state and shifting only colliding blocks below it at fill time — gated so that a page with no repeating group gets its input array back **by reference**.

**Tech Stack:** pnpm workspace monorepo · TypeScript strict · Zod (`@sdb/contracts`) · Fastify 4 + postgres.js (no ORM) · React 18 + Vite + TanStack Query + react-hook-form · Tailwind over CSS-variable tokens · Vitest · Postgres 17 (Supabase)

**Spec:** `docs/superpowers/specs/2026-09-09-repeating-group-question-type-design.md` — read it before Task 1. Every "why" in this plan is argued there; this document only says what to do.

---

## Global Constraints

Copied from `CLAUDE.md`, `docs/CLAUDE.md` and the spec. Every task's requirements implicitly include this section.

- **Migrations are forward-only.** `NNNN_description.sql`. Never edit an applied migration. **Validate in a rolled-back transaction before applying.** A statement error aborts the whole transaction unless you take a savepoint first.
- **Contracts are the source of truth.** Adding an export requires `pnpm --filter @sdb/contracts build` before `apps/api` or `apps/web` can see it. Skipping this produces a confusing "has no exported member".
- **Layering is ESLint-enforced:** `routes → services → repositories → lib`. A layer may never skip downward or reach up. **No SQL in a service.**
- **No hex colours or arbitrary Tailwind colour values anywhere in `apps/web/src/**` outside `src/styles/**`** (AC-UI-01, ESLint-enforced).
- **`sr-only` is `position: absolute`.** Any element using it needs a positioned ancestor, or it anchors to the document and stretches the page. The app shells are `relative overflow-clip` for exactly this reason.
- **camelCase on the wire, snake_case in SQL.** Repositories do the mapping.
- **TypeScript strict.** No `any` except where a third-party type is genuinely missing, and then with a comment saying why.
- **Comments explain *why*** — the trap avoided, the bug that motivated the line. Match the density and tone of the surrounding files. Do not narrate what the code already says.
- **Conventional Commits.** The repo has a `.git` at `sdb-portal/.git` and **no remote**. Commit; never push.
- **Docker is not available on this machine**, so `apps/api` integration tests (`pnpm test:integration`) cannot run locally. Where a task's verification needs them, run everything else, then say plainly and specifically what was not run. Do not claim a suite passed that you did not run.
- **Never pipe a dev server into `head`** — the pipe closing kills the server.
- Run commands from the repo root (`sdb-portal/`) unless a step says otherwise. The API dev server needs its env sourced: `cd apps/api && set -a && . ./.env && set +a && pnpm dev`.

### Verification commands

| What | Command |
|---|---|
| Everything | `pnpm -r typecheck && pnpm -r lint && pnpm -r test` |
| Contracts only | `pnpm --filter @sdb/contracts test` |
| Contracts build (after adding an export) | `pnpm --filter @sdb/contracts build` |
| Web only | `cd apps/web && pnpm test` |
| One web file | `cd apps/web && pnpm vitest run tests/path/file.test.ts` |
| API unit only | `cd apps/api && pnpm test` |
| API integration (needs Docker) | `cd apps/api && pnpm test:integration` |

---

## File Structure

**Create:**

| File | Responsibility |
|---|---|
| `supabase/migrations/0028_repeating_group_enum.sql` | Adds the enum member. Nothing else. |
| `supabase/migrations/0029_repeating_group_answer_shape.sql` | Teaches both answer-shape trigger functions. |
| `packages/contracts/src/repeating-group.ts` | Every wire shape for columns, values, snapshots and row-level errors. |
| `packages/contracts/src/repeating-group.test.ts` | Its tests. |
| `apps/api/src/services/repeating-group.ts` | Pure normalise + validate + snapshot. No SQL, no HTTP. |
| `apps/api/tests/repeating-group.test.ts` | Its unit tests. Runs without Docker. |
| `apps/web/src/features/intake-form/repeating-group.ts` | Shared web-side pure helpers (config lookup, column options, error walking). |
| `apps/web/src/features/intake-form/components/fields/repeating-group-field.tsx` | The control. |
| `apps/web/src/features/form-builder/layout-growth.ts` | `shiftForGrowth` — the fill-time canvas reflow. |
| `apps/web/src/components/patterns/answer-table.tsx` | Renders stored rows on the candidate profile and the requisition answers card. |
| `apps/web/tests/intake-form/repeating-group-field.test.tsx` | Component behaviour, including keyboard and focus. |
| `apps/web/tests/intake-form/repeating-group.test.ts` | The pure web helpers + schema. |
| `apps/web/tests/form-builder/layout-growth.test.ts` | The reference-equality gate (AC-FB-11). |
| `apps/web/tests/p3/answer-table.test.tsx` | Stored-answer rendering from the snapshot. |
| `supabase/seed/repeating_group_questions_seed.sql` | The five questions, their options, and three blocks on the default template. |

**Modify:**

| File | Change |
|---|---|
| `packages/contracts/src/enums.ts` | `QuestionTypeSchema` gains `'repeating_group'`. |
| `packages/contracts/src/validation-rules.ts` | `ValidationRulesSchema` gains optional `repeatingGroup`. |
| `packages/contracts/src/index.ts` | Re-export the new module. |
| `apps/api/src/services/intake-submission.service.ts` | `EXPECTED_FIELD`, `jsonShapeOk`, `isBlank`, `checkValidationRules`, `validateSubmission` normalisation, `buildSnapshot`. |
| `apps/api/src/services/questions.service.ts` | Reject a `repeating_group` question with no columns. |
| `apps/web/src/features/intake-form/components/question-field.tsx` | One case + one map entry. |
| `apps/web/src/features/intake-form/schema-builder.ts` | One arm in `baseSchemaFor`. |
| `apps/web/src/features/intake-form/submission.ts` | One arm in `toAnswer`. |
| `apps/web/src/features/intake-form/conditional.ts` | `isBlank` learns `{ rows: [] }`. |
| `apps/web/src/features/intake-form/components/fields/field-shell.tsx` | `cellFieldId()`. |
| `apps/web/src/features/intake-form/components/fields/types.ts` | `FieldProps.rowErrors?`. |
| `apps/web/src/features/intake-form/components/error-summary.tsx` | Cell-precise anchors. |
| `apps/web/src/features/intake-form/error-map.ts` | Read `details.fields[key].rows`. |
| `apps/web/src/features/intake-form/intake-form.tsx` | Pass `rowErrors` through. |
| `apps/web/src/features/form-builder/render/public-form-renderer.tsx` | Apply `shiftForGrowth`; pass `rowErrors`. |
| `apps/web/src/features/form-builder/block-height.ts` | Give `repeating_group` a height. |
| `apps/web/src/features/question-manager/guard-rails.ts` | Two map entries. **`repeating_group: ['repeatingGroup']` — see Task 3.** |
| `apps/web/src/features/question-manager/components/validation-rules-editor.tsx` | Read-only column summary. |
| `apps/web/src/lib/answer-value.ts` | Text fallback + `readRepeatingGroup()`. |
| `apps/web/src/features/candidates/components/form-submissions-card.tsx` | Use `AnswerTable`. |
| `apps/web/src/features/requisitions/components/answers-card.tsx` | Use `AnswerTable`. |

---

## Task order and concurrency

```
T1 (migrations, IN FLIGHT)  ─┐
T2 (contracts schemas)      ─┴─► T3 ─┬─► T4  API validation + snapshot
                                     ├─► T5  API question guard
   T3 IS ATOMIC.                     ├─► T6  field keyboard + focus + live region
   ONE AGENT. NO CONCURRENCY.        ├─► T7  error plumbing
   The tree is red from the          ├─► T8  canvas growth
   enum change until every           ├─► T9  answer rendering
   consumer is taught.               ├─► T10 question-manager summary
                                     └─► T11 seed  (also needs T1 applied)
                                              │
                                              ▼
                                            T12 verification (alone, last)
```

| Task | Safe to run concurrently with | Why not |
|---|---|---|
| **T1** | T2 | Different trees entirely. |
| **T2** | T1 | — |
| **T3** | **NOTHING** | Adding the enum member breaks compilation across `apps/api` and `apps/web` until every consumer is taught. Two agents on a red tree can neither verify nor finish. **One agent, start to green.** |
| **T4** | T5–T11 | Touches `intake-submission.service.ts` only. |
| **T5** | T4, T6–T11 | Touches `questions.service.ts` only. |
| **T6** | T4, T5, T8–T11 | Touches `repeating-group-field.tsx`. **Conflicts with T7** (both edit the component's props usage) — run T6 before T7, or the same agent for both. |
| **T7** | T4, T5, T8–T11 | See above. |
| **T8** | everything except T3, T12 | Its own new file plus one call site. |
| **T9** | everything except T3, T12 | `lib/answer-value.ts` + two cards. |
| **T10** | everything except T3, T12 | One editor component. |
| **T11** | everything except T3, T12 | SQL only. |
| **T12** | **NOTHING** | It is the whole-repo gate. |

---

# Task 1: Migrations 0028 and 0029

> **STATUS: IN FLIGHT.** An `sdb-migrations` agent is building both files from spec §12. This task is recorded so the plan is a complete record; do not start it in parallel. Confirm the files exist and are applied before starting Task 11, and before running any API integration test that inserts a repeating-group answer.

**Files:**
- Create: `supabase/migrations/0028_repeating_group_enum.sql`
- Create: `supabase/migrations/0029_repeating_group_answer_shape.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: the `question_type` enum member `'repeating_group'` in Postgres, and both answer-shape trigger functions accepting it on `value_json`.

- [ ] **Step 1: Write 0028 — the enum alone**

```sql
-- 0028_repeating_group_enum.sql
--
-- The `repeating_group` question type: a question whose answer is a LIST OF
-- ROWS. Design: docs/superpowers/specs/2026-09-09-repeating-group-question-type-design.md
--
-- ALONE IN ITS OWN MIGRATION, for the same reason 0016 was split from 0017:
-- Postgres forbids USING a new enum value in the transaction that adds it.
-- Everything that references the value lives in 0029.

alter type question_type add value if not exists 'repeating_group';
```

- [ ] **Step 2: Write 0029 — teach both trigger functions, in lockstep**

Copy each function body verbatim from its current definition and change only the `value_json` arm. `enforce_answer_value_shape()` is at `supabase/migrations/0006_requisitions_and_answers.sql:95`; `enforce_candidate_answer_value_shape()` is in `0017_candidate_registration.sql`. In both, this line:

```sql
    when 'multi_select', 'currency_range', 'file_upload' then
```

becomes:

```sql
    when 'multi_select', 'currency_range', 'file_upload', 'repeating_group' then
```

Do not recreate the triggers — `create or replace function` leaves `trg_answer_value_shape` and `trg_candidate_answer_value_shape` pointing at the new bodies. 0017's own comment requires the two functions stay in lockstep, which is why they are taught in one migration.

- [ ] **Step 3: Apply 0028, then validate 0029 in a rolled-back transaction**

0029 **cannot** be validated in the same transaction as 0028 — the enum value is not usable until 0028 commits. Apply 0028 first, then:

```sql
begin;

\i supabase/migrations/0029_repeating_group_answer_shape.sql

-- Assertion 4 FIRST, and it is the one that matters most: the functions were
-- replaced wholesale, so a typo in an arm nobody meant to touch is the
-- realistic failure. One insert per pre-existing type, in BOTH tables.
-- (Use an existing question of each type from the seed; take a savepoint
--  before every insert that is expected to fail.)

savepoint s1;
-- expected to FAIL: repeating_group answer in value_text
insert into candidate_answers (candidate_id, question_id, question_key, value_text, question_snapshot)
values (…, …, 'skills_and_tools', 'x', '{}'::jsonb);
rollback to savepoint s1;

-- expected to SUCCEED: repeating_group answer in value_json
insert into candidate_answers (candidate_id, question_id, question_key, value_json, question_snapshot)
values (…, …, 'skills_and_tools', '{"rows":[]}'::jsonb, '{}'::jsonb);

-- repeat both for requisition_answers

rollback;
```

- [ ] **Step 4: Prove the rollback**

After `rollback`, confirm `select count(*) from candidate_answers` and `from requisition_answers` are unchanged, and that `select pg_get_functiondef('enforce_candidate_answer_value_shape'::regproc)` still returns the **old** body (no `repeating_group`).

- [ ] **Step 5: Apply 0029 and commit both files**

```bash
git add supabase/migrations/0028_repeating_group_enum.sql supabase/migrations/0029_repeating_group_answer_shape.sql
git commit -m "feat(db): accept repeating_group answers on value_json in both answer tables"
```

---

# Task 2: Contracts — the repeating-group schemas

**Files:**
- Create: `packages/contracts/src/repeating-group.ts`
- Create: `packages/contracts/src/repeating-group.test.ts`
- Modify: `packages/contracts/src/validation-rules.ts`
- Modify: `packages/contracts/src/index.ts`

**Interfaces:**
- Consumes: `IntakeFormOptionSchema` from `./intake.js`.
- Produces, and every later task depends on these exact names:
  - `RepeatingGroupColumnTypeSchema` / `RepeatingGroupColumnType`
  - `RepeatingGroupChoicesSchema` / `RepeatingGroupChoices`
  - `RepeatingGroupColumnSchema` / `RepeatingGroupColumn`
  - `RepeatingGroupConfigSchema` / `RepeatingGroupConfig`
  - `RepeatingGroupRowSchema` / `RepeatingGroupRow` (`Record<string, string | number>`)
  - `RepeatingGroupValueSchema` / `RepeatingGroupValue` (`{ rows: RepeatingGroupRow[] }`)
  - `RepeatingGroupFieldErrorSchema` / `RepeatingGroupFieldError` (`{ rowIndex: number; columnKey: string; message: string }`)
  - `RepeatingGroupSnapshotSchema` / `RepeatingGroupSnapshot`
  - `validateRepeatingGroupConfig(config: RepeatingGroupConfig): string | null`
  - `ValidationRules.repeatingGroup?: RepeatingGroupConfig`

**Does NOT touch `enums.ts`.** The whole repo stays green through this task.

- [ ] **Step 1: Write the failing tests**

Create `packages/contracts/src/repeating-group.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  RepeatingGroupConfigSchema,
  RepeatingGroupValueSchema,
  validateRepeatingGroupConfig,
} from './repeating-group.js';
import { ValidationRulesSchema } from './validation-rules.js';

const skillsConfig = {
  columns: [
    { key: 'skill', label: 'Skill', columnType: 'single_select', isRequired: true,
      choices: { from: 'question_options' } },
    { key: 'proficiency', label: 'Proficiency', columnType: 'single_select', isRequired: true,
      choices: { from: 'inline', options: [{ value: 'expert', label: 'Expert' }] } },
    { key: 'notes', label: 'Notes', columnType: 'short_text', isRequired: false, maxLength: 500 },
  ],
  minRows: 0,
  maxRows: 20,
};

describe('RepeatingGroupConfigSchema', () => {
  it('accepts the seeded skills-and-tools shape and applies defaults', () => {
    const result = RepeatingGroupConfigSchema.safeParse(skillsConfig);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.addRowLabel).toBe('Add another');
    expect(result.data.columns[0]?.widthWeight).toBe(1);
  });

  it('rejects a config with no columns', () => {
    expect(RepeatingGroupConfigSchema.safeParse({ ...skillsConfig, columns: [] }).success).toBe(false);
  });
});

describe('validateRepeatingGroupConfig', () => {
  it('accepts a valid config', () => {
    const config = RepeatingGroupConfigSchema.parse(skillsConfig);
    expect(validateRepeatingGroupConfig(config)).toBeNull();
  });

  it('rejects duplicate column keys', () => {
    const config = RepeatingGroupConfigSchema.parse({
      ...skillsConfig,
      columns: [skillsConfig.columns[0], skillsConfig.columns[0]],
    });
    expect(validateRepeatingGroupConfig(config)).toMatch(/duplicate/i);
  });

  it('rejects a single_select column with no choices', () => {
    const config = RepeatingGroupConfigSchema.parse({
      ...skillsConfig,
      columns: [{ key: 'skill', label: 'Skill', columnType: 'single_select', isRequired: true }],
    });
    expect(validateRepeatingGroupConfig(config)).toMatch(/choices/i);
  });

  it('rejects a non-select column that declares choices', () => {
    const config = RepeatingGroupConfigSchema.parse({
      ...skillsConfig,
      columns: [{ key: 'notes', label: 'Notes', columnType: 'short_text', isRequired: false,
                  choices: { from: 'question_options' } }],
    });
    expect(validateRepeatingGroupConfig(config)).toMatch(/choices/i);
  });

  it('rejects minRows greater than maxRows', () => {
    const config = RepeatingGroupConfigSchema.parse({ ...skillsConfig, minRows: 5, maxRows: 2 });
    expect(validateRepeatingGroupConfig(config)).toMatch(/minRows/);
  });
});

describe('RepeatingGroupValueSchema', () => {
  it('accepts rows of strings and numbers', () => {
    const result = RepeatingGroupValueSchema.safeParse({
      rows: [{ skill: 'ClickUp', proficiency: 'expert' }, { school: 'UNAM', year: 2019 }],
    });
    expect(result.success).toBe(true);
  });

  it('accepts an empty rows array', () => {
    expect(RepeatingGroupValueSchema.safeParse({ rows: [] }).success).toBe(true);
  });

  it('rejects a bare array — the value is always an object with a rows key', () => {
    expect(RepeatingGroupValueSchema.safeParse([{ skill: 'ClickUp' }]).success).toBe(false);
  });

  it('rejects nested objects in a cell', () => {
    expect(RepeatingGroupValueSchema.safeParse({ rows: [{ skill: { a: 1 } }] }).success).toBe(false);
  });
});

describe('ValidationRulesSchema with repeatingGroup', () => {
  it('accepts a repeatingGroup config', () => {
    expect(ValidationRulesSchema.safeParse({ repeatingGroup: skillsConfig }).success).toBe(true);
  });

  it('still rejects an unknown key — the schema stays strict (AC-Q-11)', () => {
    expect(ValidationRulesSchema.safeParse({ repeatingGroups: skillsConfig }).success).toBe(false);
  });

  it('parses an existing rule bag to an object with no repeatingGroup key', () => {
    const parsed = ValidationRulesSchema.parse({ maxLength: 200 });
    expect('repeatingGroup' in parsed).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm --filter @sdb/contracts test`
Expected: FAIL — `Cannot find module './repeating-group.js'`.

- [ ] **Step 3: Write `packages/contracts/src/repeating-group.ts`**

```ts
/**
 * The `repeating_group` question type — a question whose answer is a LIST OF
 * ROWS, each row having a few defined columns.
 * Design: docs/superpowers/specs/2026-09-09-repeating-group-question-type-design.md
 *
 * COLUMN TYPES ARE A SEPARATE, SMALLER ENUM FROM QuestionType. Reusing
 * QuestionType would drag currency_range, file_upload, scale and — fatally —
 * repeating_group itself into a column's domain. Nesting is therefore
 * impossible by construction, not by a rule someone has to remember.
 *
 * EVERY SCHEMA HERE IS A PLAIN ZodObject. Cross-field rules live in
 * validateRepeatingGroupConfig() rather than a .superRefine(), because these
 * schemas end up inside QuestionSchema and IntakeFormQuestionSchema, which are
 * walked by @asteasolutions/zod-to-openapi. A ZodEffects in that path breaks
 * OpenAPI generation the same way a z.lazy does (04 §15, and the note on
 * JsonValueSchema in intake.ts).
 */
import { z } from 'zod';
import { IntakeFormOptionSchema } from './intake.js';

/** Column machine keys: snake_case slugs, unique within one question. */
export const RepeatingGroupColumnKeySchema = z
  .string()
  .min(1)
  .max(60)
  .regex(/^[a-z][a-z0-9_]*$/, 'column key must be a snake_case slug');

export const RepeatingGroupColumnTypeSchema = z.enum([
  'short_text',
  'long_text',
  'number',
  /**
   * YYYY-MM, not a date. "March 2024" is what someone remembers about a job,
   * and a fabricated day-of-month is a lie the data would carry forever.
   */
  'month',
  'single_select',
]);
export type RepeatingGroupColumnType = z.infer<typeof RepeatingGroupColumnTypeSchema>;

/**
 * Where a choice column's options come from.
 *
 * 'question_options' means the question's OWN option list — which is what lets
 * Rebecca edit the skill catalogue through the options editor she already
 * uses, with no new admin UI. 'inline' is for short fixed lists we define
 * (proficiency, language level).
 */
export const RepeatingGroupChoicesSchema = z.discriminatedUnion('from', [
  z.object({ from: z.literal('question_options') }),
  z.object({
    from: z.literal('inline'),
    options: z.array(IntakeFormOptionSchema).min(1),
  }),
]);
export type RepeatingGroupChoices = z.infer<typeof RepeatingGroupChoicesSchema>;

export const RepeatingGroupColumnSchema = z.object({
  key: RepeatingGroupColumnKeySchema,
  label: z.string().min(1).max(120),
  columnType: RepeatingGroupColumnTypeSchema,
  isRequired: z.boolean().default(false),
  helpText: z.string().max(500).optional(),
  placeholder: z.string().max(200).optional(),
  maxLength: z.number().int().positive().optional(),
  min: z.number().optional(),
  max: z.number().optional(),
  /** Relative width of this column in the row grid. */
  widthWeight: z.number().int().min(1).max(6).default(1),
  /** Required for single_select, forbidden otherwise — enforced by validateRepeatingGroupConfig. */
  choices: RepeatingGroupChoicesSchema.optional(),
});
export type RepeatingGroupColumn = z.infer<typeof RepeatingGroupColumnSchema>;

/** Eight columns is already unusable on a phone; the cap is a kindness. */
export const REPEATING_GROUP_MAX_COLUMNS = 8;
/** Hard ceiling on rows, independent of a question's own maxRows. */
export const REPEATING_GROUP_MAX_ROWS = 50;

export const RepeatingGroupConfigSchema = z.object({
  columns: z.array(RepeatingGroupColumnSchema).min(1).max(REPEATING_GROUP_MAX_COLUMNS),
  minRows: z.number().int().min(0).max(REPEATING_GROUP_MAX_ROWS).default(0),
  maxRows: z.number().int().min(1).max(REPEATING_GROUP_MAX_ROWS).default(20),
  addRowLabel: z.string().min(1).max(60).default('Add another'),
});
export type RepeatingGroupConfig = z.infer<typeof RepeatingGroupConfigSchema>;

/**
 * Cross-field rules, kept out of the schema so it stays OpenAPI-walkable.
 * Returns an error message, or null when the config is sound.
 */
export function validateRepeatingGroupConfig(
  config: RepeatingGroupConfig,
): string | null {
  const seen = new Set<string>();
  for (const column of config.columns) {
    if (seen.has(column.key)) {
      return `Duplicate column key '${column.key}'.`;
    }
    seen.add(column.key);

    const isSelect = column.columnType === 'single_select';
    if (isSelect && column.choices === undefined) {
      return `Column '${column.key}' is a single_select and must declare choices.`;
    }
    if (!isSelect && column.choices !== undefined) {
      return `Column '${column.key}' is not a single_select and must not declare choices.`;
    }
  }
  if (config.minRows > config.maxRows) {
    return 'minRows must not exceed maxRows.';
  }
  return null;
}

/**
 * One cell. Strings and numbers only — a nested object would make the stored
 * answer unrenderable by the flat table on the candidate profile, and there is
 * no use for one.
 */
export const RepeatingGroupCellSchema = z.union([z.string(), z.number()]);

/** An EMPTY cell is omitted from the row object, never sent as '' or null. */
export const RepeatingGroupRowSchema = z.record(RepeatingGroupCellSchema);
export type RepeatingGroupRow = z.infer<typeof RepeatingGroupRowSchema>;

/**
 * The stored `value_json`.
 *
 * An OBJECT with a `rows` key, never a bare array: a bare array is caught by
 * the existing Array.isArray branch in apps/web/src/lib/answer-value.ts and
 * rendered as "[object Object]" by every consumer we forget to teach. This
 * matches the { fileIds: [...] } precedent already used by file_upload.
 */
export const RepeatingGroupValueSchema = z.object({
  rows: z.array(RepeatingGroupRowSchema).max(REPEATING_GROUP_MAX_ROWS),
});
export type RepeatingGroupValue = z.infer<typeof RepeatingGroupValueSchema>;

/** One validation failure, located to a row and a column. */
export const RepeatingGroupFieldErrorSchema = z.object({
  rowIndex: z.number().int().min(0),
  columnKey: z.string(),
  message: z.string(),
});
export type RepeatingGroupFieldError = z.infer<typeof RepeatingGroupFieldErrorSchema>;

/**
 * What `question_snapshot.repeatingGroup` holds.
 *
 * Every choice column is resolved to `from: 'inline'` carrying ONLY the
 * options the stored rows actually use — a ~200-entry catalogue snapshotted on
 * every answer row costs ~15 KB per candidate and buys nothing, because an
 * option nobody picked can never need rendering.
 */
export const RepeatingGroupSnapshotSchema = z.object({
  columns: z.array(RepeatingGroupColumnSchema),
  minRows: z.number().int(),
  maxRows: z.number().int(),
});
export type RepeatingGroupSnapshot = z.infer<typeof RepeatingGroupSnapshotSchema>;
```

- [ ] **Step 4: Add the key to `validation-rules.ts`**

In `packages/contracts/src/validation-rules.ts`, add the import and the key. The schema stays `.strict()` — AC-Q-11 depends on it.

```ts
import { RepeatingGroupConfigSchema } from './repeating-group.js';

// …inside the object, after maxFileSizeMb:
    /**
     * Column definitions for question_type = 'repeating_group'. Structure, not
     * a rule — but it lives here because buildSnapshot() already copies
     * `validation` into question_snapshot, so the columns are captured for
     * free, and 03 §1.3 blesses this column as "an open-ended rule bag whose
     * keys vary by question type".
     */
    repeatingGroup: RepeatingGroupConfigSchema.optional(),
```

- [ ] **Step 5: Re-export from `index.ts`**

Add `export * from './repeating-group.js';` to `packages/contracts/src/index.ts`, in the same alphabetical position as its neighbours.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter @sdb/contracts test`
Expected: PASS, including the existing `validation-rules.test.ts` and `questions.test.ts`.

- [ ] **Step 7: Build contracts and typecheck the whole repo**

```bash
pnpm --filter @sdb/contracts build
pnpm -r typecheck && pnpm -r lint
```
Expected: green everywhere. `enums.ts` is untouched, so nothing downstream can break yet. If anything is red, stop — it is not caused by this task.

- [ ] **Step 8: Commit**

```bash
git add packages/contracts/src/repeating-group.ts packages/contracts/src/repeating-group.test.ts \
        packages/contracts/src/validation-rules.ts packages/contracts/src/index.ts
git commit -m "feat(contracts): add repeating-group column, value and snapshot schemas"
```

---

# Task 3: The enum, and every compile-forced consumer — ATOMIC

> **ONE AGENT. NO CONCURRENCY. START TO GREEN.** Adding `'repeating_group'` to `QuestionTypeSchema` breaks compilation in `apps/api` and `apps/web` until every consumer is taught. That is the design working as intended (AC-IF-18). It also means the tree is red for the duration, and two agents on a red tree can neither verify nor finish. This task is not done until `pnpm -r typecheck && pnpm -r lint && pnpm -r test` is green.

**Files:**
- Modify: `packages/contracts/src/enums.ts`
- Create: `apps/web/src/features/intake-form/repeating-group.ts`
- Create: `apps/web/src/features/intake-form/components/fields/repeating-group-field.tsx`
- Create: `apps/web/tests/intake-form/repeating-group.test.ts`
- Create: `apps/web/tests/intake-form/repeating-group-field.test.tsx`
- Modify: `apps/web/src/features/intake-form/components/fields/field-shell.tsx`
- Modify: `apps/web/src/features/intake-form/components/question-field.tsx`
- Modify: `apps/web/src/features/intake-form/schema-builder.ts`
- Modify: `apps/web/src/features/intake-form/submission.ts`
- Modify: `apps/web/src/features/intake-form/conditional.ts`
- Modify: `apps/web/src/features/form-builder/block-height.ts`
- Modify: `apps/web/src/features/question-manager/guard-rails.ts`
- Modify: `apps/api/src/services/intake-submission.service.ts` (`EXPECTED_FIELD` and `isBlank` only)
- Modify: `apps/web/tests/intake-form/helpers.ts`

**Interfaces:**
- Consumes: everything Task 2 produced.
- Produces:
  - `repeatingGroupConfig(question: IntakeFormQuestion): RepeatingGroupConfig | null`
  - `readRows(value: unknown): RepeatingGroupRow[]` · `isEmptyRow(row): boolean` · `toRowErrors(error: unknown): RepeatingGroupFieldError[]`
  - `columnOptions(question: IntakeFormQuestion, column: RepeatingGroupColumn): IntakeFormOption[]`
  - `repeatingGroupSchema(question: IntakeFormQuestion): z.ZodTypeAny` (exported from `schema-builder.ts`)
  - `cellFieldId(questionKey: string, rowIndex: number, columnKey: string): string`
  - `RepeatingGroupField(props: FieldProps): JSX.Element`
  - `repeatingGroupPx(config: RepeatingGroupConfig): number` (module-private in `block-height.ts`)
  - `RG_ROW_PITCH_PX` (exported from `block-height.ts`, consumed by Task 8)

### Build the pieces first, then flip the enum

Steps 1–8 create code that does **not** reference the enum member, so the tree stays green. Step 9 flips the enum and Steps 10–15 close the six holes it opens.

- [ ] **Step 1: Add `cellFieldId` and `cellRemoveId` to `field-shell.tsx`**

```ts
/**
 * Anchor/focus target for one cell of a repeating group. The error summary
 * uses this to land on the exact input that failed rather than row 1 cell 1.
 */
export function cellFieldId(
  questionKey: string,
  rowIndex: number,
  columnKey: string,
): string {
  return `${fieldId(questionKey)}-r${String(rowIndex)}-${columnKey}`;
}

/**
 * The remove button for one row. Focus lands here after a removal, so it needs
 * an id the component can look up rather than a DOM walk.
 */
export function cellRemoveId(questionKey: string, rowIndex: number): string {
  return `${fieldId(questionKey)}-r${String(rowIndex)}-remove`;
}

/** The "Add another" button. Focus lands here when the last row is removed. */
export function addRowId(questionKey: string): string {
  return `${fieldId(questionKey)}-add`;
}
```

- [ ] **Step 2: Write the failing tests for the pure web helpers**

Create `apps/web/tests/intake-form/repeating-group.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { RepeatingGroupColumn } from "@sdb/contracts";
import {
  columnOptions,
  repeatingGroupConfig,
} from "@/features/intake-form/repeating-group";
import { repeatingGroupSchema } from "@/features/intake-form/schema-builder";
import { makeQuestion, makeRepeatingGroupQuestion } from "./helpers";

const skillColumn: RepeatingGroupColumn = {
  key: "skill", label: "Skill", columnType: "single_select", isRequired: true,
  widthWeight: 2, choices: { from: "question_options" },
};

describe("repeatingGroupConfig", () => {
  it("returns null for a question with no repeatingGroup rules", () => {
    expect(repeatingGroupConfig(makeQuestion({ key: "q" }))).toBeNull();
  });

  it("returns the config for a repeating-group question", () => {
    const question = makeRepeatingGroupQuestion({ key: "skills" });
    expect(repeatingGroupConfig(question)?.columns).toHaveLength(3);
  });
});

describe("columnOptions", () => {
  it("reads the question's own options for a question_options column", () => {
    const question = makeRepeatingGroupQuestion({
      key: "skills",
      options: [{ value: "ClickUp", label: "ClickUp" }],
    });
    expect(columnOptions(question, skillColumn)).toEqual([
      { value: "ClickUp", label: "ClickUp" },
    ]);
  });

  it("reads inline options for an inline column", () => {
    const question = makeRepeatingGroupQuestion({ key: "skills" });
    const inline: RepeatingGroupColumn = {
      key: "proficiency", label: "Proficiency", columnType: "single_select",
      isRequired: true, widthWeight: 1,
      choices: { from: "inline", options: [{ value: "expert", label: "Expert" }] },
    };
    expect(columnOptions(question, inline)).toEqual([
      { value: "expert", label: "Expert" },
    ]);
  });

  it("returns an empty list for a non-choice column", () => {
    const notes: RepeatingGroupColumn = {
      key: "notes", label: "Notes", columnType: "short_text",
      isRequired: false, widthWeight: 3,
    };
    expect(columnOptions(makeRepeatingGroupQuestion({ key: "s" }), notes)).toEqual([]);
  });
});

describe("repeatingGroupSchema", () => {
  const question = makeRepeatingGroupQuestion({
    key: "skills",
    options: [{ value: "ClickUp", label: "ClickUp" }],
  });

  it("accepts a valid row set", () => {
    const result = repeatingGroupSchema(question).safeParse({
      rows: [{ skill: "ClickUp", proficiency: "expert", notes: "Ran the migration" }],
    });
    expect(result.success).toBe(true);
  });

  it("puts the issue path on the failing row and column", () => {
    const result = repeatingGroupSchema(question).safeParse({
      rows: [{ skill: "ClickUp" }, { skill: "ClickUp", proficiency: "expert" }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["rows", 0, "proficiency"]);
  });

  it("rejects a choice value that is not an option", () => {
    const result = repeatingGroupSchema(question).safeParse({
      rows: [{ skill: "Notion", proficiency: "expert" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more rows than maxRows", () => {
    const rows = Array.from({ length: 21 }, () => ({ skill: "ClickUp", proficiency: "expert" }));
    expect(repeatingGroupSchema(question).safeParse({ rows }).success).toBe(false);
  });
});
```

Add the fixture to `apps/web/tests/intake-form/helpers.ts`:

```ts
/** A repeating-group question shaped like the seeded skills-and-tools one. */
export function makeRepeatingGroupQuestion(
  overrides: Partial<IntakeFormQuestion> & Pick<IntakeFormQuestion, "key">,
): IntakeFormQuestion {
  return makeQuestion({
    questionType: "repeating_group",
    validation: {
      repeatingGroup: {
        columns: [
          { key: "skill", label: "Skill", columnType: "single_select",
            isRequired: true, widthWeight: 2, choices: { from: "question_options" } },
          { key: "proficiency", label: "Proficiency", columnType: "single_select",
            isRequired: true, widthWeight: 1,
            choices: { from: "inline", options: [
              { value: "aware", label: "Aware" },
              { value: "working", label: "Working" },
              { value: "proficient", label: "Proficient" },
              { value: "expert", label: "Expert" },
            ] } },
          { key: "notes", label: "Notes", columnType: "short_text",
            isRequired: false, widthWeight: 3, maxLength: 500 },
        ],
        minRows: 0,
        maxRows: 20,
        addRowLabel: "Add another",
      },
    },
    ...overrides,
  });
}
```

> `questionType: "repeating_group"` will not compile until Step 9. That is expected — this fixture is written now and the tests go red until the enum lands. Note it and move on.

- [ ] **Step 3: Write `apps/web/src/features/intake-form/repeating-group.ts`**

```ts
/**
 * Pure helpers shared by the repeating-group control, its Zod schema, its
 * height calculation and the error plumbing. Kept out of the component so all
 * four can be tested without a render — jsdom is not where arithmetic or
 * option resolution should be verified.
 */
import type {
  IntakeFormOption,
  IntakeFormQuestion,
  RepeatingGroupColumn,
  RepeatingGroupConfig,
  RepeatingGroupFieldError,
} from "@sdb/contracts";

const NO_OPTIONS: readonly IntakeFormOption[] = [];

/** The column definitions for a question, or null when it is not a repeating group. */
export function repeatingGroupConfig(
  question: IntakeFormQuestion,
): RepeatingGroupConfig | null {
  return question.validation.repeatingGroup ?? null;
}

/**
 * The choices for one column.
 *
 * `question_options` reads the question's OWN option list — the same list the
 * existing options editor writes, which is what lets an admin edit the skill
 * catalogue with no new UI. It arrives with the form payload, so there is no
 * fetch and no loading state.
 */
export function columnOptions(
  question: IntakeFormQuestion,
  column: RepeatingGroupColumn,
): readonly IntakeFormOption[] {
  if (column.choices === undefined) return NO_OPTIONS;
  return column.choices.from === "question_options"
    ? question.options
    : column.choices.options;
}

/**
 * The rows currently held in a field value, or [] for anything else.
 *
 * Tolerant on purpose: this runs on every keystroke against react-hook-form
 * state that starts as undefined, and a control that throws on its own initial
 * value is a control that never renders.
 */
export function readRows(value: unknown): RepeatingGroupRow[] {
  const parsed = RepeatingGroupValueSchema.safeParse(value);
  return parsed.success ? parsed.data.rows : [];
}

/** True when a row carries no answered cell at all. */
export function isEmptyRow(row: Record<string, unknown>): boolean {
  return Object.values(row).every(
    (cell) => cell === undefined || cell === null || cell === "",
  );
}

/**
 * Flatten react-hook-form's nested error object for a repeating group into the
 * flat shape the control and the error summary both consume.
 *
 * RHF nests by the Zod issue path, so `rows[2].skill` arrives as
 * `{ rows: { 2: { skill: { message } } } }`. `unknown` and the narrowing below
 * rather than RHF's FieldErrors generics: the form's value type is
 * Record<string, unknown>, so RHF cannot type these paths anyway.
 */
export function toRowErrors(error: unknown): RepeatingGroupFieldError[] {
  if (typeof error !== "object" || error === null) return [];
  const rows = (error as { rows?: unknown }).rows;
  if (typeof rows !== "object" || rows === null) return [];

  const result: RepeatingGroupFieldError[] = [];
  for (const [indexKey, rowError] of Object.entries(rows)) {
    const rowIndex = Number(indexKey);
    if (!Number.isInteger(rowIndex)) continue;
    if (typeof rowError !== "object" || rowError === null) continue;
    for (const [columnKey, cellError] of Object.entries(rowError)) {
      const message = (cellError as { message?: unknown })?.message;
      if (typeof message === "string") {
        result.push({ rowIndex, columnKey, message });
      }
    }
  }
  return result;
}
```

- [ ] **Step 4: Add `repeatingGroupSchema` to `schema-builder.ts`**

Export it (it is unit-tested directly) and leave `baseSchemaFor` alone for now:

```ts
import { columnOptions, repeatingGroupConfig } from "./repeating-group";
import type { RepeatingGroupColumn } from "@sdb/contracts";

function cellSchema(
  question: IntakeFormQuestion,
  column: RepeatingGroupColumn,
): z.ZodTypeAny {
  switch (column.columnType) {
    case "number": {
      let schema = z.number({ invalid_type_error: "Enter a number." });
      if (column.min !== undefined) schema = schema.min(column.min, `Must be at least ${column.min}.`);
      if (column.max !== undefined) schema = schema.max(column.max, `Must be at most ${column.max}.`);
      return schema;
    }
    case "month":
      return z
        .string()
        .regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Enter a month, for example 2024-03.");
    case "single_select": {
      const values = columnOptions(question, column).map((option) => option.value);
      const [first, ...rest] = values;
      // A misconfigured column with no choices accepts any string; the server
      // remains the authority (INVALID_OPTION).
      if (first === undefined) return z.string();
      return z.enum([first, ...rest], {
        invalid_type_error: "Choose one of the provided options.",
      });
    }
    case "short_text":
    case "long_text": {
      let schema = z.string();
      if (column.maxLength !== undefined) {
        schema = schema.max(column.maxLength, `Must be at most ${column.maxLength} characters.`);
      }
      return schema;
    }
    default: {
      const unhandled: never = column.columnType;
      throw new Error(`Unhandled repeating-group column type: ${String(unhandled)}`);
    }
  }
}
/**
 * Schema for a repeating-group answer, built column by column so Zod issue
 * paths come out as ["rows", 2, "skill"] — which is what lets an error find
 * its exact cell instead of collapsing to one message for the whole table.
 *
 * A REQUIRED cell is `.optional()` followed by a refine, not a bare required
 * schema. z.preprocess turns "" into undefined, and an undefined value against
 * a non-optional schema produces Zod's own "Required" wording rather than
 * REQUIRED_MESSAGE — which is the copy every other field in this form uses.
 */
export function repeatingGroupSchema(question: IntakeFormQuestion): z.ZodTypeAny {
  const config = repeatingGroupConfig(question);
  // Not a repeating group, or a misconfigured one. The API rejects the latter
  // on write (AC-FB-01); the renderer must not crash on it in the meantime.
  if (config === null) return z.unknown();

  const shape: Record<string, z.ZodTypeAny> = {};
  for (const column of config.columns) {
    const cell = cellSchema(question, column).optional();
    shape[column.key] = z.preprocess(
      blankToUndefined,
      column.isRequired
        ? cell.refine((value) => value !== undefined, REQUIRED_MESSAGE)
        : cell,
    );
  }

  return z.object({
    rows: z
      .array(z.object(shape))
      .min(
        config.minRows,
        config.minRows === 1
          ? "Add at least one row."
          : `Add at least ${String(config.minRows)} rows.`,
      )
      .max(config.maxRows, `Add at most ${String(config.maxRows)} rows.`),
  });
}
```

> `.strict()` is deliberately NOT used on the row object. An unknown column key
> — a column retired between page load and submit — is stripped by
> `z.object`'s default behaviour rather than raising, which mirrors the server's
> step 3 and means a mid-session config change cannot block a submission.

- [ ] **Step 5: Run the helper tests — expect two kinds of failure**

Run: `cd apps/web && pnpm vitest run tests/intake-form/repeating-group.test.ts`
Expected: FAIL — the `makeRepeatingGroupQuestion` fixture does not compile because `"repeating_group"` is not yet a `QuestionType`. Everything else in the file should be sound. Do not fix it by casting; the enum lands in Step 9.

- [ ] **Step 6: Write the failing component test**

Create `apps/web/tests/intake-form/repeating-group-field.test.tsx`:

```tsx
/**
 * The repeating-group control: structure, add, remove, and the empty state.
 * Focus management and the live region are Task 6.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RepeatingGroupField } from "@/features/intake-form/components/fields/repeating-group-field";
import { makeRepeatingGroupQuestion } from "./helpers";

function renderField(value: unknown, onChange = vi.fn()) {
  const question = makeRepeatingGroupQuestion({
    key: "skills_and_tools",
    label: "Skills & tools",
    options: [
      { value: "ClickUp", label: "ClickUp" },
      { value: "Notion", label: "Notion" },
    ],
  });
  render(
    <RepeatingGroupField
      question={question}
      value={value}
      onChange={onChange}
      onBlur={vi.fn()}
      error={undefined}
    />,
  );
  return { onChange };
}

describe("RepeatingGroupField", () => {
  it("renders an empty state and an add button when there are no rows", () => {
    renderField({ rows: [] });
    expect(screen.getByText(/nothing added yet/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /add another/i })).toBeInTheDocument();
  });

  it("uses a fieldset whose legend is the question label (AC-UI-03)", () => {
    renderField({ rows: [] });
    expect(screen.getByRole("group", { name: /skills & tools/i })).toBeInTheDocument();
  });

  it("gives every cell input an accessible name naming its column", () => {
    renderField({ rows: [{ skill: "ClickUp", proficiency: "expert" }] });
    expect(screen.getByRole("combobox", { name: /skill/i })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /notes/i })).toBeInTheDocument();
  });

  it("exposes each row as a group naming its position", () => {
    renderField({ rows: [{ skill: "ClickUp" }, { skill: "Notion" }] });
    expect(screen.getByRole("group", { name: "Row 2" })).toBeInTheDocument();
  });

  it("appends a row when Add another is activated", async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({ rows: [{ skill: "ClickUp" }] });
    await user.click(screen.getByRole("button", { name: /add another/i }));
    expect(onChange).toHaveBeenCalledWith({ rows: [{ skill: "ClickUp" }, {}] });
  });

  it("removes the named row", async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({ rows: [{ skill: "ClickUp" }, { skill: "Notion" }] });
    await user.click(screen.getByRole("button", { name: "Remove row 1" }));
    expect(onChange).toHaveBeenCalledWith({ rows: [{ skill: "Notion" }] });
  });

  it("omits an emptied cell from the row rather than storing an empty string", async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({ rows: [{ notes: "x" }] });
    await user.clear(screen.getByRole("textbox", { name: /notes/i }));
    expect(onChange).toHaveBeenLastCalledWith({ rows: [{}] });
  });
});
```

- [ ] **Step 7: Write `repeating-group-field.tsx`**

The markup skeleton — get this exactly right, because the a11y is in the structure and cannot be retrofitted:

```tsx
export function RepeatingGroupField(props: FieldProps) {
  const { question, value, onChange, onBlur, error } = props;
  const config = repeatingGroupConfig(question);
  // A repeating group with no columns is a misconfiguration the API rejects on
  // write (AC-FB-01). Render nothing rather than a broken table.
  if (config === null) return null;

  const rows = readRows(value);              // RepeatingGroupValueSchema, defaulting to []
  const rowErrors = props.rowErrors ?? [];   // wired in Task 7; a pure addition
  const template = [
    ...config.columns.map((column) => `minmax(0, ${String(column.widthWeight)}fr)`),
    "auto",                                   // the remove-button column
  ].join(" ");

  return (
    <GroupShell question={question} error={error}>
      {/* Decorative duplication of the per-input labels below — a screen
          reader in forms mode announces the input's own name, never this. */}
      <div
        aria-hidden="true"
        className="hidden gap-2 text-xs text-neutral-600 sm:grid"
        style={{ gridTemplateColumns: template }}
      >
        {config.columns.map((column) => (
          <span key={column.key}>{column.label}</span>
        ))}
        <span />
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-neutral-600">Nothing added yet.</p>
      ) : null}

      <div className="space-y-2">
        {rows.map((row, rowIndex) => (
          <div
            // A STABLE per-row id, never the array index: with index keys,
            // removing row 2 makes React reuse row 3's DOM node and focus and
            // cell values follow the wrong row.
            key={rowIds[rowIndex]}
            role="group"
            aria-label={`Row ${String(rowIndex + 1)}`}
            // `relative` is NOT optional. The sr-only labels below are
            // position:absolute and anchor to the document without a
            // positioned ancestor, stretching the page (HANDOFF §7).
            className="relative grid gap-2 sm:grid-flow-col"
            style={{ gridTemplateColumns: template }}
          >
            {config.columns.map((column) => {
              const id = cellFieldId(question.key, rowIndex, column.key);
              const cellError = rowErrors.find(
                (candidate) =>
                  candidate.rowIndex === rowIndex && candidate.columnKey === column.key,
              );
              return (
                <div key={column.key}>
                  <label htmlFor={id} className="sr-only">
                    {column.label}
                  </label>
                  <CellControl
                    id={id}
                    question={question}
                    column={column}
                    value={row[column.key]}
                    onChange={(next) => writeCell(rowIndex, column.key, next)}
                    onBlur={onBlur}
                    invalid={cellError !== undefined}
                    describedById={cellError === undefined ? undefined : `${id}-error`}
                  />
                  {cellError === undefined ? null : (
                    <p id={`${id}-error`} className="text-xs text-danger-text">
                      {cellError.message}
                    </p>
                  )}
                </div>
              );
            })}
            <button
              type="button"
              id={cellRemoveId(question.key, rowIndex)}
              onClick={() => removeRow(rowIndex)}
              // A NAME, not a bare icon. "Remove row 2" is what a screen
              // reader announces and what the test locates by.
              aria-label={`Remove row ${String(rowIndex + 1)}`}
            >
              <X aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      <button type="button" id={addRowId(question.key)} onClick={addRow}>
        {config.addRowLabel}
      </button>

      {/* One live region owned by the control. Its ancestor is positioned. */}
      <p role="status" aria-live="polite" className="sr-only">
        {announcement}
      </p>
    </GroupShell>
  );
}
```

The rest of the requirements, all verified by the tests above and in Task 6:

- `GroupShell` gives the `<fieldset>`, `<legend>`, help text, `aria-describedby`, `aria-invalid` and `id = fieldId(question.key)`, so `focusField()` already works with **no change**.
- **A CSS grid, not a `<table>`.** `<th scope="col">` labels cells in a screen reader's *browse* mode; inside a form the reader is in *forms* mode and announces only each input's own accessible name, so headers alone label nothing. Nesting per-row groups inside a table also breaks table semantics.
- `CellControl` per column type: `short_text` / `month` / `number` → `<Input>` with `type="text" | "month" | "number"`; `long_text` → `<Textarea rows={2}>`; `single_select` → `<NativeSelect>` at or below 12 options, `<SearchableSelect>` above it. **12 is `SEARCHABLE_SELECT_MIN_OPTIONS` in `select-fields.tsx`** — a form must not teach two different pickers, so mirror the threshold rather than inventing one, and copy the constant with a comment naming its source.
- Below `sm` the row stacks (the `sm:` prefixes above), and the stacked layout shows the visible column label in place of the hidden header row — swap `className="sr-only"` for `className="sr-only sm:not-sr-only"`-style handling, or render the label twice. Whichever you choose, **exactly one label element per input** must be associated by `htmlFor`.
- `rowIds` lives in component state: appended on add, spliced on remove, never regenerated from the value.
- `writeCell` **deletes** the key from the row object when the next value is `""` or `undefined`. An empty cell is omitted, never stored as an empty string — that is what makes `isEmptyRow` a one-line check on both sides of the wire.
- Empty state: headers, "Nothing added yet.", and the Add button. Never a bare button with no context.
- `rowErrors` is optional here; Task 7 supplies it. Reading `props.rowErrors ?? []` now makes that task a pure addition.

- [ ] **Step 8: Give `block-height.ts` a `repeatingGroupPx`**

Add beside the other height helpers. The `default:` arm was already replaced with a `never` guard and `UNKNOWN_CONTROL_PX = 120` in a separate fix, so this file will refuse to compile at Step 9 until the case exists — which is what we want.

```ts
/** One row of cell controls in a repeating group: an h-9 Input. */
const RG_ROW_PX = CONTROL_PX;
/** The header row: one line of text-xs. */
const RG_HEADER_PX = CAPTION_PX;
/** `space-y-2` between rows. */
const RG_ROW_GAP_PX = 8;
/** The "Add another" button: `h-8` plus the `space-y-2` above it. */
const RG_ADD_PX = 32 + 8;

/**
 * Pixels one extra row adds — the row plus the gap above it.
 *
 * EXPORTED because layout-growth.ts converts "the candidate added three rows"
 * into grid rows, and a private copy of this number there would drift the
 * first time the row control changes height.
 */
export const RG_ROW_PITCH_PX = RG_ROW_PX + RG_ROW_GAP_PX;

/**
 * A repeating group is sized for its BASE state — max(minRows, 1) rows. Rows
 * added at fill time are handled by shiftForGrowth (form-builder/layout-growth.ts),
 * which pushes down only the blocks that collide. Reserving maxRows here would
 * leave a ~900px hole on every form for a table someone fills with two rows.
 */
function repeatingGroupPx(config: RepeatingGroupConfig): number {
  const rows = Math.max(config.minRows, 1);
  return (
    RG_HEADER_PX +
    STACK_GAP_PX +
    rows * RG_ROW_PX +
    (rows - 1) * RG_ROW_GAP_PX +
    RG_ADD_PX
  );
}
```

Add the case to `controlPx`, before the `never` guard:

```ts
    case "repeating_group": {
      const config = question.validation.repeatingGroup;
      // A repeating group with no columns is a misconfiguration the API
      // rejects; size it as one empty row rather than collapsing the block.
      return config === undefined
        ? RG_HEADER_PX + STACK_GAP_PX + RG_ROW_PX + RG_ADD_PX
        : repeatingGroupPx(config);
    }
```

Add a test to `apps/web/tests/form-builder/block-height.test.ts` asserting `naturalRowSpan` for a 3-column, `minRows: 0` repeating group is the ceiling of the formula divided by 8, and that it is strictly greater than the span of a plain `short_text` question with the same label.

- [ ] **Step 9: Flip the enum**

In `packages/contracts/src/enums.ts`, add `'repeating_group'` to `QuestionTypeSchema`, last in the list. Then:

```bash
pnpm --filter @sdb/contracts build
pnpm -r typecheck
```

Expected: **RED**, with errors in exactly these places. Confirm all of them appear — a missing one means a guard has rotted and should be reported:

1. `apps/api/src/services/intake-submission.service.ts` — `EXPECTED_FIELD` is missing `repeating_group`.
2. `apps/web/src/features/intake-form/components/question-field.tsx` — `HANDLED_QUESTION_TYPES` and the `never` guard.
3. `apps/web/src/features/intake-form/schema-builder.ts` — the `never` guard in `baseSchemaFor`.
4. `apps/web/src/features/intake-form/submission.ts` — the `never` guard in `toAnswer`.
5. `apps/web/src/features/question-manager/guard-rails.ts` — `VALIDATION_KEYS_BY_TYPE` and `QUESTION_TYPE_LABELS`.
6. `apps/web/src/features/form-builder/block-height.ts` — the `never` guard in `controlPx` (fixed by Step 8 if you did it in the right order; if you did Step 8 already, this one is green).

- [ ] **Step 10: Teach `EXPECTED_FIELD` and `isBlank` in the API**

In `apps/api/src/services/intake-submission.service.ts`:

```ts
const EXPECTED_FIELD: Record<QuestionType, ValueField> = {
  // …existing entries…
  repeating_group: 'valueJson',
};
```

and in `isBlank` (line ~92):

```ts
function isBlank(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === 'string') return value.length === 0;
  if (typeof value === 'number') return Number.isNaN(value);
  if (Array.isArray(value)) return value.length === 0;
  /*
   * A repeating group whose rows were all removed is blank. Without this a
   * candidate who adds a row and then deletes it submits { rows: [] }, the
   * required check passes on an answer with nothing in it, and an empty
   * answer row is written. No other question type produces an object with a
   * `rows` key, so this branch cannot affect one.
   */
  if (typeof value === 'object' && Array.isArray((value as { rows?: unknown }).rows)) {
    return (value as { rows: unknown[] }).rows.length === 0;
  }
  return false;
}
```

Make the **identical** change to `isBlank` in `apps/web/src/features/intake-form/conditional.ts`. The two are duplicated deliberately; merging them is a separate refactor. Add a test to `apps/web/tests/intake-form/conditional.test.ts` pinning `isBlank({ rows: [] }) === true` and `isBlank({ rows: [{}] }) === false`.

- [ ] **Step 11: Teach `question-field.tsx`**

```tsx
export const HANDLED_QUESTION_TYPES = {
  // …existing entries…
  repeating_group: true,
} as const satisfies Record<QuestionType, true>;

// …in the switch:
    case "repeating_group":
      return <RepeatingGroupField {...props} />;
```

- [ ] **Step 12: Teach `schema-builder.ts` and `submission.ts`**

In `baseSchemaFor`:

```ts
    case "repeating_group":
      return repeatingGroupSchema(question);
```

In `buildQuestionSchema`, a repeating group must not be wrapped by the generic `blankToUndefined` + `optional()` path when it is optional, or `{ rows: [] }` becomes a validation error instead of "unanswered". Add, beside the existing `file_upload` special case:

```ts
  if (question.questionType === "repeating_group") {
    // An unanswered repeating group is { rows: [] }, which the schema accepts
    // when minRows is 0. Requiredness is enforced by minRows, not by the
    // optional() wrapper — wrapping it would reject the empty table outright.
    return base;
  }
```

In `toAnswer`:

```ts
    case "repeating_group": {
      const parsed = RepeatingGroupValueSchema.safeParse(value);
      // A malformed value is dropped rather than sent — the server would
      // reject it with VALUE_TYPE_MISMATCH and the candidate would see an
      // error about a shape they never typed.
      return parsed.success
        ? { questionKey: question.key, valueJson: { rows: parsed.data.rows } as JsonValue }
        : null;
    }
```

Add tests to `apps/web/tests/intake-form/submission.test.ts` for the happy path and for a malformed value returning `null`.

- [ ] **Step 13: Teach `guard-rails.ts` — and read this before you type it**

```ts
export const VALIDATION_KEYS_BY_TYPE: Record<QuestionType, readonly ValidationRuleKey[]> = {
  // …existing entries…
  /*
   * ⚠ 'repeatingGroup' MUST be here. pruneValidation() keeps only the keys in
   * this list, so an empty array — which compiles perfectly — makes every save
   * from the question editor silently DELETE the column definitions. The
   * question survives, its columns do not, and the form renders an empty
   * table. Nothing warns and nothing throws. AC-FB-14 is the regression test.
   */
  repeating_group: ["repeatingGroup"],
};

export const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  // …existing entries…
  repeating_group: "Repeating table",
};
```

Add the regression test to `apps/web/tests/question-manager/` (follow the existing file naming there):

```ts
it("AC-FB-14 — pruneValidation keeps a repeating group's column definitions", () => {
  const validation: ValidationRules = { repeatingGroup: { columns: [/* one column */], minRows: 0, maxRows: 20, addRowLabel: "Add another" } };
  expect(pruneValidation("repeating_group", validation)).toEqual(validation);
});
```

- [ ] **Step 14: Run everything to green**

```bash
pnpm --filter @sdb/contracts build
pnpm -r typecheck && pnpm -r lint && pnpm -r test
```
Expected: PASS. `apps/web/tests/intake-form/exhaustiveness.test.ts` (AC-IF-18) must now pass with 13 types.

- [ ] **Step 15: Commit**

```bash
git add -A
git commit -m "feat: add repeating_group question type and teach every exhaustiveness guard"
```

---

# Task 4: API — row validation, normalisation and the snapshot

**Safe to run concurrently with:** T5, T6, T8, T9, T10, T11.

**Files:**
- Create: `apps/api/src/services/repeating-group.ts`
- Create: `apps/api/tests/repeating-group.test.ts`
- Modify: `apps/api/src/services/intake-submission.service.ts`

**Interfaces:**
- Consumes: everything from Task 2; `FormQuestionRecord` from `candidate-registration.service.ts` (re-exported there).
- Produces:
  - `normaliseRepeatingGroup(config, questionOptions, value): { rows: RepeatingGroupRow[]; errors: RepeatingGroupFieldError[]; groupError: string | null }`
  - `snapshotRepeatingGroup(config, questionOptions, rows): RepeatingGroupSnapshot`

This is a **service**, not a repository: it is pure, does no SQL, and takes the question's options as an argument because `validateSubmission`'s scope record already loads them active-only. **No repository change is needed anywhere in this feature.**

- [ ] **Step 1: Write the failing tests**

Create `apps/api/tests/repeating-group.test.ts`:

```ts
/**
 * The repeating-group row validator. Pure, so it runs without Docker — which
 * matters, because the integration suite that covers AC-FB-03..07 end to end
 * cannot run on the original dev machine.
 */
import { describe, expect, it } from 'vitest';
import { RepeatingGroupConfigSchema } from '@sdb/contracts';
import {
  normaliseRepeatingGroup,
  snapshotRepeatingGroup,
} from '../src/services/repeating-group.js';

const config = RepeatingGroupConfigSchema.parse({
  columns: [
    { key: 'skill', label: 'Skill', columnType: 'single_select', isRequired: true,
      choices: { from: 'question_options' } },
    { key: 'proficiency', label: 'Proficiency', columnType: 'single_select', isRequired: true,
      choices: { from: 'inline', options: [
        { value: 'aware', label: 'Aware' }, { value: 'expert', label: 'Expert' } ] } },
    { key: 'notes', label: 'Notes', columnType: 'short_text', isRequired: false, maxLength: 10 },
    { key: 'year', label: 'Year', columnType: 'number', isRequired: false, min: 1950, max: 2100 },
    { key: 'from_month', label: 'From', columnType: 'month', isRequired: false },
  ],
  minRows: 1,
  maxRows: 3,
});

const questionOptions = [
  { value: 'ClickUp', label: 'ClickUp' },
  { value: 'Notion', label: 'Notion' },
];

const run = (value: unknown) => normaliseRepeatingGroup(config, questionOptions, value);

describe('normaliseRepeatingGroup', () => {
  it('returns the rows unchanged when every cell is valid', () => {
    const result = run({ rows: [{ skill: 'ClickUp', proficiency: 'expert', notes: 'ok' }] });
    expect(result.groupError).toBeNull();
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([{ skill: 'ClickUp', proficiency: 'expert', notes: 'ok' }]);
  });

  it('sets a groupError when the value is not { rows: [...] }', () => {
    expect(run([{ skill: 'ClickUp' }]).groupError).not.toBeNull();
    expect(run({ rows: 'nope' }).groupError).not.toBeNull();
  });

  it('AC-FB-05 — drops a wholly empty row instead of rejecting it', () => {
    const result = run({ rows: [{ skill: 'ClickUp', proficiency: 'expert' }, {}] });
    expect(result.rows).toHaveLength(1);
    expect(result.errors).toEqual([]);
  });

  it('strips an unknown column key without erroring', () => {
    const result = run({ rows: [{ skill: 'ClickUp', proficiency: 'expert', retired: 'x' }] });
    expect(result.rows[0]).toEqual({ skill: 'ClickUp', proficiency: 'expert' });
    expect(result.errors).toEqual([]);
  });

  it('AC-FB-03 — reports EVERY row missing a required column, not just the first', () => {
    const result = run({ rows: [{ skill: 'ClickUp' }, { skill: 'Notion' }] });
    expect(result.errors).toEqual([
      { rowIndex: 0, columnKey: 'proficiency', message: expect.stringMatching(/required/i) },
      { rowIndex: 1, columnKey: 'proficiency', message: expect.stringMatching(/required/i) },
    ]);
  });

  it('AC-FB-06 — rejects a choice value that is not an active option, naming the cell', () => {
    const result = run({ rows: [{ skill: 'Airtable', proficiency: 'expert' }] });
    expect(result.errors).toEqual([
      { rowIndex: 0, columnKey: 'skill', message: expect.stringMatching(/not an active option/i) },
    ]);
  });

  it('coerces a numeric string and rejects a non-numeric one', () => {
    const ok = run({ rows: [{ skill: 'ClickUp', proficiency: 'expert', year: '1999' }] });
    expect(ok.rows[0]?.year).toBe(1999);
    const bad = run({ rows: [{ skill: 'ClickUp', proficiency: 'expert', year: 'abc' }] });
    expect(bad.errors[0]).toMatchObject({ rowIndex: 0, columnKey: 'year' });
  });

  it('enforces min, max and maxLength per cell', () => {
    expect(run({ rows: [{ skill: 'ClickUp', proficiency: 'expert', year: 1900 }] }).errors[0])
      .toMatchObject({ columnKey: 'year' });
    expect(run({ rows: [{ skill: 'ClickUp', proficiency: 'expert', notes: 'x'.repeat(11) }] }).errors[0])
      .toMatchObject({ columnKey: 'notes' });
  });

  it('rejects an impossible month', () => {
    expect(run({ rows: [{ skill: 'ClickUp', proficiency: 'expert', from_month: '2024-13' }] }).errors[0])
      .toMatchObject({ columnKey: 'from_month' });
    expect(run({ rows: [{ skill: 'ClickUp', proficiency: 'expert', from_month: '2024-03' }] }).errors)
      .toEqual([]);
  });

  it('AC-FB-04 — sets a groupError outside minRows/maxRows', () => {
    expect(run({ rows: [] }).groupError).toMatch(/at least/i);
    const four = Array.from({ length: 4 }, () => ({ skill: 'ClickUp', proficiency: 'expert' }));
    expect(run({ rows: four }).groupError).toMatch(/at most/i);
  });
});

describe('snapshotRepeatingGroup', () => {
  const rows = [{ skill: 'ClickUp', proficiency: 'expert' }];

  it('AC-FB-07 — resolves a question_options column to inline, with ONLY the used options', () => {
    const snapshot = snapshotRepeatingGroup(config, questionOptions, rows);
    const skill = snapshot.columns.find((column) => column.key === 'skill');
    expect(skill?.choices).toEqual({
      from: 'inline',
      options: [{ value: 'ClickUp', label: 'ClickUp' }],
    });
  });

  it('leaves an inline column exactly as configured', () => {
    const snapshot = snapshotRepeatingGroup(config, questionOptions, rows);
    const proficiency = snapshot.columns.find((column) => column.key === 'proficiency');
    expect(proficiency?.choices).toEqual({
      from: 'inline',
      options: [{ value: 'aware', label: 'Aware' }, { value: 'expert', label: 'Expert' }],
    });
  });

  it('copies non-choice columns verbatim, so a later rename cannot rewrite history', () => {
    const snapshot = snapshotRepeatingGroup(config, questionOptions, rows);
    expect(snapshot.columns.find((column) => column.key === 'notes')?.label).toBe('Notes');
    expect(snapshot.minRows).toBe(1);
    expect(snapshot.maxRows).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && pnpm vitest run tests/repeating-group.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `apps/api/src/services/repeating-group.ts`**

Order of operations, exactly:

1. `RepeatingGroupValueSchema.safeParse(value)`; on failure return a `groupError` — the caller turns it into `VALUE_TYPE_MISMATCH` via `jsonShapeOk`.
2. Drop wholly empty rows. **Before anything else that could error** — an added-then-abandoned row is not a mistake.
3. Strip unknown column keys. Forward-compatible with a column retired between page load and submit; mirrors how a deactivated question's answer is simply not stored.
4. `rows.length < config.minRows` / `> config.maxRows` → `groupError`.
5. Per surviving row, per column, **collecting every failure**: required · type coercion (`number` from a numeric string, `month` against `/^\d{4}-(0[1-9]|1[0-2])$/`) · `maxLength` / `min` / `max` · option membership for choice columns.

`snapshotRepeatingGroup` copies `config.columns` verbatim, then for each column whose `choices.from === 'question_options'` replaces it with `{ from: 'inline', options: <only the options whose value appears in rows[*][column.key]> }`.

- [ ] **Step 4: Run to verify pass**

Run: `cd apps/api && pnpm vitest run tests/repeating-group.test.ts`
Expected: PASS.

- [ ] **Step 5: Wire into `intake-submission.service.ts`**

Four edits. All three submission paths (`/intake-submissions`, `/requisitions`, `/candidate-forms/public/:slug/submissions`, `/candidate-registrations`) go through this file, so this is the only place the API learns the type.

1. `jsonShapeOk` — `case 'repeating_group': return RepeatingGroupValueSchema.safeParse(value).success;`
2. `checkValidationRules` — for a `repeating_group` question, call `normaliseRepeatingGroup` and return `groupError` if set, else a summary string when `errors.length > 0`. It returns `string | null` today; **keep that signature** and surface the per-row detail through the throw site instead (next step) rather than widening a function four other types share.
3. The `VALIDATION_FAILED` throw — when the failing question is a repeating group, attach `{ message, rows }` instead of a bare string:

```ts
"details": { "fields": { "skills_and_tools": { "message": "2 rows have problems.",
  "rows": [ { "rowIndex": 1, "columnKey": "proficiency", "message": "This field is required." } ] } } }
```

`mapSubmissionError`'s `messageFrom()` on the web side already reads `.message` off an object, so a client that knows nothing about rows still shows a sensible message. Do not change that behaviour.

4. `validateSubmission`'s return — for a repeating group, return the **normalised** rows as `valueJson`, so the stored value always matches the snapshot's columns. This is a behaviour change for this type only; add a comment saying so.

Then `buildSnapshot`:

```ts
  if (question.questionType === 'repeating_group') {
    // Columns are copied VERBATIM so a later rename or removal cannot change
    // what a candidate is recorded as having answered (AC-IF-12), and the
    // catalogue is resolved down to only the options these rows use — 200
    // entries per answer row costs ~15 KB and buys nothing.
    snapshot['repeatingGroup'] = snapshotRepeatingGroup(config, question.options, rows);
    // …and DO NOT write the top-level `options` catalogue for this type.
  }
```

`buildSnapshot(question, capturedAt)` gains a third optional parameter carrying the normalised rows. Existing callers pass two arguments and are unaffected.

- [ ] **Step 6: Run the API unit suite and typecheck**

```bash
cd apps/api && pnpm test && pnpm typecheck && pnpm lint
```
Expected: PASS. **The integration suite cannot run here — Docker is not installed.** Say so explicitly when reporting.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src/services/repeating-group.ts apps/api/tests/repeating-group.test.ts apps/api/src/services/intake-submission.service.ts
git commit -m "feat(api): validate, normalise and snapshot repeating-group answers"
```

---

# Task 5: API — reject a repeating group with no columns

**Safe to run concurrently with:** T4, T6–T11.

**Files:**
- Modify: `apps/api/src/services/questions.service.ts`

**Interfaces:**
- Consumes: `validateRepeatingGroupConfig` from Task 2.
- Produces: nothing other tasks consume.

- [ ] **Step 1: Write the failing test**

Add to the API unit tests (or `apps/api/tests/integration/ac-questions.test.ts` if the service is only reachable through a route — check which, and follow the existing pattern in that file). Assert:

- creating a `repeating_group` question with no `validation.repeatingGroup` returns `422 INVALID_VALIDATION_RULE` (AC-FB-01);
- creating one with duplicate column keys returns the same code with the message from `validateRepeatingGroupConfig`;
- creating one with a well-formed config succeeds.

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/api && pnpm test` (or `pnpm test:integration`, noting it needs Docker).
Expected: FAIL — the question is created.

- [ ] **Step 3: Implement**

`questions.service.ts` already runs `ValidationRulesSchema.safeParse(validation ?? {})` at line ~170 and raises `422 INVALID_VALIDATION_RULE`. Extend that same check:

```ts
  if (questionType === 'repeating_group') {
    const config = result.data.repeatingGroup;
    if (config === undefined) {
      throw new ApiError(
        'INVALID_VALIDATION_RULE',
        "A repeating_group question must declare validation.repeatingGroup with at least one column.",
      );
    }
    const problem = validateRepeatingGroupConfig(config);
    if (problem !== null) {
      throw new ApiError('INVALID_VALIDATION_RULE', problem);
    }
  }
```

Reuse the existing error code rather than inventing one — an admin's mental model is "the rules are wrong", and a new code would need a new entry in the error catalogue and the OpenAPI doc.

- [ ] **Step 4: Run to verify pass, then commit**

```bash
cd apps/api && pnpm test && pnpm typecheck && pnpm lint
git add apps/api/src/services/questions.service.ts apps/api/tests
git commit -m "feat(api): reject a repeating_group question with no column definitions"
```

---

# Task 6: The control's keyboard behaviour, focus and live region

**Safe to run concurrently with:** T4, T5, T8–T11. **Run before T7** (both touch the same component).

**Files:**
- Modify: `apps/web/src/features/intake-form/components/fields/repeating-group-field.tsx`
- Modify: `apps/web/tests/intake-form/repeating-group-field.test.tsx`

**Interfaces:**
- Consumes: the component from Task 3.
- Produces: no new exports.

- [ ] **Step 1: Write the failing tests**

The component reads `value` from props, so a test that clicks Add must re-render with the new value. Add this controlled wrapper to the test file first:

```tsx
import { useState } from "react";
import {
  addRowId,
  cellFieldId,
  cellRemoveId,
} from "@/features/intake-form/components/fields/field-shell";

const KEY = "skills_and_tools";

function renderControlled(
  initial: { rows: Record<string, string | number>[] },
  overrides: Partial<IntakeFormQuestion> = {},
) {
  const question = makeRepeatingGroupQuestion({
    key: KEY,
    label: "Skills & tools",
    options: [
      { value: "ClickUp", label: "ClickUp" },
      { value: "Notion", label: "Notion" },
    ],
    ...overrides,
  });
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <RepeatingGroupField
        question={question}
        value={value}
        onChange={(next) => setValue(next as typeof initial)}
        onBlur={vi.fn()}
        error={undefined}
      />
    );
  }
  render(<Harness />);
}

const byId = (id: string) => document.getElementById(id);
```

Then the behaviour:

```tsx
it("AC-FB-09 — focuses the first cell of the new row after adding", async () => {
  const user = userEvent.setup();
  renderControlled({ rows: [{ skill: "ClickUp" }] });
  await user.click(screen.getByRole("button", { name: /add another/i }));
  expect(document.activeElement).toBe(byId(cellFieldId(KEY, 1, "skill")));
});

it("AC-FB-09 — focuses the replacing row's remove button after removing", async () => {
  const user = userEvent.setup();
  renderControlled({ rows: [{ skill: "ClickUp" }, { skill: "Notion" }] });
  await user.click(screen.getByRole("button", { name: "Remove row 1" }));
  // Row 2 is now row 1; focus lands on the control that took the same place,
  // not on the row above and not on nothing.
  expect(document.activeElement).toBe(byId(cellRemoveId(KEY, 0)));
});

it("AC-FB-09 — focuses Add another when the last row is removed", async () => {
  const user = userEvent.setup();
  renderControlled({ rows: [{ skill: "ClickUp" }] });
  await user.click(screen.getByRole("button", { name: "Remove row 1" }));
  expect(document.activeElement).toBe(byId(addRowId(KEY)));
});

it("AC-FB-09 — never leaves focus on the body", async () => {
  const user = userEvent.setup();
  renderControlled({ rows: [{ skill: "ClickUp" }, { skill: "Notion" }] });
  await user.click(screen.getByRole("button", { name: /add another/i }));
  expect(document.activeElement).not.toBe(document.body);
  await user.click(screen.getByRole("button", { name: "Remove row 3" }));
  expect(document.activeElement).not.toBe(document.body);
  await user.click(screen.getByRole("button", { name: "Remove row 2" }));
  expect(document.activeElement).not.toBe(document.body);
});

it("announces an addition in a polite live region", async () => {
  const user = userEvent.setup();
  renderControlled({ rows: [] });
  await user.click(screen.getByRole("button", { name: /add another/i }));
  const status = screen.getByRole("status");
  expect(status).toHaveAttribute("aria-live", "polite");
  expect(status).toHaveTextContent(/row 1 added/i);
});

it("announces a removal and the remaining count", async () => {
  const user = userEvent.setup();
  renderControlled({ rows: [{ skill: "ClickUp" }, { skill: "Notion" }] });
  await user.click(screen.getByRole("button", { name: "Remove row 1" }));
  expect(screen.getByRole("status")).toHaveTextContent(/row 1 removed.*1 row remains/i);
});

it("announces rather than disables when maxRows is reached", async () => {
  const user = userEvent.setup();
  const capped = makeRepeatingGroupQuestion({ key: KEY });
  // One row allowed, one row present.
  capped.validation.repeatingGroup!.maxRows = 1;
  renderControlled({ rows: [{ skill: "ClickUp" }] }, { validation: capped.validation });

  const add = screen.getByRole("button", { name: /add another/i });
  // Enabled, because a disabled control the user has just tabbed to explains
  // nothing about why it will not work.
  expect(add).toBeEnabled();
  await user.click(add);
  expect(screen.getByRole("status")).toHaveTextContent(/maximum of 1 row/i);
  expect(screen.getAllByRole("group", { name: /^Row / })).toHaveLength(1);
});

it("is fully operable from the keyboard alone", async () => {
  const user = userEvent.setup();
  renderControlled({ rows: [{ skill: "ClickUp" }] });

  byId(cellFieldId(KEY, 0, "skill"))?.focus();
  await user.tab(); // proficiency
  await user.tab(); // notes
  await user.tab(); // remove row 1
  expect(document.activeElement).toBe(byId(cellRemoveId(KEY, 0)));
  await user.tab(); // add another
  expect(document.activeElement).toBe(byId(addRowId(KEY)));

  await user.keyboard("{Enter}");
  expect(screen.getAllByRole("group", { name: /^Row / })).toHaveLength(2);
  expect(document.activeElement).toBe(byId(cellFieldId(KEY, 1, "skill")));
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && pnpm vitest run tests/intake-form/repeating-group-field.test.tsx`

- [ ] **Step 3: Implement**

- **Add**: append `{}`, generate a new row id, then in a layout effect focus `document.getElementById(cellFieldId(question.key, newIndex, config.columns[0].key))`. Announce "Row N added."
- **Remove**: splice the row and its id, then focus the remove button of the row that took its place (`cellRemoveId(question.key, removedIndex)`), or the Add button when the removed row was the last. **Never let focus fall to `<body>`** — that is the classic failure of this widget and the reason the test exists.
- **Live region**: one `<p role="status" aria-live="polite" className="sr-only">` owned by the control. Its parent must be positioned — see the Global Constraints note on `sr-only`.
- **maxRows**: keep the Add button **enabled**. On activation at the cap, announce "Maximum of N rows reached." and append nothing. A disabled control the user has just tabbed to explains nothing.
- **Tab order is DOM order**: row cells → remove, row cells → remove, …, Add. **No arrow-key grid navigation** — `role="grid"` is a widget contract this control does not sign.
- `minRows` is 0 for all five seeded questions, so remove is never disabled; render no remove control when there are no rows.

- [ ] **Step 4: Run to verify pass, then commit**

```bash
cd apps/web && pnpm vitest run tests/intake-form/repeating-group-field.test.tsx && pnpm typecheck && pnpm lint
git add apps/web/src/features/intake-form/components/fields/repeating-group-field.tsx apps/web/tests/intake-form/repeating-group-field.test.tsx
git commit -m "feat(web): keyboard, focus and announcements for the repeating-group control"
```

---

# Task 7: Error plumbing — one shape, three sources

**Safe to run concurrently with:** T4, T5, T8–T11. **Run after T6.**

**Files:**
- Modify: `apps/web/src/features/intake-form/components/fields/types.ts`
- Modify: `apps/web/src/features/intake-form/error-map.ts`
- Modify: `apps/web/src/features/intake-form/schema-builder.ts` (`IntakeValidationResult`)
- Modify: `apps/web/src/features/intake-form/components/error-summary.tsx`
- Modify: `apps/web/src/features/intake-form/intake-form.tsx`
- Modify: `apps/web/src/features/form-builder/render/public-form-renderer.tsx`
- Modify: `apps/web/src/features/intake-form/components/fields/repeating-group-field.tsx`

**Interfaces:**
- Consumes: `RepeatingGroupFieldError` (Task 2), `toRowErrors` (Task 3), `cellFieldId` (Task 3).
- Produces: `FieldProps.rowErrors?: readonly RepeatingGroupFieldError[]`; `SummaryEntry.rowIndex?` / `.columnKey?`; `focusField(questionKey, cell?)`.

- [ ] **Step 1: Write the failing tests**

- `mapSubmissionError` extracts `details.fields[key].rows` into a new `rowErrors: Record<string, RepeatingGroupFieldError[]>`, **and** still puts `.message` into `fieldErrors[key]` exactly as it does today (pin the existing behaviour so the additive claim is proved, not asserted).
- `validateIntakeValues` returns `rowErrors` for a repeating group with two bad rows, and still returns one message per key in `errors`.
- `toRowErrors` (already unit-tested in Task 3) is wired: given RHF's nested error object, `/f/:slug` produces the same flat array.
- The error summary renders "Skills & tools — row 2, Proficiency: …" and its link targets `cellFieldId(...)`.
- `focusField("skills_and_tools", { rowIndex: 1, columnKey: "proficiency" })` focuses that input.

- [ ] **Step 2: Run to verify failure**

- [ ] **Step 3: Implement**

Every change here is **additive**: `rowErrors` is optional on `FieldProps`, `IntakeValidationResult.rowErrors` sits beside the existing `errors` map (so no existing caller changes), and `SummaryEntry` gains two optional fields. `focusField` keeps its one-argument behaviour and gains an optional second parameter; when absent it behaves exactly as today.

`error-map.ts` — read `rows` only when the per-key value is an object with a `rows` array. `messageFrom()` stays untouched.

- [ ] **Step 4: Run to verify pass, then commit**

```bash
cd apps/web && pnpm test && pnpm typecheck && pnpm lint
git add -A apps/web
git commit -m "feat(web): route repeating-group errors to their exact row and column"
```

---

# Task 8: Canvas growth — `shiftForGrowth` and the reference-equality gate

**Safe to run concurrently with:** T4–T7, T9–T11.

**Files:**
- Create: `apps/web/src/features/form-builder/layout-growth.ts`
- Create: `apps/web/tests/form-builder/layout-growth.test.ts`
- Modify: `apps/web/src/features/form-builder/render/public-form-renderer.tsx`

**Interfaces:**
- Consumes: `FormBlock`, `CanvasRect` from `@sdb/contracts`; `columnsOverlap` from `block-height.ts` (export it if it is currently module-private).
- Produces: `shiftForGrowth(blocks: readonly FormBlock[], extraRowsByBlockId: ReadonlyMap<string, number>): readonly FormBlock[]`

- [ ] **Step 1: Write the failing test — the gate first**

```ts
/**
 * Fill-time growth on the canvas.
 *
 * The whole point of this module is that it does NOTHING to a page without a
 * repeating group, so the first test is the one that proves it.
 */
import { describe, expect, it } from "vitest";
import type { CanvasRect, FormBlock } from "@sdb/contracts";
import { shiftForGrowth } from "@/features/form-builder/layout-growth";
import { MAX_ROW } from "@/features/form-builder/geometry";

let nextId = 0;

/** A minimal question block at an explicit rectangle. */
function blockAt(row: number, col: number, colSpan: number, rowSpan: number): FormBlock {
  nextId += 1;
  return {
    id: `block-${String(nextId)}`,
    blockType: "question",
    questionId: `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`,
    pageIndex: 0,
    sortOrder: nextId,
    layout: { desktop: { col, row, colSpan, rowSpan, z: 0 }, mobile: null },
    style: {},
    props: {},
    isRequiredOverride: null,
  } as FormBlock;
}

function rectOf(blocks: readonly FormBlock[], id: string): CanvasRect {
  const block = blocks.find((candidate) => candidate.id === id);
  if (block === undefined) throw new Error(`No block ${id}`);
  return block.layout.desktop;
}

describe("AC-FB-11 — a page with no repeating group is untouched", () => {
  it("returns the SAME ARRAY when nothing has grown", () => {
    const blocks = [blockAt(0, 0, 24, 8), blockAt(10, 0, 24, 8)];
    // toBe, NOT toEqual. Reference equality is the whole "nothing else
    // breaks" guarantee: a rebuilt array would pass toEqual and quietly
    // lose it.
    expect(shiftForGrowth(blocks, new Map())).toBe(blocks);
  });

  it("returns the SAME ARRAY when every recorded growth is zero", () => {
    const blocks = [blockAt(0, 0, 24, 8), blockAt(10, 0, 24, 8)];
    const first = blocks[0];
    if (first === undefined) throw new Error("fixture");
    expect(shiftForGrowth(blocks, new Map([[first.id, 0]]))).toBe(blocks);
  });
});

describe("shiftForGrowth", () => {
  it("pushes a block below a grown one down by exactly the delta", () => {
    const grown = blockAt(0, 0, 24, 8);
    const below = blockAt(10, 0, 24, 8);
    const result = shiftForGrowth([grown, below], new Map([[grown.id, 5]]));
    expect(rectOf(result, grown.id).rowSpan).toBe(13);
    expect(rectOf(result, below.id).row).toBe(15);
  });

  it("leaves a block in a disjoint column where it is", () => {
    const grown = blockAt(0, 0, 12, 8);      // left half
    const beside = blockAt(10, 12, 12, 8);   // right half, lower down
    const result = shiftForGrowth([grown, beside], new Map([[grown.id, 5]]));
    expect(rectOf(result, beside.id).row).toBe(10);
  });

  it("does not move a block ABOVE the grown one", () => {
    const above = blockAt(0, 0, 24, 8);
    const grown = blockAt(10, 0, 24, 8);
    const result = shiftForGrowth([above, grown], new Map([[grown.id, 5]]));
    expect(rectOf(result, above.id).row).toBe(0);
  });

  it("accumulates two growths that share a column", () => {
    const first = blockAt(0, 0, 24, 8);
    const second = blockAt(10, 0, 24, 8);
    const below = blockAt(20, 0, 24, 8);
    const result = shiftForGrowth(
      [first, second, below],
      new Map([[first.id, 3], [second.id, 4]]),
    );
    expect(rectOf(result, second.id).row).toBe(13);
    expect(rectOf(result, below.id).row).toBe(27);
  });

  it("does not touch a block on another page", () => {
    const grown = blockAt(0, 0, 24, 8);
    const otherPage = { ...blockAt(10, 0, 24, 8), pageIndex: 1 };
    const result = shiftForGrowth([grown, otherPage], new Map([[grown.id, 5]]));
    expect(rectOf(result, otherPage.id).row).toBe(10);
  });

  it("clamps to MAX_ROW rather than producing an invalid rect", () => {
    const grown = blockAt(0, 0, 24, 8);
    const below = blockAt(10, 0, 24, 8);
    const result = shiftForGrowth([grown, below], new Map([[grown.id, 100000]]));
    expect(rectOf(result, below.id).row).toBeLessThanOrEqual(MAX_ROW);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd apps/web && pnpm vitest run tests/form-builder/layout-growth.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```ts
/**
 * Grow repeating-group blocks at FILL time and push down only what collides.
 *
 * The canvas grid has FIXED 8px rows and explicit placement (form-canvas.css),
 * so a block that grows past its span renders ON TOP of the one below it.
 * Sizing every repeating group for maxRows in block-height.ts instead would
 * leave a ~900px hole on every form for a table someone fills with two rows.
 *
 * Deliberately NOT tidyBlocks(): that re-derives EVERY block's natural height
 * and would therefore move blocks on forms with nothing to do with this
 * feature. This function only ever adds the delta a repeating group actually
 * introduced.
 *
 * ── The reference-equality gate ────────────────────────────────────────────
 * With no growth, this returns its INPUT ARRAY. Not a copy. That is what makes
 * "a form with no repeating group is completely unaffected" a proof rather
 * than an argument, and it is what AC-FB-11 asserts with toBe. If you ever
 * rewrite this to map() unconditionally, the guarantee is gone and nothing
 * will fail to tell you.
 */
import type { CanvasRect, FormBlock } from "@sdb/contracts";
import { MAX_ROW } from "./geometry";

function columnsOverlap(a: CanvasRect, b: CanvasRect): boolean {
  return a.col < b.col + b.colSpan && b.col < a.col + a.colSpan;
}

/** A growth already applied, at the position it ended up in. */
interface Growth {
  rect: CanvasRect;
  extra: number;
}

export function shiftForGrowth(
  blocks: readonly FormBlock[],
  extraRowsByBlockId: ReadonlyMap<string, number>,
): readonly FormBlock[] {
  let anyGrowth = false;
  for (const extra of extraRowsByBlockId.values()) {
    if (extra > 0) {
      anyGrowth = true;
      break;
    }
  }
  if (!anyGrowth) return blocks;

  const shifted = new Map<string, CanvasRect>();
  const pages = [...new Set(blocks.map((block) => block.pageIndex))];

  for (const pageIndex of pages) {
    const onPage = blocks
      .filter((block) => block.pageIndex === pageIndex)
      .sort((a, b) => {
        const ar = a.layout.desktop;
        const br = b.layout.desktop;
        return ar.row - br.row || ar.col - br.col || a.id.localeCompare(b.id);
      });

    const growths: Growth[] = [];

    for (const block of onPage) {
      const rect = block.layout.desktop;

      // Push down by the sum of every growth ABOVE this block that shares a
      // column with it. A growth beside it never applies — which is what
      // "side by side" actually means on this grid.
      let push = 0;
      for (const growth of growths) {
        if (growth.rect.row < rect.row && columnsOverlap(growth.rect, rect)) {
          push += growth.extra;
        }
      }

      const extra = extraRowsByBlockId.get(block.id) ?? 0;
      const row = Math.min(MAX_ROW, rect.row + push);
      const rowSpan = rect.rowSpan + extra;

      // Record this block's own growth at its SHIFTED position, so a second
      // growth further down the page accumulates correctly.
      if (extra > 0) growths.push({ rect: { ...rect, row }, extra });

      if (row !== rect.row || rowSpan !== rect.rowSpan) {
        shifted.set(block.id, { ...rect, row, rowSpan });
      }
    }
  }

  if (shifted.size === 0) return blocks;
  return blocks.map((block) => {
    const rect = shifted.get(block.id);
    // A block that did not move keeps its identity too. Smaller than the array
    // win, but it keeps React from re-rendering untouched nodes.
    return rect === undefined
      ? block
      : { ...block, layout: { ...block.layout, desktop: rect } };
  });
}
```

- [ ] **Step 4: Wire into `public-form-renderer.tsx`**

Compute `extraRowsByBlockId` from the current form values: for each block whose question is a repeating group, `extra = max(0, ceil((rowsNow − max(minRows,1)) × RG_ROW_PITCH_PX / 8))`. Export the per-row pitch from `block-height.ts` so the two cannot drift. Pass `shiftForGrowth(payload.blocks, extras)` to `CanvasRenderer`.

On a page with no repeating group, `extras` is empty and the identity of `payload.blocks` is preserved end to end, so React sees no new array.

- [ ] **Step 5: Run to verify pass, then commit**

```bash
cd apps/web && pnpm test && pnpm typecheck && pnpm lint
git add apps/web/src/features/form-builder/layout-growth.ts apps/web/tests/form-builder/layout-growth.test.ts apps/web/src/features/form-builder/render/public-form-renderer.tsx apps/web/src/features/form-builder/block-height.ts
git commit -m "feat(web): grow repeating-group blocks at fill time without moving anything else"
```

---

# Task 9: Rendering a stored answer

**Safe to run concurrently with:** T4–T8, T10, T11.

**Files:**
- Modify: `apps/web/src/lib/answer-value.ts`
- Create: `apps/web/src/components/patterns/answer-table.tsx`
- Create: `apps/web/tests/p3/answer-table.test.tsx`
- Modify: `apps/web/src/features/candidates/components/form-submissions-card.tsx`
- Modify: `apps/web/src/features/requisitions/components/answers-card.tsx`

**Interfaces:**
- Consumes: `RepeatingGroupSnapshotSchema`, `RepeatingGroupValueSchema`.
- Produces:
  - `readRepeatingGroup(answer: SnapshotAnswer): { columns: RepeatingGroupColumn[]; rows: RepeatingGroupRow[] } | null`
  - `AnswerTable({ answer }: { answer: SnapshotAnswer })`

- [ ] **Step 1: Write the failing tests**

- `renderAnswerValue` on a repeating-group answer returns `"6 rows"` (singular `"1 row"`), **not** `"[object Object]"`. This keeps `supersededKeys()` — which compares rendered strings — working with no change.
- `readRepeatingGroup` returns `null` when the snapshot has no `repeatingGroup` key. **Every answer stored before this feature has no such key, which is why no existing row can take the new path.**
- `AnswerTable` renders the **snapshot's** column headings and option labels, not the live question's (AC-FB-08). Test it by passing a snapshot whose column label and option label differ from anything else in the fixture.
- A cell whose value is not in the snapshot's option list renders the raw value rather than blank — an answer must never disappear because an option was renamed.
- Every existing test in `apps/web/tests/p2/answers-snapshot.test.tsx` still passes.

- [ ] **Step 2: Run to verify failure**

- [ ] **Step 3: Implement**

`renderAnswerValue` gains its branch **before** the `Array.isArray` branch, keyed on the value shape (`typeof json === "object" && Array.isArray(json.rows)`), so it cannot be reached by any other type.

`AnswerTable` is a real `<table>` here — this is **read-only display**, not a set of form controls, so `<th scope="col">` is exactly right and the forms-mode problem from §8.1 of the spec does not apply.

Both cards dispatch on `snapshotString(answer.questionSnapshot, "questionType") === "repeating_group"`, rendering `<AnswerTable/>` inside the existing `<dd>` instead of the string. **Read the snapshot, never the live question** (03 §1.4).

- [ ] **Step 4: Run to verify pass, then commit**

```bash
cd apps/web && pnpm test && pnpm typecheck && pnpm lint
git add -A apps/web
git commit -m "feat(web): render stored repeating-group answers from their snapshot"
```

---

# Task 10: Question manager — a read-only column summary

**Safe to run concurrently with:** T4–T9, T11.

**Files:**
- Modify: `apps/web/src/features/question-manager/components/validation-rules-editor.tsx`
- Modify: the matching test file under `apps/web/tests/question-manager/`

**Interfaces:**
- Consumes: `RepeatingGroupConfig`.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

```tsx
it("shows a repeating group's columns and does not offer to edit them", () => {
  render(<ValidationRulesEditor questionType="repeating_group" value={{ repeatingGroup: skillsConfig }} onChange={vi.fn()} />);
  expect(screen.getByText(/3 columns/i)).toBeInTheDocument();
  expect(screen.getByText(/Skill/)).toBeInTheDocument();
  expect(screen.getByText(/Proficiency/)).toBeInTheDocument();
  expect(screen.getByText(/Notes/)).toBeInTheDocument();
  // Option A: columns are ours, choices are hers.
  expect(screen.queryByRole("button", { name: /add column/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("textbox", { name: /column label/i })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Run to verify failure**

- [ ] **Step 3: Implement**

Render a read-only summary: the column count, then each column's label, type and required flag, plus one line of explanatory copy — *"Columns are set by Staffing Done Better. You can still edit this question's wording and its choice list."* No inputs, no buttons, no `onChange` calls. That sentence is the UI expression of Option A and stops an admin hunting for an editor that does not exist.

- [ ] **Step 4: Run to verify pass, then commit**

```bash
cd apps/web && pnpm test && pnpm typecheck && pnpm lint
git add -A apps/web/src/features/question-manager apps/web/tests/question-manager
git commit -m "feat(web): show a repeating group's columns read-only in the question editor"
```

---

# Task 11: Seed — five questions, the option copy, and three template blocks

**Safe to run concurrently with:** T4–T10. **Requires Task 1 applied to the target database.**

**Files:**
- Create: `supabase/seed/repeating_group_questions_seed.sql`

**Interfaces:**
- Consumes: the `'repeating_group'` enum member (Task 1) and the shapes from Task 2.
- Produces: five library questions plus three blocks on the default form.

- [ ] **Step 1: Read the live default form before writing anything**

**Do not guess this.** Query the target database:

```sql
select id, key, label, is_default, status, published_version_id from candidate_forms where is_default;
select id, form_id, version_number, published_at, jsonb_array_length(pages) from candidate_form_versions
 where form_id = (select id from candidate_forms where is_default);
select page_index, max(sort_order), max((layout->'desktop'->>'row')::int)
  from candidate_form_blocks where form_version_id = <the version> group by page_index;
```

`0021_candidate_form_seed_template.sql` wrote blocks straight onto version 1 with `published_at = now()`. Confirm that is still the shape before deciding whether to append to the existing version or create a new one. Write down what you found in the seed file's header.

- [ ] **Step 2: Write the seed header**

Follow `candidate_questions_seed.sql` exactly: a header explaining that this is **reference data, not a migration** (Rebecca owns the content and edits it in the UI), fixed UUIDs, `on conflict do nothing` throughout, and a fresh UUID block clear of every one already in use — dev_seed `0000000009xx`, candidate questions `00000000005xx`, countries `000000900001`–`000000900251`, question options `0000095xxxxx`/`0000096xxxxx`/`0000097xxxxx`, tools `000000910001+`, skills `000000920001+`.

- [ ] **Step 3: Insert the five questions**

All five are `audience = 'candidate'`, `is_required = false`, `is_active = true`. `validation` carries the `repeatingGroup` config. Columns:

| Key | Category | Columns (`key` · label · type · required · widthWeight) |
|---|---|---|
| `skills_and_tools` | `candidate_experience` | `skill` · Skill · single_select(question_options) · **required** · 2 — `proficiency` · Proficiency · single_select(inline: aware/working/proficient/expert) · **required** · 1 — `notes` · Notes · short_text · optional · 3, `maxLength: 500` |
| `employment_history` | `candidate_experience` | `employer` · Employer · short_text · **required** · 2 — `job_title` · Job title · short_text · **required** · 2 — `from_month` · From · month · **required** · 1 — `to_month` · To · month · optional · 1 — `summary` · What you did · long_text · optional · 3 |
| `education_history` | `candidate_experience` | `school` · School · short_text · **required** · 3 — `qualification` · Qualification · short_text · optional · 3 — `year` · Year · number · optional · 1, `min: 1950`, `max: 2100` |
| `certifications` | `candidate_experience` | `name` · Certification · short_text · **required** · 3 — `issuer` · Issued by · short_text · optional · 3 — `year` · Year · number · optional · 1, `min: 1950`, `max: 2100` |
| `other_languages` | `candidate_language` | `language` · Language · single_select(question_options) · **required** · 2 — `spoken_level` · Spoken · single_select(inline: basic/conversational/professional/native_equivalent) · **required** · 1 — `written_level` · Written · single_select(inline, same four) · **required** · 1 |

All five: `minRows: 0`, `maxRows: 20`, `addRowLabel: 'Add another'`.

`other_languages` label and help text must say **other** languages plainly — for example label *"Other languages you speak"*, help text *"English is covered by the two questions above — list any other languages here."* The two existing English questions (`english_spoken_level`, `english_written_level`) are in `CANDIDATE_MAPPED_QUESTION_KEYS` and project onto `candidates` columns; **do not touch them, and do not let a candidate enter English twice.**

**Level values are mirrored, never invented.** `other_languages`'s two level columns use
`LanguageLevelSchema` from `packages/contracts/src/enums.ts` **exactly** — `basic`,
`conversational`, `professional`, `native_equivalent` — the same way the skills table mirrors
`proficiency_level`. Inventing a parallel set of level values is how two vocabularies for one idea
get into a database. Read the enum before you type the options; do not work from this table.

**No `is_native` column.** `candidate_languages` carries `is_native boolean`, and it is a genuinely
different fact from fluency — someone can be `native_equivalent` in a second language without it
being their first. It is still not worth a column today: `native_equivalent` reads correctly to a
candidate as the top of the scale, we are **not** projecting these answers onto `candidate_languages`
(so an `is_native` cell would be a fact nothing reads), and it would mean widening
`RepeatingGroupColumnTypeSchema` with a `yes_no` type for one use. If it later earns its place it is
one column plus one column type — an increment, not a rewrite.

- [ ] **Step 4: Copy the catalogue into `question_options`**

For `skills_and_tools` only:

```sql
-- ONE-TIME COPY, not a view and not a sync.
--
-- The form's skill list and the tools/skills taxonomy DIVERGE from here:
-- renaming a skill in these options does not change the `tools` table, and
-- adding a row to `tools` does not appear on the form. That is deliberate.
-- There is no admin taxonomy screen — /admin/settings is a sidebar link only,
-- and routes/taxonomy.ts exposes GET and POST for tools and skills and nothing
-- else, so Rebecca cannot rename or retire a catalogue row through the API.
-- She CAN do all three through the question options editor, which is the
-- whole reason the copy lands here. DO NOT BUILD A SYNC.
insert into question_options (id, question_id, value, label, sort_order)
select …, '<skills_and_tools uuid>', name, name, row_number() over (order by name)
from (
  -- distinct on (name): `tools` and `skills` are unique within themselves but
  -- not across each other, and question_options has unique (question_id, value).
  select distinct on (name) name from (
    select name from tools  where is_active
    union all
    select name from skills where is_active
  ) both_tables order by name
) catalogue
on conflict do nothing;
```

Do the same for `other_languages` with a short starter language list (Spanish, Portuguese, French, …) — **not** English.

- [ ] **Step 5: Add THREE blocks to the default template**

**`skills_and_tools`, `employment_history` and `other_languages`.** Education and certifications stay
in the library, one drag away. All five tables at once would make `/register` — a public form with a
completion rate — noticeably longer for no evidence.

Follow `0021`'s block shape: full width (`col: 0, colSpan: 24`), `row` below the last existing block
on its page with the usual gap, `rowSpan` from the height formula in `block-height.ts` for
`max(minRows, 1) = 1` row.

Pages:

| Block | Page (category) | Position on the page |
|---|---|---|
| `skills_and_tools` | `candidate_experience` — "Your experience" | after the last existing block |
| `employment_history` | `candidate_experience` — "Your experience" | after `skills_and_tools` |
| `other_languages` | **`candidate_language` — "Language"** | **directly beneath `english_written_level`** |

**The Languages block's POSITION is the requirement, not a layout preference — it is what delivers
T6.** Rebecca's words at 15:49 were *"You have Languages twice"*, and T6's fix in
`docs/CHANGE-REQUESTS-2026-08-13.md` is "merge them into ONE section: scalar fields first, then the
languages list below." Putting the table under the two English questions in the **same existing
category** is that merge, delivered on the form instead of on the recruiter's page. **Do not move it
to a new step for tidiness** — that would silently undo the change request.

**Scope every write to the single row where `is_default`.** No other form may gain a block.

- [ ] **Step 6: Apply the seed and verify by hand**

Apply it, then start the API (`cd apps/api && set -a && . ./.env && set +a && pnpm dev`) and the web
app, open `/register`, and confirm:

- **Your experience** shows the skills table with a searchable skill picker and a four-option
  proficiency select, then the employment-history table beneath it;
- **Language** shows Spoken English and Written English as they are today, and the "Other languages
  you speak" table **below them, in the same step** — one Languages section, not two (T6);
- adding and removing rows works in all three, from the keyboard alone;
- a submission stores `value_json` with the rows and a `question_snapshot.repeatingGroup` carrying
  only the picked options;
- the two English answers still project onto `candidates.english_spoken_level` /
  `english_written_level` exactly as before.

**Verify against the running server and say that is what you did** — the integration suite needs
Docker, which is not available here.

- [ ] **Step 7: Commit**

```bash
git add supabase/seed/repeating_group_questions_seed.sql
git commit -m "feat(seed): five repeating-group questions and three blocks on the default template"
```

---

# Task 12: Verification against the baseline

**Run alone, last.**

**Files:** none.

- [ ] **Step 1: Full gate**

```bash
pnpm --filter @sdb/contracts build
pnpm -r typecheck
pnpm -r lint
pnpm -r test
```
Every one must be green. Paste the actual output; do not summarise it.

- [ ] **Step 2: Compare against the captured baseline**

Confirm the web suite count is the baseline count **plus** the tests this plan added, and that no pre-existing test changed its result. A test that started passing for a reason nobody expected is as much a finding as one that started failing.

- [ ] **Step 3: Prove the "nothing happens" claim on a real form**

With the app running, open a form that contains **no** repeating group — the client intake form at `/intake` and any pre-existing `/f/:slug` — and confirm the rendering is unchanged. The reference-equality test (AC-FB-11) proves the layout path; this proves the whole path.

- [ ] **Step 4: Report what could not run**

State explicitly: `apps/api` integration tests (`pnpm test:integration`) were **not** run because Docker is not installed on this machine, and name the AC ids that depend on them — AC-FB-01 through AC-FB-08. Say what was verified against the running server instead. Do not claim a suite passed that you did not run.

- [ ] **Step 5: List the acceptance criteria satisfied**

In the final report, name every AC id this work satisfies — AC-FB-01…14 as **proposed** in the spec (they are not yet in `07-ACCEPTANCE-CRITERIA.md`; proposing them is Haider's call, and this plan does **not** amend the locked document), plus the existing AC-IF-11, AC-IF-12, AC-IF-18, AC-Q-11, AC-UI-01, AC-UI-02, AC-UI-03 and AC-UI-04.

---

## Notes for the reviewer

- **AC-IF-07** in the locked document says "Parameterised test, all 12 types". It is now 13. Flag it in the PR description; **do not edit `07-ACCEPTANCE-CRITERIA.md`.**
- **The one line most likely to cause a silent data loss** is `VALIDATION_KEYS_BY_TYPE.repeating_group` in `apps/web/src/features/question-manager/guard-rails.ts`. `repeating_group: []` compiles and passes typecheck, and makes every save from the question editor delete the column definitions. Check it by eye, then check AC-FB-14 exists and fails when the array is emptied.
- **The one assertion that carries the whole additive claim** is `expect(shiftForGrowth(blocks, new Map())).toBe(blocks)`. If it is written with `toEqual`, the guarantee is gone and nobody will notice.
