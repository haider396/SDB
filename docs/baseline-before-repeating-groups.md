# Baseline: form surfaces before the "repeating groups" question type

Captured 2026-09-09, against the staging Supabase project (`sdb-portal-staging`),
by walking every live form surface in a browser and cross-checking against the
database. Purpose: a diffable record of what `/register`, `/f/<slug>`, and the
client intake form render **today**, before a new question type is added to the
shared question engine, so a later regression can be told apart from a
pre-existing condition.

Environment: API on `http://127.0.0.1:3001` (Fastify, `tsx watch`, freshly
restarted for this capture — see "Environment notes"), web on
`http://localhost:5173` (Vite). Browsed via `localhost`, never `127.0.0.1`, per
the CORS allowlist.

---

## 0. Headline finding — read this before diffing anything else

**`/register` and `/f/WoK6hBgzhuey` render the SAME underlying form** (the
seeded, `is_default = true` "Candidate registration" `candidate_forms` row) **through
two different code paths, and today those two paths do not agree**:

| | `/register` (legacy category renderer) | `/f/WoK6hBgzhuey` (canvas renderer) |
|---|---|---|
| Steps | **8**: About you, Where you are, Language, Your experience, Your working setup, Typing speed, Documents, Consent | **6**: About you, Where you are, Language, Your experience, Your working setup, Consent |
| Typing speed step | Present, unconditionally | **Absent** |
| Documents step | Present, unconditionally | **Absent** |
| Consent copy | Heading "How we use your information" + 4 explanatory bullets, checkbox label "...may store my information and share my profile with client companies when putting me forward for a role." | No bullets, checkbox label "...may share my profile with prospective clients." |

The `candidate_forms` row for this form has `has_typing_test = true` and
`has_documents_step = true` in the database. So by the form's own configuration,
the Typing Speed and Documents steps should exist. They render on `/register`
only because `apps/web/src/features/candidate-registration/registration-form.tsx`
hardcodes them into every candidate registration regardless of the flags
(`TYPING_STEP_KEY`/`DOCUMENTS_STEP_KEY` are pushed unconditionally, lines ~98–109).
They do **not** render on `/f/WoK6hBgzhuey` because
`apps/web/src/features/form-builder/render/public-form-renderer.tsx` builds its
`steps` array purely from `payload.pages` (the builder canvas's own page list)
plus a hardcoded Consent step — nothing in that component reads
`has_typing_test`/`has_documents_step` at all, despite the file's own header
comment claiming "The typing test and documents steps ARE per-form and come
from the payload" (lines 9–11). The published canvas version's `pages` array
(`candidate_form_versions.pages` for version `5a8e1675-4adb-4a57-a496-3dd68443dfc6`)
literally only has 5 page entries — About you through Your working setup — no
Typing speed or Documents page was ever authored into it. `submit()` in that
same file also hardcodes `typingAttempts: []` and `files: []` unconditionally
(lines 154–155), so even if a step existed there is currently no UI wired to
populate either.

This is a **pre-existing condition, not something this capture introduced**. It
is called out here so that if the upcoming repeating-groups work touches either
renderer, a reviewer can tell "this divergence already existed" from "this
divergence is new."

A second, smaller thing worth knowing before it's obscured by future edits: the
question **library** (all active `candidate`-audience questions, 30 of them, 14
in the "About you" category alone) is larger than what the seeded "Candidate
registration" form actually places on its canvas (23 questions, 7 in "About
you"). The extra 7 ("Occupation", "Occupation" again under key `occupation_3`,
"Age", "Previous experience", "University name", "CGPA", "How did you hear
about us?") are real, active, non-archived rows in `questions` — they simply
aren't blocks on this form's published canvas. `GET /api/v1/candidate-registration-form`
resolves through `candidate-form-public.service.ts`'s `getDefault()` (the
builder), **not** through `candidate-registration-form.service.ts`'s
`getActiveFormQuestions(db, null, 'candidate')` — that second service is still
present and injected into the route options but is dead code for this GET route
(confirmed by reading `apps/api/src/routes/candidate-registration.ts`, whose own
comment says so: "`/register` is now served BY THE BUILDER (migration 0021)").
Not a bug — just a trap for anyone who greps for "every active candidate
question" and expects that to be what renders.

---

## 1. Checks and test totals (as they stand right now)

| Check | Result |
|---|---|
| `pnpm -r typecheck` | **Pass** — `packages/contracts`, `apps/api`, `apps/web` all "Done", exit 0 |
| `pnpm -r lint` | **Pass** — all three workspaces, exit 0 |
| `pnpm --filter @sdb/contracts test` | **229/229 passed**, 17 files |
| `pnpm --filter @sdb/api test` (unit only; `vitest.config.ts` excludes `tests/integration/**`) | **117/117 passed**, 12 files |
| `pnpm --filter @sdb/web test` (full run) | **401/401 passed**, 63 files |
| `tests/p6/stats.test.tsx` in isolation (`--testTimeout=30000`) | **5/5 passed** (also passed inside the full run above — no timeout observed either way this time) |
| API integration tests (`tests/integration`, testcontainers) | **Not run** — Docker is unavailable on this machine |

Note on numbers: generic guidance elsewhere states expected counts of 106 for
the API unit suite and ~383 for the web suite. The actual current counts are
117 and 401 respectively — the suites have grown since those figures were
written. Reported here as what the suites actually do today, per the task.

---

## 2. Database snapshot

Read via a scratch script (`postgres` package, same `DATABASE_URL` the API
uses), not committed to the repo.

**Questions, by audience** (`questions`, not archived — includes inactive rows):

| audience | count |
|---|---|
| `candidate` | 30 (all `is_active = true`) |
| `client` | 27 (25 active, 2 inactive: `requires_us_overlap`, `urgency_scale` — both superseded by `hiring_urgency`) |

**Question categories, by audience** (`question_categories`, `is_active = true`):

| audience | count |
|---|---|
| `candidate` | 5 (`candidate_personal`, `candidate_location`, `candidate_language`, `candidate_experience`, `candidate_work_setup`) |
| `client` | 2 (`company_context`, `working_setup`) |

**`candidate_forms`**: 14 rows total.

| status | archived_at | count |
|---|---|---|
| `active` | null | 3 (`WoK6hBgzhuey` "Candidate registration" — `is_default`; `2iKVTx0fbc5H` "Test"; `Dj1HieEJDn7U` "Scratch test form") |
| `inactive` | set | 11 (assorted QA/test forms from 2026-09-04 and 2026-09-08: "Test form", "Video Editor", "Test" ×3, "Video Editor (override test)", "Testing", "Accessibility check", "Final test", "Builder QA", "Category QA") |

**`candidate_answers`**: 15 rows.

---

## 3. `/register` — legacy category renderer

Console: **0 errors**, 1 warning (React Router v7 future-flag noise) throughout
the whole walk.

8 steps, driven by `GET /api/v1/candidate-registration-form` (the frozen legacy
response shape, actually served by the form-builder's `getDefault()` — see §0).

### Step 1 of 8 — About you
> The basics, so we know who we are talking to

| Label | Type | Required | Choices |
|---|---|---|---|
| First name | short_text | **yes** | — |
| Last name | short_text | **yes** | — |
| What should we call you? | short_text | no | — |
| Email address | email | **yes** | — |
| Phone number | phone | no | — |
| WhatsApp number | phone | no | — |
| LinkedIn profile | short_text | no | — |

### Step 2 of 8 — Where you are
> Location and when you can start

| Label | Type | Required | Choices |
|---|---|---|---|
| Country | single_select (searchable combobox) | **yes** | 251 countries (full ISO-ish list) |
| State or region | short_text | no | — |
| City | short_text | no | — |
| Your timezone | short_text | no | — |
| When could you start? | date | no | — |

### Step 3 of 8 — Language
> How you communicate in English

| Label | Type | Required | Choices |
|---|---|---|---|
| Spoken English | single_select (radio) | **yes** | Basic — simple conversations; Conversational — comfortable on a call; Professional — client-facing; Native or equivalent |
| Written English | single_select (radio) | **yes** | Basic; Conversational; Professional; Native or equivalent |

### Step 4 of 8 — Your experience
> What you have done and what you are good at

| Label | Type | Required | Choices |
|---|---|---|---|
| Current or most recent job title | short_text | no | — |
| Current or most recent employer | short_text | no | — |
| Total years of work experience | number | no | — |
| Have you worked with US-based clients or teams? | yes_no | no | Yes / No |
| Tell us about yourself | long_text (1500 char counter) | no | — |

### Step 5 of 8 — Your working setup
> Availability and home office

| Label | Type | Required | Choices |
|---|---|---|---|
| Hours available per week | number | no | — |
| Where do you work from? | single_select (radio) | no | A dedicated home office; A shared space at home; A coworking space |
| Do you have a backup internet connection? | yes_no | no | Yes / No |
| Do you have backup power? | yes_no | no | Yes / No |

### Step 6 of 8 — Typing speed
Not question-engine content. One numeric field ("Typing speed (words per
minute)") plus a "Take the typing test" button that launches an in-browser
typing test.

### Step 7 of 8 — Documents
Not question-engine content. Three file-upload slots: CV / résumé (required by
copy, "the one we most need"), Profile photo, Work sample (explicitly marked
optional).

### Step 8 of 8 — Consent
Heading "How we use your information" with 4 explanatory bullets, then one
checkbox: "I agree that Staffing Done Better may store my information and
share my profile with client companies when putting me forward for a role."
Submit button is "Submit registration".

Walk stopped before actually submitting (no need to write a real registration
row to the shared staging DB for a rendering baseline).

---

## 4. `/f/WoK6hBgzhuey` — canvas renderer, same form

Slug found via `candidate_forms` (`is_default = true`, `status = 'active'`,
label "Candidate registration"). Console: **0 errors**, 1 warning, throughout.

6 steps (see §0 for why Typing speed and Documents are missing here).
Questions and choices for steps 1–5 are byte-for-byte identical to `/register`
steps 1–5 above (verified against the same API response and against the
rendered DOM) — not re-transcribed.

### Step 6 of 6 — Consent
No explanatory bullets. One checkbox: "I agree that Staffing Done Better may
share my profile with prospective clients." Button: "Submit".

### Canvas geometry — `.sdb-canvas-node` boxes

Measured via `getBoundingClientRect()` on every `.sdb-canvas-node` and its
first child (the content), per step, at the default viewport:

| Step | Nodes | Box height range | Content height range | Box ≥ content, every node? | Overlaps |
|---|---|---|---|---|---|
| 1 About you | 7 | 112px (all) | 63–87px | **yes** | **0** |
| 2 Where you are | 5 | 112px (all) | 63–87px | **yes** | **0** |
| 3 Language | 2 | 144–168px | 135–159px | **yes** | **0** |
| 4 Your experience | 5 | 112–160px | 63–148px | **yes** | **0** |
| 5 Your working setup | 4 | 112px (all) | 63–106px | **yes** | **0** |
| 6 Consent | 0 (not a canvas page — hardcoded fieldset) | n/a | n/a | n/a | n/a |

**Zero overlaps found on any step, on any pair of nodes.** Every node's box
height is at least its content height (no clipped content). This matches the
task's expectation that today's overlap fix is holding — pinned here as the
"before" state.

---

## 5. Client intake form (`/intake`) — the `client`-audience question set

Public route is `/intake` (`router.tsx` line 157; `IntakePage` /
`apps/web/src/routes/public/intake-page.tsx`), backed by `GET /api/v1/intake-form`
→ `intake-form.service.ts` → `getActiveFormQuestions(db, roleCategoryId, 'client')`
directly (no form-builder involvement — this surface did not move under
migration 0021). Console: **0 errors**, 1 warning, throughout.

3 steps total: one taxonomy "Role" step, then one step per active `client`
category.

### Step 1 of 3 — Role
> Who are you hiring? — Pick the part of your business this hire supports.

Not question-engine content in the usual sense: 3 cascading selects (Area →
Department → Role category), counted by the app as "3 questions" for the step
label. Selecting "Operations" → "Executive Assistance" → "Executive Assistant"
unlocked step 3's role-specific questions with 0 console errors and no
unexpected network failures.

### Step 2 of 3 — Company Context
> About your business

| Label | Type | Required | Choices |
|---|---|---|---|
| Company name | short_text | **yes** | — |
| Company website | short_text | no | — |
| Best contact email | email | **yes** | — |
| How big is your team? | single_select (radio) | no | 1–5; 6–20; 21–50; More than 50 |

### Step 3 of 3 — Role & Working Setup
> What the role needs, the hours, and the budget

21 questions configured; **17 visible** by default (4 are conditionally
hidden until their trigger answer is given — noted below). Step label
correctly read "Step 3 of 3 · 17 questions", confirming the conditional-count
wiring is live and correct.

| Label | Type | Required | Choices / notes |
|---|---|---|---|
| What role are you hiring for? | short_text | **yes** | — |
| Spoken English requirement | single_select (radio) | **yes** | Conversational; Professional; Native-equivalent |
| Must-have skills | multi_select (checkboxes, "pick up to four") | no | Calendar management; Inbox management; Copywriting; Data analysis; Project management; Customer support |
| Job description | long_text (20000 char counter) | no | — |
| Role description | long_text (20000 char counter) | no | — |
| Monthly or hourly budget range | currency_range | **yes** | Hourly/Monthly toggle (defaults Monthly) + min/max USD |
| Ideal start date | date | no | — |
| Hours per week | number | no | — |
| Would you like to start them part-time? | yes_no | no | Yes / No |
| *When would you want them full-time?* | single_select | no | **conditional on `starts_part_time = true`** — hidden by default |
| How urgent is this hire? | single_select (dropdown) | **yes** | Immediately; Within a week; Within a month; Within three months; Just exploring for now; Other |
| *Tell us about your timeline* | short_text | no | **conditional on `hiring_urgency = other`** — hidden by default |
| What timezone does your business run on? | single_select (searchable combobox) | **yes** | 44 IANA US-style zone options |
| Your business day starts at | single_select | no | 24 half-hour-labelled options (12:00 am … ) |
| Your business day ends at | single_select | no | 24 options, same set |
| What percentage of those hours do you need them working? | number | no | — |
| Do they need to work specific hours? | yes_no | no | Yes / No |
| *Those hours start at* | single_select | no | **conditional on `requires_specific_hours = true`** — hidden by default |
| *Those hours end at* | single_select | no | **conditional on `requires_specific_hours = true`** — hidden by default |
| Is the hours overlap a deal breaker? | yes_no | no | Yes / No |
| Anything else we should know? | long_text (5000 char counter) | no | — |

Walk stopped before submitting, same reasoning as §3.

---

## 6. Screenshots (this session, not committed to the repo)

Saved by the Playwright tool under its own output directory, not under
`docs/`:
- `register-step8-consent.png` — `/register`, final step
- `canvas-step1-about-you.png` — `/f/WoK6hBgzhuey`, first step, full page
- `canvas-step6-consent.png` — `/f/WoK6hBgzhuey`, final step
- `intake-step3-role-working-setup.png` — `/intake`, full role/working-setup step

---

## 7. Environment notes

- The API dev server was **not** running when this capture started (health
  check on `127.0.0.1:3001` refused the connection). Started per CLAUDE.md
  (`cd apps/api && set -a && . ./.env && set +a && pnpm dev`). It was later
  killed and cleanly restarted once, specifically to rule out a stale-cache
  explanation for the §0 finding (ruled out — the 7/14-question and 6/8-step
  splits reproduce identically on a cold cache).
- The web dev server was already running on `localhost:5173`.
- This is the live `sdb-portal-staging` Supabase project — shared, not a local
  fixture. Row counts and form statuses reflect whatever the last person
  (human or agent) left there, not a clean seed. No writes were made to it by
  this capture: every form walk stopped one step short of Submit.
