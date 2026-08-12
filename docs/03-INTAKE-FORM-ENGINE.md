# 03 — Intake Form Engine

This module is the highest-churn part of the system. The client has stated she will edit the questionnaire frequently and add "a lot of things," and she must be able to do so without a developer. The design below optimises for that, without sacrificing the reporting that makes the data valuable.

---

## 1. The data modelling decision

### 1.1 Options considered

**Option A — one database column per question.**
Every question becomes a column on `requisitions`. Type-safe, trivially queryable, familiar.

Rejected. It is structurally incompatible with the stated requirement. A super admin creating a question would require a schema migration, which means a developer and a deploy. Roughly 49 universal questions plus role-specific sets produces a table of 100+ columns that grows without bound, and the "deactivate a question" requirement has no clean expression — dropping a column destroys historical answers, keeping it leaves dead columns forever. This option fails the primary requirement and is not viable.

**Option B — questions and answers both stored as JSON.**
A `form_config` jsonb document holds question definitions; each requisition holds an `answers` jsonb blob.

Rejected as the primary store, though it is the intuitive choice and it is what you leaned toward. It is genuinely fast to build. The problems appear later, and all of them are expensive:

- **No referential integrity.** Nothing prevents an answer referencing an option that no longer exists, or a question key that was renamed. These become silent data corruption, discovered months later.
- **Reporting becomes archaeology.** "Show me every requisition where the English requirement is professional and the budget exceeds $2,000/month" is a straightforward SQL query against rows and an unpleasant `jsonb_path_query` exercise against blobs — and it gets worse once you need to join across requisitions and clients. The rejection-reason and budget-band analysis that makes this data commercially useful to Rebecca lives exactly here.
- **No database-level validation.** Required-field enforcement, numeric ranges, and option membership all move into application code, where they are enforced once per code path rather than once per table. Every new consumer re-implements them or forgets to.
- **Type ambiguity.** `"budget": "3200"` versus `3200` versus `{"min":3000,"max":3200}` — jsonb will accept all three, and the first bad write is permanent.
- **Concurrent-edit loss.** Two users editing different answers on the same requisition both write the whole blob. Last write wins, and the other person's answer silently disappears.

**Option C — normalised question definitions plus typed answer rows. Recommended.**

Question configuration lives in real relational tables (`question_categories`, `questions`, `question_options`, `question_role_scopes`). Answers live as one row per question in `requisition_answers`, with **typed value columns** — `value_text`, `value_number`, `value_boolean`, `value_date`, `value_json` — and a database trigger enforcing that exactly one column is populated and that it matches the question's declared type.

### 1.2 Why Option C wins

| Requirement | Option A | Option B | Option C |
|---|---|---|---|
| Super admin creates a question without a deploy | No | Yes | **Yes** |
| Activate / deactivate without data loss | No | Yes | **Yes** |
| Categorise and reorder questions | Partial | Yes | **Yes** |
| Referential integrity on select options | Yes | No | **Yes** |
| Required / range / type validation in the database | Yes | No | **Yes** |
| Filter and report across requisitions in plain SQL | Yes | Painful | **Yes** |
| Concurrent answer edits without loss | Yes | No | **Yes** |
| Historical answers survive question edits | No | Fragile | **Yes** (snapshot) |
| Per-question audit trail | No | No | **Yes** |

Option C is the standard shape for this problem — it is how Jira custom fields, Typeform, and every serious ATS handle it — because it is the only one that satisfies both "non-technical user configures the form" and "the resulting data is a queryable asset."

### 1.3 Where JSON is still the right tool

Your instinct is not wrong, it is just about scope. JSON is used deliberately in four places, and only these four:

| Column | Why jsonb is correct here |
|---|---|
| `questions.validation` | An open-ended rule bag whose keys vary by question type. Validated against a Zod schema on write. Never filtered on |
| `requisition_answers.value_json` | Genuinely composite answers — currency ranges (`{min,max,unit,currency}`), multi-select value arrays, file reference lists. The scalar cases still use typed columns |
| `requisition_answers.question_snapshot` | An immutable copy of the question definition at answer time. Write-once, read-for-display |
| `events.metadata`, `webhook_ingest_log.raw_payload` | Diagnostic payloads. Never authoritative |

The rule the build agent must follow: **if you will ever filter, sort, aggregate, or join on a value, it does not go in JSON.**

### 1.4 The snapshot pattern

The hard problem with configurable forms is not creating questions, it is editing them. If a super admin renames a question or deletes an option, every historical answer either breaks or silently changes meaning.

Solution: every `requisition_answers` row stores `question_snapshot` — the label, help text, type, and option list exactly as they were when the answer was given.

```jsonc
{
  "questionKey": "english_spoken_required",
  "label": "Spoken English requirement",
  "questionType": "single_select",
  "categoryKey": "requirements",
  "options": [
    { "value": "basic", "label": "Basic" },
    { "value": "professional", "label": "Professional" }
  ],
  "capturedAt": "2026-08-12T09:14:22Z"
}
```

Rendering a historical requisition uses the snapshot. Reporting uses `question_key` and the typed value columns. Neither is affected by later edits.

This is why we do not need a full form-versioning subsystem with draft/publish cycles, staged versions, and version pinning. Toggling a question is immediate and live, exactly as requested, and the snapshot handles the consequences.

### 1.5 Guard rails on editing

| Field | Editable after answers exist? | Rule |
|---|---|---|
| `key` | **Never** | Immutable after creation. It is the reporting join key |
| `label`, `help_text`, `placeholder` | Yes | Cosmetic. Snapshots preserve the old wording |
| `sort_order`, `category_id` | Yes | Presentation only |
| `is_required` | Yes | Applies to future submissions only. Never retro-validated |
| `is_active` | Yes | Immediate effect on forms. Historical answers untouched |
| `question_type` | **No** | Blocked by trigger `trg_block_question_type_change` when `answer_count > 0`. API returns `409 QUESTION_TYPE_LOCKED` and instructs the admin to create a new question and deactivate the old |
| `validation` | Yes, with warning | UI warns that existing answers are not re-validated |
| Options: add | Yes | Always allowed |
| Options: edit label | Yes | Value stays stable |
| Options: change `value` | **No** | Blocked once referenced by any answer |
| Options: delete | **No** | Set `is_active = false` instead. Hard delete blocked by FK `on delete restrict` |

---

## 2. Super admin capabilities

All of the following are behind the `question.manage` permission, held only by `super_admin`.

### 2.1 Category management
- Create a category with label, description, sort order
- Edit label, description, sort order
- Reorder by drag, persisted as `sort_order`
- Toggle `is_active`. **Deactivating a category hides the category and all of its questions from every form**, without altering any question's own `is_active` value — so reactivating the category restores the previous per-question state
- Cannot delete a category containing questions; must deactivate

### 2.2 Question management
- Create a question: category, label, help text, placeholder, type, audience (`client` or `internal`), required flag, validation rules, options for select types
- `key` auto-generated as a slug of the label, editable at creation only, unique, immutable thereafter
- Edit any field permitted by §1.5
- Reorder within a category
- Toggle `is_active` — takes effect within the cache TTL (60 s default, configurable)
- Duplicate a question as a starting point for a new one
- Scope a question to one or more role categories, or leave unscoped for universal
- Build conditional logic: show this question only when another question equals / does not equal / is in / is true / is false a given value
- Preview the live client-facing form, filtered by a chosen role category
- View, per question, the answer count and the date it was last answered — so she can see what is actually being used before deleting anything

### 2.3 Safety behaviours
- Deactivating a question that other questions depend on conditionally raises a blocking warning listing the dependents
- Circular conditional chains rejected on write with `422 CIRCULAR_CONDITION`
- Every create, update, and toggle writes an `events` row with `entity_type = 'question'`, the actor, and the before/after values
- Deactivating a required question is permitted and requires no migration — future submissions simply omit it

---

## 3. Form rendering contract

### 3.1 Endpoint

`GET /api/v1/intake-form?roleCategoryId={uuid}&audience=client`

Public, unauthenticated, rate-limited to 60 requests per IP per minute. Response cached server-side for `intake.form_cache_ttl_seconds`.

### 3.2 Response shape

```jsonc
{
  "formVersionHash": "sha256:8f14e45f...",
  "generatedAt": "2026-08-12T09:00:00Z",
  "categories": [
    {
      "id": "uuid",
      "key": "company_contact",
      "label": "Company & contact",
      "description": "Tell us who you are",
      "sortOrder": 1,
      "questions": [
        {
          "id": "uuid",
          "key": "company_name",
          "label": "Company name",
          "helpText": null,
          "placeholder": "Acme Inc.",
          "questionType": "short_text",
          "isRequired": true,
          "sortOrder": 1,
          "validation": { "maxLength": 200 },
          "options": [],
          "conditional": null
        },
        {
          "id": "uuid",
          "key": "industry_experience_detail",
          "label": "Which industry?",
          "questionType": "short_text",
          "isRequired": false,
          "sortOrder": 9,
          "validation": {},
          "options": [],
          "conditional": {
            "questionKey": "industry_experience_required",
            "operator": "is_true",
            "value": null
          }
        }
      ]
    }
  ]
}
```

Rules the endpoint must satisfy:

1. Only `is_active = true` questions inside `is_active = true` categories are returned
2. Only questions with `audience = 'client'` are returned when `audience=client`; internal questions are never exposed on the public endpoint under any query parameter
3. Only `is_active = true` options are returned
4. Universal questions (no `question_role_scopes` rows) are always included; scoped questions are included only when `roleCategoryId` matches
5. When `roleCategoryId` is omitted, only universal questions are returned
6. Empty categories are omitted entirely
7. `formVersionHash` is a stable SHA-256 of the serialised active configuration. The front end sends it back on submission; a mismatch is accepted but logged for diagnostics

### 3.3 Submission

`POST /api/v1/intake-submissions`

```jsonc
{
  "formVersionHash": "sha256:8f14e45f...",
  "roleCategoryId": "uuid",
  "answers": [
    { "questionKey": "company_name", "valueText": "Acme Inc." },
    { "questionKey": "team_size_band", "valueText": "6-15" },
    { "questionKey": "budget_range",
      "valueJson": { "min": 1500, "max": 2500, "unit": "monthly", "currency": "USD" } },
    { "questionKey": "tools_required", "valueJson": ["clickup","gohighlevel"] },
    { "questionKey": "portfolio_required", "valueBoolean": true },
    { "questionKey": "target_start_date", "valueDate": "2026-09-15" },
    { "questionKey": "years_experience_min", "valueNumber": 3 }
  ]
}
```

Server-side validation, in order, failing fast with a field-level error map:

1. Every `questionKey` resolves to an active question in scope. Unknown or out-of-scope keys → `422 UNKNOWN_QUESTION`
2. Every active, in-scope, required question is present and non-empty → `422 REQUIRED_ANSWER_MISSING` listing all missing keys
3. The provided value field matches the question type → `422 VALUE_TYPE_MISMATCH`
4. `validation` rules pass → `422 VALIDATION_FAILED` with per-key detail
5. Select answers reference active options belonging to that question → `422 INVALID_OPTION`
6. Conditional questions are only accepted when their condition is satisfied by the other submitted answers → `422 CONDITION_NOT_MET`

On success, in one transaction:
1. Create `clients` row, `status = 'prospect'`, populated from the mapped identity answers
2. Create `requisitions` row, `status = 'submitted'`, `reference` generated
3. Create one `requisition_answers` row per answer, each with `question_snapshot`
4. Create `requisition_answer_options` rows for select answers
5. Write an `events` row, `event_type = 'intake_submitted'`
6. Enqueue the `intake_submitted` notification
7. Return `201` with `{ "requisitionReference": "REQ-000123" }` and nothing else — no internal IDs are returned to an unauthenticated caller

### 3.4 Mapped questions

A small number of questions map to first-class columns on `clients` and `requisitions` as well as being stored as answers, because the system reasons about them: engine, department, role category, budget range and unit, engagement type, hours per week, overlap window, target start date, English levels, accent ceiling, region preference, headcount, company name, contact name, contact email.

These are defined in a single constant, `MAPPED_QUESTION_KEYS`, in `packages/contracts`. The mapping is one-directional — the answer row remains the record of what was asked, the column is a derived projection used for filtering and business logic. If a mapped question is deactivated, the column simply stops being populated and no code path breaks.

**Rule:** mapped question keys cannot be deleted or have their `key` changed. The API returns `409 MAPPED_QUESTION_PROTECTED`.

### 3.5 In-portal submission

The same form engine renders inside the authenticated portal for a second or subsequent hire. Differences only:

- `GET /api/v1/intake-form` called with a bearer token; `audience=client` still applies
- Company and contact questions are pre-filled from the existing `client` record and rendered read-only
- `POST /api/v1/requisitions` is used instead of `/intake-submissions`, attaching to the existing `client_id`, and requires the `requisition.create` permission

One form engine, two entry points. No duplicated question logic.
