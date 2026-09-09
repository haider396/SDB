# Design — the `repeating_group` question type

**Date:** 9 September 2026
**Status:** approved design, not yet planned or built
**Baseline:** PRD v1.1 FINAL + migrations 0001–0027, seeds through `skills_tools_taxonomy_seed.sql`
**Classification:** architectural
**Decided by:** Haider (concept + Option A + the five open questions answered 9 Sep)

---

## 1. What this is

A question whose answer is a **list of rows**, each row having a few defined columns, with an
"Add another" button. One feature replaces five separate needs:

| Question (library key) | Columns |
|---|---|
| `skills_and_tools` | skill (choice) · proficiency (choice) · notes (text) |
| `employment_history` | employer · job title · from · to · what they did |
| `education_history` | school · qualification · year |
| `certifications` | name · issuer · year |
| `other_languages` | language (choice) · spoken level (choice) · written level (choice) |

The skills row is the table Rebecca asked for on the 13 Aug call — *"that's under one column, the
next column would be Proficiency… and then let's add a third for just notes"* (T7, 19:20).

**References was cut.** It would have a candidate type a third party's name and phone number into a
public, unauthenticated form, and we would store personal data about someone who has consented to
nothing. That is the same family of problem as D5 (disqualifier legality) and needs Rebecca's answer,
not ours. Nobody should add it back without asking her.

### The decision already made — Option A

**We define the columns; Rebecca edits the choices.** The column definitions for the five uses are
seeded by us. Rebecca still edits the skill list, the option labels and the question wording exactly
as she does today. She cannot add a column on day one. The engine reads column definitions **from
data**, so an admin column editor is a later increment rather than a rewrite. §11 states can/cannot
in full.

---

## 2. The invariant check

| Invariant (`CLAUDE.md`) | Verdict |
|---|---|
| 1. Pipeline stage on `assignments` | **Untouched.** No assignment, stage or state-machine code is involved. |
| 2. `presented` is the client-visibility gate | **Untouched.** `apps/api/src/repositories/client-visible.repo.ts` contains the string `answer` zero times. Repeating-group answers land in `candidate_answers` / `requisition_answers`; no client-scoped read touches either. No new endpoint of any kind. |
| 3. PII gated in the view, not React | **No change to the gate.** The one design that would have added third-party PII on a public form — References — was cut for exactly that reason. |
| 4. `events` row per transition | **Untouched.** All three submission paths already emit their events; there is no new transition. Question create/update already writes `entity_type = 'question'` (AC-Q-12). |
| 5. Browser never talks to Postgres | **Untouched.** No new route, no new client. |

---

## 3. The contract first

Every wire shape is a Zod schema in `packages/contracts`. **Consumers need
`pnpm --filter @sdb/contracts build` before `apps/api` or `apps/web` can see the new exports** —
forgetting this produces the confusing "has no exported member".

### 3.1 New file — `packages/contracts/src/repeating-group.ts`

| Schema | Shape |
|---|---|
| `RepeatingGroupColumnTypeSchema` | `'short_text' \| 'long_text' \| 'number' \| 'single_select' \| 'month'` |
| `RepeatingGroupChoicesSchema` | discriminated union on `from`: `{ from: 'question_options' }` \| `{ from: 'inline', options: IntakeFormOption[] }` |
| `RepeatingGroupColumnSchema` | `key` (snake_case slug) · `label` · `columnType` · `isRequired` · optional `helpText` / `placeholder` / `maxLength` / `min` / `max` / `widthWeight` (1–6) · `choices` (required when `columnType === 'single_select'`, forbidden otherwise) |
| `RepeatingGroupConfigSchema` | `{ columns: RepeatingGroupColumn[] (1–8, keys unique), minRows: int ≥ 0, maxRows: int 1–50, addRowLabel: string }` |
| `RepeatingGroupValueSchema` | `{ rows: Array<Record<string, string \| number>> }` |
| `RepeatingGroupFieldErrorSchema` | `{ rowIndex: int, columnKey: string, message: string }` |
| `RepeatingGroupSnapshotSchema` | the `question_snapshot.repeatingGroup` shape — see §7.2 |

**`RepeatingGroupColumnTypeSchema` is deliberately a separate, smaller enum from `QuestionType`.**
Reusing `QuestionType` would drag `currency_range`, `file_upload`, `scale` and — fatally —
`repeating_group` itself into a column's domain. **Nesting is impossible by construction, not by a
rule someone has to remember.**

`valueJson` is an **object** `{ rows: [...] }`, never a bare array. A bare array would be caught by
the existing `Array.isArray` branch in `apps/web/src/lib/answer-value.ts` and rendered as
`[object Object], [object Object]` by any consumer we forget to teach. The object form is
unambiguous and matches the `{ fileIds: [...] }` precedent already used by `file_upload`.

**An empty cell is omitted from its row object**, never sent as `""` or `null`. A row is therefore
"wholly empty" when it has no keys after normalisation, which is what makes the drop rule in §7.1
step 2 a one-line check rather than a per-type emptiness test.

How each column type renders and what it stores:

| `columnType` | Control | Stored as |
|---|---|---|
| `short_text` | `<Input>` | `string` |
| `long_text` | `<Textarea rows={2}>` | `string` |
| `number` | `<Input type="number">` | `number` |
| `month` | `<Input type="month">` | `string`, `YYYY-MM` — **not** a `date`. "March 2024" is what someone remembers about a job, and a fabricated day-of-month is a lie the data would carry forever |
| `single_select` | `<NativeSelect>` at or below `SEARCHABLE_SELECT_MIN_OPTIONS`, `SearchableSelect` above it — the same threshold and the same two controls the `single_select` question type already uses | `string` (the option `value`) |

### 3.2 Changed — `packages/contracts/src/enums.ts`

`QuestionTypeSchema` gains `'repeating_group'`.

**This is the change that does the work.** It turns four compile-time guards into errors until each
is taught. That is the mechanism, not a side effect:

| Guard | File |
|---|---|
| `HANDLED_QUESTION_TYPES satisfies Record<QuestionType, true>` + `never` switch | `apps/web/src/features/intake-form/components/question-field.tsx` |
| `never` switch in `baseSchemaFor` | `apps/web/src/features/intake-form/schema-builder.ts` |
| `never` switch in `toAnswer` | `apps/web/src/features/intake-form/submission.ts` |
| `EXPECTED_FIELD: Record<QuestionType, ValueField>` | `apps/api/src/services/intake-submission.service.ts:68` |
| `VALIDATION_KEYS_BY_TYPE: Record<QuestionType, readonly ValidationRuleKey[]>` | `apps/web/src/features/question-manager/guard-rails.ts:59` |
| `QUESTION_TYPE_LABELS: Record<QuestionType, string>` | `apps/web/src/features/question-manager/guard-rails.ts:118` |
| type-level test, both directions | `apps/web/tests/intake-form/exhaustiveness.test.ts` (AC-IF-18) |

### 3.3 Changed — `packages/contracts/src/validation-rules.ts`

`ValidationRulesSchema` gains `repeatingGroup: RepeatingGroupConfigSchema.optional()`. The schema
stays `.strict()` (AC-Q-11 depends on that). Every key is optional with no default, so parsing an
existing stored `validation` value produces a **byte-identical** object.

### 3.4 Unchanged, and this is load-bearing

`IntakeFormQuestionSchema` **does not change**. It already carries `validation`, and all three form
read services already do `ValidationRulesSchema.parse(record.validation)`:

- `apps/api/src/services/intake-form.service.ts:63`
- `apps/api/src/services/candidate-registration-form.service.ts:57`
- `apps/api/src/services/candidate-form-public.service.ts:107`

Column definitions therefore reach all three renderers with **zero change to any wire shape and zero
change to any read service**. `IntakeAnswerSchema.valueJson` is already `JsonValueSchema` and accepts
the value as-is.

### 3.5 Why `questions.validation` and not a new table

Decided in favour of `validation` for one reason above all others: **`buildSnapshot()` in
`apps/api/src/services/intake-submission.service.ts` already copies `question.validation` into
`question_snapshot`.** Column definitions land in the snapshot for free, which is the hardest
requirement in the brief.

A `question_columns` table would need snapshot changes in the shared builder, repository joins in
three read services, and new admin CRUD — a far larger blast radius against a "nothing may break"
constraint, in exchange for referential integrity on a value `03-INTAKE-FORM-ENGINE.md` §1.3 says we
will never filter on. §1.3 blesses `validation` explicitly as *"an open-ended rule bag whose keys
vary by question type… Never filtered on"*, and §1.5's rule for editing `validation` — *"yes, with
warning; existing answers are not re-validated"* — is exactly the semantics columns need.

### 3.6 Where a choice column's options come from

A choice column reads either the question's **own `question_options`** or an **inline list** in the
column definition.

- `skills_and_tools`: `skill` → `question_options`; `proficiency` → inline
  (`aware` / `working` / `proficient` / `expert`, mirroring the existing `proficiency_level` enum);
  `notes` → text.
- `other_languages`: `language` → `question_options`; both level columns → inline.

This means **Rebecca edits the skill list through the options editor she uses today, with no new UI
at all** — add an option, rename a label, deactivate one. It also means the picker has **no loading
state**: options ride along in the form payload. That is why the catalogue is not a separate
endpoint.

`question_options` carries `unique (question_id, value)` and **no group column**, so two *different*
catalogues in one question are not expressible. None of the five uses needs that. Building the
`option_group` column is explicitly out of scope (§13).

---

## 4. The skills catalogue — a one-time copy, and it then diverges

`supabase/seed/skills_tools_taxonomy_seed.sql` is applied. Verified against the file: **102 `tools`
rows, 98 `skills` rows, 14 categories** including `tech_stack` and `leadership`. Its own header
already anticipates this use — *"NAMES ARE CANDIDATE-FACING. These become the choices on the public
registration form."*

The `skills_and_tools` question's options are seeded as a **one-time copy** out of `tools` and
`skills` into `question_options`. Not a view, not a sync, not a foreign key.

**State plainly, because someone will be surprised by it later: the two lists then diverge.**
Editing a skill's label in the question options does **not** change the `tools`/`skills` tables, and
adding a row to `tools` does **not** appear on the form. **Do not build a sync.**

That is the right trade today for a concrete reason: there is **no admin taxonomy screen at all**.
`/admin/settings` exists only as a sidebar link in
`apps/web/src/components/layout/admin-layout.tsx:40`, and `apps/api/src/routes/taxonomy.ts` exposes
only `GET /tools`, `POST /tools`, `GET /skills`, `POST /skills` — **create-only, with no update,
deactivate or delete**. Rebecca cannot rename or retire a skill through the taxonomy API. She *can*
do all three through the question options editor. Copying into `question_options` is the only option
that gives her the editing she was promised without building a new screen.

Two mechanical notes for the seed:

- De-duplicate across the two tables (`distinct on (name)`) — `unique (question_id, value)` will
  otherwise raise if a name exists in both `tools` and `skills`.
- Option `value` and `label` are both the catalogue `name`. The names are already written
  candidate-facing ("ClickUp", "Monday.com"), and a stable human-readable value is what makes an
  answer readable in the snapshot years later.

**Consequence to record: the skill picker is a flat, type-to-filter list of ~200 names on day one,
not grouped under Tech Stack / Leadership headings.** `question_options` has no category column.
Rebecca's "organized by section" (18:01) was about the *candidate profile* table (T7), which is a
different surface and is not in scope here (§13). The control reuses
`apps/web/src/features/intake-form/components/fields/searchable-select.tsx`, which already exists
for exactly this length of list (the 251-country dropdown) — a form should not teach two different
pickers.

---

## 5. The layers

`routes → services → repositories → lib`, ESLint-enforced.

### 5.1 `apps/api/src/routes/` — no change

**No new endpoint.** This is the strongest single piece of evidence that the change is additive.

### 5.2 `apps/api/src/services/`

**New — `services/repeating-group.ts`.** Pure: no SQL, no I/O, no Fastify. It normalises rows and
returns `RepeatingGroupFieldError[]`. Unit-testable with plain Vitest, which matters because Docker
is not available on this machine and the integration suite cannot run here.

**Changed — `services/intake-submission.service.ts`.** This is the one choke point every submission
path already shares: `candidate-form-submission.service.ts:150` and
`candidate-registration.service.ts:421` both call `validateSubmission`, and both call
`buildSnapshot`. Five small edits:

1. `EXPECTED_FIELD` gains `repeating_group: 'valueJson'` — compile-forced.
2. `jsonShapeOk()` gains a `repeating_group` arm delegating to `RepeatingGroupValueSchema`.
3. `isBlank()` (line 92) learns that `{ rows: [] }` is blank.
4. `checkValidationRules()` delegates repeating groups to the new module.
5. `buildSnapshot()` gains the repeating-group snapshot rule (§7.2).

**Changed — `services/questions.service.ts`.** One addition: a `repeating_group` question with no
`validation.repeatingGroup.columns` is rejected. `validation` is already run through
`ValidationRulesSchema.safeParse` at line 170, so unknown keys already produce
`422 INVALID_VALIDATION_RULE` — reuse that code rather than invent one.

**Unchanged:** `candidate-form-submission.service.ts`, `candidate-registration.service.ts`,
`intake-form.service.ts`, `candidate-registration-form.service.ts`,
`candidate-form-public.service.ts`.

### 5.3 `apps/api/src/repositories/` — no change

No new table, no new column, no new join. Option membership is checked against `question.options`,
which the scope record already loads active-only.

### 5.4 `apps/api/src/lib/` — no change

### 5.5 `apps/web/src/`

| File | Change | Forced by the compiler? |
|---|---|---|
| `features/intake-form/components/fields/repeating-group-field.tsx` | **new** — the control | — |
| `features/intake-form/components/question-field.tsx` | one case + map entry | **yes** |
| `features/intake-form/schema-builder.ts` | one arm in `baseSchemaFor` | **yes** |
| `features/intake-form/submission.ts` | one arm in `toAnswer` | **yes** |
| `features/intake-form/conditional.ts` | `isBlank` learns `{ rows: [] }` | no — pinned by a named test |
| `features/intake-form/components/fields/field-shell.tsx` | add `cellFieldId()` | no |
| `features/intake-form/components/error-summary.tsx` | optional `rowIndex`/`columnKey` on `SummaryEntry`; `focusField` accepts a cell id | no |
| `features/intake-form/error-map.ts` | read `details.fields[key].rows` | no |
| `features/question-manager/guard-rails.ts` | two map entries | **yes** |
| `features/question-manager/components/validation-rules-editor.tsx` | read-only column summary | no |
| `lib/answer-value.ts` | text fallback + `readRepeatingGroup()` | no |
| `components/patterns/answer-table.tsx` | **new** — shared row table | — |
| `features/candidates/components/form-submissions-card.tsx` | use it | no |
| `features/requisitions/components/answers-card.tsx` | use it | no |
| `features/form-builder/block-height.ts` | height formula + `never` guard | partly — see §6.2 |
| `features/form-builder/layout-growth.ts` | **new** — `shiftForGrowth()` | — |
| `features/form-builder/render/public-form-renderer.tsx` | apply it | no |

`isBlank` is duplicated — `apps/web/src/features/intake-form/conditional.ts` and
`apps/api/src/services/intake-submission.service.ts:92`. Both need the new branch. Left duplicated;
merging them is a separate refactor and not this change's business.

---

## 6. Variable height — the one genuinely hard constraint

### 6.1 The problem, stated exactly

Verified in `apps/web/src/styles/form-canvas.css`: above a `34rem` container, `.sdb-canvas` uses
`grid-auto-rows: 8px` and every node is placed at an explicit `grid-row: var(--node-row) / span
var(--node-rows)`. A block taller than its span **overlaps** the one below rather than pushing it —
`block-height.ts` says so in its own header, from experience. Below `34rem` the canvas is
single-column flow with `min-content` rows, and `/register` (`registration-form.tsx`) and the client
intake form (`intake-form.tsx`) are plain `space-y-5` stacks.

**So the problem exists on exactly two surfaces: the builder canvas and `/f/:slug` on a wide
container.** Everywhere else, variable height is already free.

### 6.2 The decision — size for the base state, shift at fill time

`block-height.ts` sizes a repeating-group block for `max(minRows, 1)` rows. At fill time a new pure
function shifts what has to move:

```
shiftForGrowth(blocks, extraRowsByBlockId) → readonly FormBlock[]
```

It pushes down only blocks that both **share a column** with a grown repeating group and sit below
it, by exactly the delta. It reuses the `columnsOverlap` helper and the collision reasoning already
argued out in `tidyBlocks`. It deliberately does **not** reuse `tidyBlocks` itself, which re-derives
*every* block's natural height and would therefore move blocks on forms that have nothing to do with
this feature.

### 6.3 The reference-equality gate — the whole "nothing else breaks" guarantee, in one line

**When no block on the page is a repeating group, `shiftForGrowth` returns its input array by
reference.** Not a copy, not a deep-equal clone. The same array.

```ts
expect(shiftForGrowth(blocks, extras)).toBe(blocks);   // toBe, not toEqual
```

That single assertion is what makes "every form that contains no repeating group is completely
unaffected" a **proof rather than an argument**. It is AC-FB-11. It must be written with `toBe`; a
`toEqual` would pass on a rebuilt array and quietly lose the guarantee.

The same discipline applies at the call site: `public-form-renderer.tsx` computes the grown block
list once per render and passes it to `CanvasRenderer`. On a page with no repeating group the
identity of `payload.blocks` is preserved end to end, so React sees no new array and the render
output is identical.

### 6.4 A trap in `block-height.ts` — closed on 9 Sep, before this spec was planned

`controlPx()` **used to** end in a `default:` arm returning `CONTROL_PX` (36 px) for `short_text` /
`email` / `phone` / `number` / `date`. A repeating group would have silently got 36 px and
overlapped immediately, **with no compile error**.

That has been fixed independently: those five types are now spelled out, the switch ends in a
`const unhandled: never = question.questionType` guard, and an unreachable `UNKNOWN_CONTROL_PX =
120` is the runtime fallback. All 33 tests in `apps/web/tests/form-builder/block-height.test.ts` are
green.

**So `block-height.ts` has already joined the compile-forced set.** Adding `'repeating_group'` to
`QuestionTypeSchema` now makes this file fail to compile until the type is given a real height. The
work here is "give the new type its height", not "fix the default arm".

Height formula, pure and mirroring the component:

```
labelLines × LABEL_PX
  + help
  + STACK_GAP_PX
  + HEADER_ROW_PX
  + rows × ROW_PX + (rows − 1) × ROW_GAP_PX        where rows = max(minRows, 1)
  + STACK_GAP_PX + ADD_BUTTON_PX
  + BREATHING_PX
```

---

## 7. Validation, snapshots, and how an error finds its cell

### 7.1 Server-side order

In `services/repeating-group.ts`, all failures collected, none short-circuiting:

1. Parse with `RepeatingGroupValueSchema`; failure → `422 VALUE_TYPE_MISMATCH` (via `jsonShapeOk`).
2. Drop **wholly empty rows** — an added-then-abandoned row is not an error.
3. Strip unknown column keys — forward-compatible with a column retired between page load and
   submit; mirrors how a deactivated question's answer is simply not stored.
4. `rows.length < minRows` / `> maxRows` → group-level message.
5. Per row, per column: required · type coercion · `maxLength` / `min` / `max` · option membership.

`validateSubmission` returns the **normalised** rows for this type, so the stored `value_json` always
matches the snapshot's columns. That is a behaviour change for `repeating_group` only.

**Option membership** is validated in the service against `question.options`. **No
`candidate_answer_options` / `requisition_answer_options` rows are written** — its primary key is
`(answer_id, option_id)`, so it cannot express *which row* selected an option, and two rows picking
the same skill would collide.

### 7.2 What goes into `question_snapshot`

```jsonc
"repeatingGroup": {
  "columns": [
    { "key": "skill", "label": "Skill", "columnType": "single_select", "isRequired": true,
      "choices": { "from": "inline", "options": [ { "value": "ClickUp", "label": "ClickUp" } ] } },
    { "key": "proficiency", "label": "Proficiency", "columnType": "single_select", "isRequired": true,
      "choices": { "from": "inline", "options": [ /* the four levels */ ] } },
    { "key": "notes", "label": "Notes", "columnType": "short_text", "isRequired": false }
  ],
  "minRows": 0,
  "maxRows": 20
}
```

Two rules:

1. Columns are copied **verbatim** from `validation.repeatingGroup`, so a later rename or removal
   cannot change what a candidate is recorded as having answered (AC-IF-12).
2. A `from: 'question_options'` column is **resolved to `inline`, carrying only the options whose
   values appear in the submitted rows.** A ~200-entry catalogue snapshotted on every answer row is
   ~15 KB per candidate and buys nothing — an option nobody picked can never need rendering.
   Correspondingly, `buildSnapshot` **omits** the existing top-level `snapshot.options` for
   repeating groups so the catalogue is not stored twice.

Rule 2 is a considered reading of AC-IF-11's "options as at submission time" as *the options needed
to render this answer, as at submission time*. It is flagged rather than assumed, and AC-FB-07 states
it so it is never ambiguous again.

### 7.3 The error wire shape — additive by accident of good luck, kept deliberately

`mapSubmissionError`'s `messageFrom()` already reads `.message` off an object. So:

```jsonc
"details": {
  "fields": {
    "skills_and_tools": {
      "message": "2 rows have problems.",
      "rows": [
        { "rowIndex": 1, "columnKey": "proficiency", "message": "This field is required." },
        { "rowIndex": 3, "columnKey": "skill",       "message": "Not an active option of this question." }
      ]
    }
  }
}
```

A client that knows nothing about rows still shows a sensible top-level message with **zero change**.
The `rows` reader is a purely additive extension.

### 7.4 Client-side, three sources into one shape

Two hosts validate differently — `intake-form.tsx` uses `validateIntakeValues()`, `/f/:slug` uses
`zodResolver` + react-hook-form — so the control must not read either one's error state. Instead
`FieldProps` gains an optional `rowErrors?: readonly RepeatingGroupFieldError[]` (optional, so no
other field component changes), populated from:

- `validateIntakeValues()` — gains an additive `rowErrors` field alongside the existing
  `Record<string, string>`, which still holds the group-level message, so no existing caller changes.
- `/f/:slug` — a small pure `toRowErrors()` walks RHF's nested error object (Zod issue paths come out
  as `["rows", 2, "skill"]` because the schema is built column-by-column).
- The server, via the extended `mapSubmissionError`.

**Cell ids.** `field-shell.tsx` gains `cellFieldId(key, rowIndex, columnKey)` →
`field-skills_and_tools-r1-proficiency`. `SummaryEntry` gains optional `rowIndex` / `columnKey`, so
the error summary reads *"Skills & tools — row 2, Proficiency: This field is required"* and focuses
that exact input.

`focusField()` needs **no change** for the group case: `fieldId(key)` is on the `<fieldset>`, and it
already focuses the first `input, select, textarea, button` inside — row 1 cell 1, or the Add button
when there are no rows.

**React keys must be a stable per-row client id, never the array index.** With index keys, removing
row 2 makes React reuse row 3's DOM node, and focus and cell values follow the wrong row.

---

## 8. Keyboard and labelling — AC-UI-04 and AC-UI-03

### 8.1 Why not a `<table>`

`<th scope="col">` labels cells in a screen reader's **browse** mode. Inside a form control the
reader is in **forms** mode and announces only each input's own accessible name, so column headers
alone label nothing. Nesting per-row grouping inside a table also breaks table semantics.

**Decision: CSS grid, not `<table>`.**

- The whole control is the existing `GroupShell` — `<fieldset>` with the question label as
  `<legend>`, help text, `aria-describedby`, `aria-invalid`, and `id = fieldId(key)`.
- A visible column-header row marked `aria-hidden="true"` — it is decorative duplication of the
  per-input labels.
- Each row is a `role="group"` with `aria-label="Row 2"`.
- Each cell input carries a real `sr-only <label htmlFor>` naming its column.

**The row wrapper must be `position: relative`.** `sr-only` is `position: absolute`, and an instance
without a positioned ancestor anchors to the document and stretches it. That bug class is documented
in `HANDOFF.md` §7 and has already cost this codebase a layout.

### 8.2 Adding and removing

**Add** — a real `<button type="button">`. Appends a row, moves focus to the **first cell of the new
row**, announces "Row 4 added" into a polite live region owned by the control. At `maxRows` the
button stays **enabled** and announces "Maximum of 20 rows reached" — more accessible than a disabled
control a user has just tabbed to.

**Remove** — a per-row `<button>` whose accessible name is "Remove row 2", never an unlabelled icon.
Removes the row, then focuses **the remove button of the row that took its place**, or the Add button
if it was the last one. Announces "Row 2 removed. 3 rows remain."

**Focus is never allowed to fall to `<body>`.** That is the classic failure of this widget and the
reason AC-FB-09 names it explicitly.

`minRows` is 0 for all five seeded questions, so remove is never disabled; the remove control is
simply absent when there are no rows.

Tab order is DOM order: row cells → remove, row cells → remove, …, Add. **No arrow-key grid
navigation** — `role="grid"` is a widget contract we are not signing up for.

---

## 9. Failure states — part of the deliverable

- **Empty** (zero rows): column headers, a one-line "Nothing added yet.", and the Add button. Never
  a bare button with no context.
- **Loading**: there isn't one, and that is a design outcome, not an omission. Choices ride along in
  the form payload — which is precisely why the catalogue is not a separate endpoint. Recorded so
  nobody adds a spinner later.
- **Error**: three levels — group-level (min/max rows) in `GroupShell`'s existing error slot;
  per-cell beneath each input with `aria-invalid` and `aria-describedby`; and the top-of-form
  `ErrorSummary` linking to the exact cell.
- **Builder canvas** (dead preview): headers, `max(minRows, 1)` empty row, disabled Add button —
  matching the height formula exactly, pinned by the block-height unit test.

---

## 10. Rendering a stored answer

`renderAnswerValue()` in `apps/web/src/lib/answer-value.ts` returns a `string` and today would take
the `Array.isArray` branch and print `[object Object], [object Object]`.

- `lib/answer-value.ts` gains a repeating-group branch returning a plain-text fallback ("6 rows"), so
  the string-only consumers keep working unchanged — notably `supersededKeys()` in
  `form-submissions-card.tsx`, which compares rendered strings. It also gains
  `readRepeatingGroup(snapshot, valueJson)` returning typed rows plus column definitions, or `null`.
- New shared `components/patterns/answer-table.tsx`, used by **both**
  `features/candidates/components/form-submissions-card.tsx` and
  `features/requisitions/components/answers-card.tsx`. Solving it in one place only would guarantee
  drift the first time a repeating group reaches a client intake form — which is the same reasoning
  `lib/answer-value.ts`'s own header gives for existing.

The dispatch reads `questionSnapshot.questionType`, **never the live question**. No stored snapshot
says `repeating_group` today, so the branch is unreachable for every existing row.

Rows render in entry order, flat. They are not grouped by skill category: the answer stores the
skill's *value*, and the snapshot's resolved options carry value and label but no category.

---

## 11. What an admin can and cannot change

**Can, day one, with no developer:**

- The question's label, help text, placeholder, required flag, category, sort order, active flag,
  conditional logic and role scoping — everything the question editor already offers.
- The **choice list** for any catalogue column: add a skill, rename a skill's label, deactivate one.
  Through the **existing, unmodified** options editor.
- Which forms the question appears on, and where on the canvas.
- Deactivate the question entirely.

**Cannot, day one:**

- Add, remove, rename or reorder a **column**.
- Change a column's type, required flag or width.
- Change `minRows` / `maxRows`.
- Edit the fixed inline lists (proficiency levels, language levels).
- Nest a repeating group inside a repeating group — **never**, by construction (§3.1).

Because the engine reads columns **from data** (`questions.validation.repeatingGroup`), the later
admin column editor is a new editor over an existing field plus a `PATCH /questions/:id` that already
accepts `validation`. An increment, not a rewrite. **We are not building it now.**

### 11.1 The `pruneValidation` regression — the single most dangerous line in this change

`apps/web/src/features/question-manager/guard-rails.ts` defines:

```ts
export const VALIDATION_KEYS_BY_TYPE: Record<QuestionType, readonly ValidationRuleKey[]> = { … };

export function pruneValidation(questionType, validation) {
  const allowed = new Set<string>(VALIDATION_KEYS_BY_TYPE[questionType]);
  // …keeps only allowed keys
}
```

**If `VALIDATION_KEYS_BY_TYPE.repeating_group` does not contain `'repeatingGroup'`, the question
editor silently deletes every column definition on the next save.** The question survives; its
columns do not; and the form renders an empty table. Nothing warns, nothing throws, and the damage is
only visible on the next submission.

The compiler forces the *entry* to exist (the map is `Record<QuestionType, …>`) but **not its
contents** — `repeating_group: []` compiles perfectly and destroys the data. AC-FB-14 is the
regression test: a save from the question editor must round-trip `validation.repeatingGroup`
unchanged.

---

## 12. Migrations

Forward-only, numbered, never edited after commit. **Two.**

### `0028_repeating_group_enum.sql`

```sql
alter type question_type add value if not exists 'repeating_group';
```

And nothing else, for the reason `0016_candidate_registration_enums.sql` states in its own header:
Postgres forbids **using** a new enum value in the transaction that adds it. Same split, same reason.

### `0029_repeating_group_answer_shape.sql`

`create or replace function` for **both**:

- `enforce_answer_value_shape()` — `supabase/migrations/0006_requisitions_and_answers.sql:95`
- `enforce_candidate_answer_value_shape()` — `supabase/migrations/0017_candidate_registration.sql`

each adding `'repeating_group'` to the `value_json` arm. Both in one migration because 0017's own
comment says they must stay in lockstep. No trigger is recreated — `create or replace` leaves
`trg_answer_value_shape` and `trg_candidate_answer_value_shape` pointing at the new bodies.

Worth knowing: both `case` blocks have **no `else` arm**, so today an unknown `question_type` raises
`CASE_NOT_FOUND` (SQLSTATE 20000) rather than the intended `check_violation`. The type is unusable
until taught. The safety net already works; we are only teaching it.

### Rolled-back validation

These two **cannot be validated in one transaction** — the enum value is not usable until 0028
commits. Sequence: apply 0028 → validate 0029 in a rolled-back transaction → apply 0029.

The rolled-back run must prove five things:

1. Inserting a `repeating_group` answer populating `value_json` **succeeds** — both tables.
2. The same insert populating `value_text` **raises `check_violation`**, and the message names
   `value_json` — both tables.
3. Populating two value columns still raises the "exactly one is allowed" error.
4. **One insert per pre-existing arm still behaves.** The function is replaced wholesale, so a typo
   in an arm nobody meant to touch is the realistic failure, not the new arm.
5. After `rollback`, `pg_get_functiondef` returns the **old** body and answer row counts are
   unchanged.

Take a savepoint before each deliberately-failing insert — a statement error otherwise aborts the
whole transaction and the remaining assertions never run.

### No third migration — the content is seed data

The five questions, their options, and the blocks on the default template are **reference data, not
schema**. The precedent is explicit: `candidate_questions_seed.sql` ("Reference data, NOT a
migration: Rebecca owns this content"), T9's instruction, and `02-DATABASE.md` ("Seed data for …
questions, tools, skills … is not in migrations").

One new re-runnable seed, `supabase/seed/repeating_group_questions_seed.sql`, fixed UUIDs in a fresh
block, `on conflict do nothing` throughout.

**Do not guess the block placement.** Before writing the seed, read the live `candidate_forms` and
`candidate_form_versions` rows for `is_default` and confirm whether appending blocks to the existing
version or creating a new one is correct. `0021_candidate_form_seed_template.sql` wrote blocks
straight onto version 1 with `published_at = now()`; whether that is still the shape of the row is a
fact to check, not to assume.

---
## 13. Placement — what lands where

**All five questions join the shared candidate library** (`audience = 'candidate'`), so they are
available to drag onto any form.

**Three get blocks on the DEFAULT template:** `skills_and_tools`, `employment_history` and
`other_languages`. Education and certifications exist in the library and are one drag away when
Haider wants them — all five tables at once would make `/register`, a public form with a completion
rate, noticeably longer for no evidence.

**Every other form stays untouched.** The seed's writes are scoped to the single row where
`is_default`.

### Languages — the block's POSITION is the requirement

`other_languages` goes **inside the existing `candidate_language` category** — the step labelled
"Language", which already holds `english_spoken_level` and `english_written_level` — positioned
**beneath** those two questions.

That placement is not a layout preference; it is what delivers T6. Rebecca's literal words at 15:49
were *"You have Languages twice"*, and T6's fix is "merge them into ONE section: scalar fields first,
then the languages list below." Putting the table under the two English questions in the same
category **is** that merge, delivered on the form rather than on the recruiter's page. Whoever builds
this must not move the block to a new step "for tidiness" — it would silently undo the change
request.

The two English questions themselves — both in `CANDIDATE_MAPPED_QUESTION_KEYS`, both projecting
onto `candidates` columns — **stay exactly as they are.** The table covers **other** languages only,
and its label and help text must make that unambiguous ("Other languages you speak", with help text
saying English is covered by the questions above), so nobody records English twice and leaves two
contradictory statements of the same fact.

Its two level columns mirror `LanguageLevelSchema` in `packages/contracts/src/enums.ts` exactly —
`basic` / `conversational` / `professional` / `native_equivalent` — the same way the skills table
mirrors `proficiency_level`. Inventing a parallel set of level values is how two vocabularies for one
idea get into a database.

**`candidate_languages.is_native` does not earn a fourth column.** It is a different fact from
fluency — someone can be `native_equivalent` in a second language without it being their first — but
two things make the column not worth having today: `native_equivalent` already reads correctly to a
candidate as the top of the scale, and we are **not** projecting these answers onto
`candidate_languages` (§16), so an `is_native` cell would be a fact nothing in the system reads. It
would also mean widening `RepeatingGroupColumnTypeSchema` with a `yes_no` type for one use. If it
ever earns its place it is one column plus one column type — an increment, not a rewrite.

---

## 14. Why nothing breaks, per surface

| Surface | Mechanism |
|---|---|
| `/register` (`registration-form.tsx`, legacy category renderer) | `QuestionField` inside a `space-y-5` stack. One new case; every other case untouched. Variable height is free in flow layout. |
| Client intake form (`intake-form.tsx`) | Same renderer, same argument. No `audience = 'client'` question is a repeating group, so `GET /intake-form` returns **the same bytes it returns today** — `ValidationRulesSchema` gains an optional key with no default, so parsing an existing row yields an identical object, and `formVersionHash` is unchanged. |
| `/f/:slug` (canvas renderer) | Wire shape unchanged. The layout pass returns its input **by reference** when no repeating-group block is present (§6.3). |
| Every already-built candidate form | Blocks reference questions by id. No existing question changes type — and `trg_block_question_type_change` blocks it anyway once answered (AC-Q-05). No form gains a block unless an admin drags one on. The seed touches only `is_default`. |
| **Answers already stored** | No migration touches an answer row. `question_snapshot` is written once and never rewritten (AC-IF-11, AC-IF-12). The new render branch fires only when the snapshot says `questionType = 'repeating_group'` — which no stored snapshot says. **A stored snapshot is never reinterpreted:** the renderer reads `snapshot.repeatingGroup`, and rows written before this feature have no such key. |
| **A form with no repeating group** | **Nothing at all happens.** Provable four ways: (1) `shiftForGrowth` returns its input array by reference — `toBe`, not `toEqual`; (2) the form payload is byte-identical; (3) every API branch is gated on `questionType === 'repeating_group'`; (4) the two DB functions add one `case` arm and modify none, re-verified by exercising every pre-existing arm in the rolled-back validation. |

**Existing tests that must widen — flagged, not silently changed:**

- **AC-IF-07** says "Parameterised test, all 12 types". It becomes 13.
- `apps/web/tests/intake-form/exhaustiveness.test.ts` will fail until the renderer map is taught.
  That is the guard doing its job, not a regression.

---

## 15. Proposed acceptance criteria

`07-ACCEPTANCE-CRITERIA.md` has **no `AC-FB-*` section**. The following is **proposed** as a new
section 14. The locked document is **not** amended here; that is Haider's call.

| ID | Criterion | Verification |
|---|---|---|
| **AC-FB-01** | A `repeating_group` question with no `validation.repeatingGroup.columns` is rejected on create and update with `422 INVALID_VALIDATION_RULE` | Integration test |
| **AC-FB-02** | A repeating-group answer populating any column but `value_json` raises `check_violation`; `value_json` succeeds — both `candidate_answers` and `requisition_answers` | Integration test, both tables |
| **AC-FB-03** | Rows missing a required column return `422 VALIDATION_FAILED` with `details.fields[key].rows` naming **every** offending `rowIndex` + `columnKey`, not just the first | Integration test with three bad rows |
| **AC-FB-04** | Fewer than `minRows` or more than `maxRows` returns a group-level `422 VALIDATION_FAILED` | Integration test |
| **AC-FB-05** | A wholly-empty row is dropped, not rejected; a submission of only empty rows counts as unanswered and fails only when the question is required | Integration test |
| **AC-FB-06** | A choice value that is not an active option returns `422 INVALID_OPTION` naming the row and the column | Integration test |
| **AC-FB-07** | Every stored repeating-group answer carries `question_snapshot.repeatingGroup.columns`, with every choice column resolved inline carrying exactly the options its rows use, and no top-level `options` catalogue | Integration test |
| **AC-FB-08** | After storage, renaming a column, removing a column, or deactivating an option leaves the snapshot unchanged, and the candidate profile renders the original headings and option labels | Integration + component test |
| **AC-FB-09** | Add and remove are fully keyboard operable; focus lands on the new row's first cell after adding, and on the replacing row's remove button — or the Add button — after removing. Focus is never lost to `<body>` | Component test (jsdom) + Playwright keyboard E2E (AC-UI-04) |
| **AC-FB-10** | Every cell input has a programmatically associated label naming its column; each row exposes its position; axe-core reports zero critical or serious violations on a form containing a repeating group | axe-core via Playwright (AC-UI-03) |
| **AC-FB-11** | **A page containing no repeating-group block returns its input block array *by reference* from the layout pass** — asserted with `toBe`, not deep equality | Unit test. **This is the "nothing else breaks" guarantee in one line** (§6.3) |
| **AC-FB-12** | A repeating-group block's natural row span equals the pure height formula for `max(minRows, 1)` rows; adding a row on `/f/:slug` shifts only blocks that share a column with it and sit below it | Unit test |
| **AC-FB-13** | *(amendment flagged, not made)* AC-IF-07's parameterised type-mismatch test covers all **13** types | Integration test |
| **AC-FB-14** | A save from the question editor round-trips `validation.repeatingGroup` unchanged — the `pruneValidation` regression (§11.1) | Component + integration test |

---

## 16. What we are deliberately NOT building

- **The admin column editor.** Option A says so. Columns come from data so it is a later increment.
- **Nested repeating groups.** Impossible by construction (§3.1), and it stays that way.
- **A `question_options.option_group` column.** One catalogue per question covers all five uses. The
  cost is that the skill picker is a flat list rather than grouped under section headings (§4).
- **Reading the skill list from the `tools` / `skills` tables at render time, or syncing to them.**
  One-time copy, then the two lists diverge (§4). No sync.
- **Projection onto `candidate_skills` / `candidate_tools` / `candidate_languages`.** Haider's
  standing instruction: a candidate's profile shows the form they submitted and nothing else. The
  answer is stored and rendered on the application; nobody curates it into the child tables.
  **Named consequence:** `candidate_tools` and `candidate_skills` stay as they are with no screen, so
  **SDB's own assessment of a candidate's skill has no home today.** That is a known, separate
  decision. Do not solve it here.
- **A References table.** Cut for the D5-family reason in §1. Do not add it without asking Rebecca.
- **Reporting or filtering on repeating-group contents.** §1.3's rule — *"if you will ever filter,
  sort, aggregate, or join on a value, it does not go in JSON"* — still binds. "Every candidate who
  is Expert at ClickUp" means a projection into a real table, and that is separate work.
- **`candidate_answer_options` / `requisition_answer_options` rows** for repeating groups. The join
  table cannot express *which row*.
- **Drag-to-reorder rows.** Entry order is the order.
- **CSV paste or bulk import** into a table.
- **Per-row conditional logic.**
- **Undo on row removal.**
- **Arrow-key grid navigation** (`role="grid"`).
- **Any client-portal surface** for repeating-group answers.
- **A repeating group on the client intake form.** The type is available to both libraries; no
  `audience = 'client'` question uses it.
