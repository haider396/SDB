# Change Requests — Haider + Rebecca Pulse, 13 August 2026

| | |
|---|---|
| **Source** | Fathom call recording, 81 minutes — "Haider + Rebecca Pulse - August 13" |
| **Attendees** | Haider Jutt (Rank Genics), Rebecca Kallaus (Business Done Better) |
| **Compiled** | 28 August 2026 |
| **Last updated** | 28 August 2026 |
| **Status** | **9 tasks shipped**, 1 skipped, 2 cancelled — see the status board below |
| **Baseline** | PRD v1.1 FINAL (`README.md`, `CLAUDE.md`, `01`–`07`), all MVP phases P0–P7 built |

This document turns the call into an actionable backlog. Every task is grounded in the current
codebase — file paths, table names, and enum values below were verified against the repo, not assumed.

---

## Status board

### ✅ Shipped

| Task | What landed |
|---|---|
| **T1** | "Requisitions" → "Placements" across both portals (labels only) |
| **T2** | REQ id hidden from every client-facing surface |
| **T3** | "Submitted" → "Opened" on position cards |
| **T4 + T21** | Forward action moved to the main column as a "Next step" card; pause/close demoted to the rail |
| **T10** | Typing test — word-level scoring, keystroke accuracy, server-side averaging |
| **T13** | Business-hours block: timezone, hours, overlap %, specific hours, deal-breaker |
| **T14** | Part-time start → full-time growth path: two intake questions, both projected onto columns |
| **T16** | Job description + role description, replacing the brief; sourcing gate enforced in the API |
| **T31** | 30/60/90 post-hire tracking, both portals, plus the nightly auto-close job |
| **T32 + T38** | Public candidate registration form on the existing question engine |

Also shipped, outside the numbered list: the intake step merge (Role Requirements folded into
Working Setup), the urgency slider replaced with named options plus an "Other" free-text branch,
251-country searchable dropdown, and a segmented-control contrast fix.

### ⏭️ Skipped

| Task | Reason |
|---|---|
| **T17** Recruiter notes | Skipped by Haider, 28 Aug. Not cancelled — revisit if the need resurfaces. |

### ❌ Cancelled

**T35** (candidate portal) and **T37** (candidate self-service profile) — see Phase 10.

### 🎯 Next up

**T18** (priority). T14 shipped 2 Sep.

> **Open question before T18.** `requisitions.urgency` already holds the CLIENT's stated timeline
> from the intake form. Priority would be SDB's own ranking. They can disagree — a client says
> "immediately" while the job description is not written. Decide whether both exist independently
> (the current assumption) or whether urgency feeds priority.

### Environment notes

- Migrations **0016–0019** and all seeds in `supabase/seed/` are applied to **staging**.
- As of this update the work is **not committed** — staging schema is ahead of the repo.

**Read `CLAUDE.md` and the relevant numbered PRD doc before starting any task here.** Where a task
conflicts with the locked PRD, that conflict is called out explicitly and needs sign-off rather than
a silent override.

---

## Contents

1. [Decisions needed before building](#1-decisions-needed-before-building)
2. [Conflicts with the locked PRD](#2-conflicts-with-the-locked-prd)
3. [Phase 1 — Naming & copy](#phase-1--naming--copy-quick-wins-no-schema)
4. [Phase 2 — Candidate profile restructure](#phase-2--candidate-profile-restructure)
5. [Phase 3 — Intake form & position fields](#phase-3--intake-form--position-fields)
6. [Phase 4 — Approval workflow redesign](#phase-4--approval-workflow-redesign)
7. [Phase 5 — Client portal UX](#phase-5--client-portal-ux)
8. [Phase 6 — Pipeline & interviews](#phase-6--pipeline--interviews)
9. [Phase 7 — Disqualifiers](#phase-7--disqualifiers)
10. [Phase 8 — Post-hire tracking](#phase-8--post-hire-tracking)
11. [Phase 9 — Question & form builder](#phase-9--question--form-builder)
12. [Phase 10 — Candidate data capture](#phase-10--candidate-data-capture)
13. [Deferred — explicitly not now](#13-deferred--explicitly-not-now)
14. [Suggested build order](#14-suggested-build-order)
15. [Appendix — what was verified in code](#15-appendix--what-was-verified-in-code)

---

## 1. Decisions needed before building

These are genuine ambiguities from the call. **Do not resolve them by guessing** (`CLAUDE.md` §"When to stop and ask").

### D1 — "Placements" or "Positions"?

Rebecca said both, at different points:

> **2:00** — *"Requisitions is not a word that most people use. Let's just say positions."*
> **2:51** — *"Let's do placements. Exactly. Maybe placements instead of positions."*
> **46:04** — Haider: *"we are going to change it to my positions."* Rebecca: *"Yes, agreed."*

**Why it matters:** `placements` is already a real table meaning *"a candidate who was hired"* —
with `start_date`, `guarantee_end_date`, `placement_status`. Renaming requisitions to "placements"
would collide with an existing, load-bearing concept.

**Recommendation was:** "Positions" — the last thing agreed, and it avoids the collision.

> ### ✅ RESOLVED — 28 Aug 2026, Haider: **"Placements"**
>
> The concern above was raised and Haider confirmed **Placements**, label-only, no functional change.
> **T1 is implemented.** Note the consequence that was flagged and accepted: the word "Placement" now
> means an open role in the UI, while the `placements` table continues to mean a hired candidate.
> Keep that in mind when reading code — the UI term and the table term are deliberately different.

### D2 — Final assignment stage list

> **4:22** — *"Screened and Vetted at that point I think are the same. We would also want, I like a one-way video interview."*
> **7:00** — *"those would be a couple other ones that would be in between."*

She indicated `screened` and `vetted` collapse into one, and wants **two new internal stages**
(one-way video review, SDB-side interview) — but never gave a final list.

**Why it matters:** stages are enforced in the `client_visible_assignments` SQL view, in
`packages/contracts/src/stages.ts`, in the state machine, and in roughly 40 tests. This is the
highest-risk change in the document.

**Needed:** the definitive ordered stage list, and which existing stages are retired.
**Blocks:** T26, and partially T36.

### D3 — 90-day or 12-month guarantee?

> **37:35** — *"as a staffing company, we give a 90-day guarantee, which means anytime in that 90 days, if it's not working out, we might need to replace that candidate."*

But `README.md` §Appendix records, from the public site:

> *"a **12-month replacement guarantee** on the 12-month plan"*

and `placements.guarantee_end_date` was built for that.

**Needed:** which is correct, or whether both exist (e.g. 90-day trial period *and* a 12-month
replacement guarantee — these are not necessarily the same thing).

> ### ✅ RESOLVED — 28 Aug 2026, Haider: **90 days**
>
> Confirmed alongside two supporting facts: the dev seed already used a 90-day
> `guarantee_end_date` (start 2026-08-10 → 2026-11-08), and `GUARANTEE_PERIOD_DAYS` in
> `packages/contracts/src/placement-milestones.ts` is now the single source of truth for it.
> **T31 is implemented.**
>
> The 12-month figure in `README.md`'s appendix is now stale and should be corrected there, or
> re-confirmed with Rebecca if both periods genuinely exist.

### D4 — Seniority and Skill Level values

> **57:46** — *"let's have two different fields. Seniority... and then there's Skill Level. So Skill Level would be Entry, Mid, Senior, or Expert. Lead is not clear."*
> **58:30** — *"You can pull these straight from 5EOS actually. Let me grab these for you."*

Skill Level is confirmed: `entry` / `mid` / `senior` / `expert`.
Seniority values are **pending — Rebecca is sending the 5EOS list via Slack**.

**Blocks:** T12.

### D5 — Disqualifier legality

> **1:03:30** — *"I have to check the legalities of how we structure this, but I want to ask things like religion and politics."*

**The mechanism (T28–T30) is safe to build.** The specific religion/politics question content is
**not** — it carries real employment-law exposure in the US and varies by jurisdiction.

**Needed:** written legal sign-off before any such question ships. Build the generic machinery now;
let Rebecca author question content once cleared.

### D6 — GoHighLevel calendar configuration

> **9:18–11:28** — two calendars: SDB↔candidate, then client↔candidate, with manual slot assignment.

**Needed from Haider:** the GHL calendar IDs, and whether booking is embedded in the portal or a
redirect out to GHL.
**Blocks:** T27.

### D7 — Payment automation scope

> **53:00** — *"we can have it where as soon as it clicks that button, they're charged $2,500, period."*

`README.md`'s exclusion table currently reads: *"Stripe or any payment processing — payment is manual
and external."* She described automating it *eventually*, not now.

**Recommendation:** keep out of scope for this round; revisit when the approval workflow (T19) ships.

### D8 — Hardening public file uploads

**Decided 28 Aug 2026, Haider: file uploads ARE in scope for the registration form (T38).**
What remains open is how to protect them.

Today, `06-BACKEND.md` §6 justifies the current risk posture like this:

> *"Virus scanning is not implemented in MVP; the column exists so it can be added without a
> migration. **Uploads are restricted to authenticated admins, which bounds the risk.**"*

A public registration form removes that bound — anyone on the internet could upload a file.

**Already in place:** MIME allowlist (NFR-5), 25 MB cap (NFR-4), 60 req/min/IP rate limiting,
a private storage bucket, and short-lived signed URLs. There are no public object URLs.
**`virus_scan_status` already exists** on `candidate_files` as a column with nothing behind it.

**Needed:** a decision on whether to wire up actual scanning before the form goes live, or accept the
residual risk given the controls above. Not a blocker for building T38, but it must be answered
before it is exposed publicly.

**Affects:** T38.

---

## 2. Conflicts with the locked PRD

Three requests reverse an explicit exclusion in `README.md`. Each needs sign-off before build,
because `CLAUDE.md` rule 1 forbids implementing anything in the exclusion table — *"no stubs, no
placeholder routes, no future-proofing comments."*

| Request | PRD says | Task |
|---|---|---|
| Public candidate registration form | *"Candidate self-signup, candidate-facing portal — Post-MVP"* | **T38** |
| Post-hire 30/60/90 tracking | *"Post-placement handheld-tier tracking — Schema hook only"* | T31 |
| Auto-charge on submit | *"Stripe or any payment processing — payment is manual and external"* | D7 |

A fourth is softer: the per-client 5eOS toggle (T25) touches *"5eOS module reuse or shared
architecture — Explicitly de-scoped. Build standalone."* T25 adds **only a boolean display flag**,
with no shared code or API calls, which stays within the exclusion's intent — but flag it anyway.

---

## Phase 1 — Naming & copy (quick wins, no schema)

Highest value per hour. No migrations, no risk to the visibility gate.

---

### ✅ T1 · Rename "Requisitions" → "Positions" across the app

**Why**
> **2:00** — *"Requisitions is not a word that most people use."*

**Scope** — user-facing labels only. Do **not** rename the `requisitions` table, the `REQ-` reference
format, `@sdb/contracts` type names, API paths, or route params. Internal identity stays.

**Files** — `apps/web/src/features/requisitions/`, `apps/web/src/features/client-portal/`,
`apps/web/src/components/layout/sidebar.tsx`, the various `labels.ts` files.

**Acceptance** — no visible "requisition" string in either portal; all web tests updated and passing;
API and DB untouched.

**Blocked by** — D1.

```
Rename the user-facing term "Requisition"/"Requisitions" to "Position"/"Positions"
across apps/web only. Rules:
- UI copy, nav labels, page headers, breadcrumbs, toasts, empty/error states only.
- DO NOT rename: the `requisitions` DB table, `REQ-` reference format,
  @sdb/contracts type names, API paths, route param names, or test IDs.
- The route /client/requisitions may stay; change only the visible label.
Update affected web tests to match the new copy, then run:
  pnpm --filter @sdb/web test
```

---

### ✅ T2 · Hide the REQ ID from client-facing surfaces

**Why**
> **40:26** — *"this is a requisition ID... let's hide that, that's a database thing, clients don't care, that's just clutter."*

**Current state** — URLs already use the short `publicId` (migration 0015), so this is purely the
visible `requisition.reference` chip on the card and detail header.

**Files** — `apps/web/src/features/client-portal/client-requisitions-page.tsx:44`, client requisition
detail header.

**Acceptance** — no `REQ-NNNNNN` string anywhere in the client portal; admin surfaces unchanged;
`reference` stays in the API payload (support and admins still need it).

```
In the CLIENT portal only, stop displaying `requisition.reference` (e.g. "REQ-000003")
on position cards and the position detail header. Admin surfaces keep showing it.
Do not remove `reference` from the API payload — admins and support still need it.
Update the assertions in apps/web/tests/p5 and apps/web/tests/p2 accordingly.
```

---

### ✅ T3 · "Submitted" → "Opened" on position cards

**Why**
> **44:03** (Rebecca's turn, near its end — the next marker is 46:04) — *"Okay, submitted, um, submitted 25 days, submitted, um, opened. Let's have it be opened instead of submitted, I think, opened. Yeah, because they might submit a form, but that doesn't mean the job posting has been opened."*
>
> Confirmed at **46:04** (Haider: *"position is kind of open. Requisition, it sounds like it is submitted"*) and **46:13** (Rebecca: *"Yes, agreed."*).

**Note** — semantically "opened" should mean *when sourcing began*, not when the form was submitted.
Use `sourcingStartedAt` with a fallback to `submittedAt`.

**Files** — `apps/web/src/features/client-portal/client-requisitions-page.tsx:60`.

```
Change the client position card's relative-date line from "Submitted X days ago" to
"Opened X days ago". Source the timestamp from `sourcingStartedAt` when present,
falling back to `submittedAt`. Add a brief comment explaining the fallback.
```

---

### ✅ T4 · Fix action-button affordance on position detail

**Why**
> **51:17** — *"the clicking wasn't obvious from a visual button standpoint."*
> **53:50** — *"the navigation of those buttons, I want to change, because the button visuals are not clear there."*

**Scope** — the "Move to…", "On hold", "Closed unfilled" controls read as text rather than buttons.

**Constraint** — tokens only. `apps/web/src/styles/tokens.css` is the only file permitted to contain a
colour literal, and ESLint enforces it (AC-UI-01).

**Files** — `apps/web/src/features/requisitions/requisition-detail-page.tsx`.

```
On /admin/requisitions/:id, the status-transition controls ("Move to
pending_principal_approval", "On hold", "Closed unfilled") don't read as clickable.
Restyle them using the existing Button primitive in components/ui/button.tsx, with
clear affordance and a visible focus ring.
Use only tokens from styles/tokens.css — no raw hex (ESLint enforces this).
Keep the state-machine logic untouched; this is presentation only.
```

---

### T5 · Redefine the client card "bubbles" as action-needed counts

**Why**
> **43:11** — *"I don't think we need declined on there... I think the bubbles could just be how many candidates need to be viewed, how many candidates need to have an interview scheduled."*

**Current state** — `StageCountStrip` renders a chip for every client-visible stage with a non-zero
count, driven by `CLIENT_STAGE_ORDER`.

**Files** — `apps/web/src/features/client-portal/components/stage-count-strip.tsx`,
`apps/web/src/features/client-portal/labels.ts`.

```
Rework StageCountStrip so the chips express ACTION NEEDED, not every stage:
- "N to review"   → assignments at `presented`
- "N to schedule" → assignments at `client_reviewing`
Drop the `rejected_by_client` and `closed_not_selected` chips entirely.
Keep the existing "We're sourcing candidates — day N" empty state.
Update apps/web/tests/p5/dashboard.test.tsx.
```

---

## Phase 2 — Candidate profile restructure

This is the area Rebecca reacted to most during the walkthrough.

---

### T6 · Merge the two "Languages" sections

**Why**
> **15:49** — *"You have Languages twice."*

**Cause** — `SECTIONS` in `candidate-detail-page.tsx` contains both `language`
("Language & communication", the scalar English/accent fields) and `languages`
("Languages", the `candidate_languages` child collection).

**Files** — `apps/web/src/features/candidates/candidate-detail-page.tsx:63-80`,
`components/sections.tsx`, `components/collections.tsx`.

```
The candidate detail page has two language sections: "Language & communication"
(id: language, scalar English/accent fields) and "Languages" (id: languages, the
candidate_languages child collection). Merge them into ONE section titled
"Language & communication": scalar fields first, then the languages list below.
Remove the duplicate nav entry from SECTIONS. Preserve anchor links and the
dirty-form registry behaviour for both sub-parts.
```

---

### T7 · Consolidate Skills + Skills Summary + Tools into one section

**Why**
> **17:22** — *"But then there's skills summary somewhere else... let's combine those."*
> **17:47** — *"under skills, you could have tech stack."*
> **18:01** — *"combine those two sections where you have a dropdown of all the skills, which includes platforms, tech stack... have it be organized by section."*
> **19:20** — *"let's add a third for just notes."*

**Target shape** — one table, grouped by category:

| Name | Proficiency | Notes |
|---|---|---|
| ClickUp | Expert | Ran the migration at their last role |

**Current state** — three separate sections: `skills-summary`, `skills`, `tools`.

**Depends on** — T8 (notes column), T9 (categories).

```
Consolidate three candidate detail sections — "Skills summary" (id: skills-summary),
"Skills" (id: skills), and "Tools" (id: tools) — into a single "Skills" section.
Render one table grouped by category, columns: Name | Proficiency | Notes.
Tools and skills share the table; category comes from tools.category / skills.category.
Keep the existing PUT-replaces-full-set semantics of the tools/skills endpoints.
Remove the now-dead nav entries from SECTIONS. Update tests in apps/web/tests/p3.
```

---

### T8 · Add `notes` to candidate tools & skills *(migration)*

**Why** — required by T7.

**Current state** — `candidate_tools` and `candidate_skills` carry `proficiency` but no notes column.

```
Create supabase/migrations/0016_candidate_skill_notes.sql adding a nullable
`notes text` column to both candidate_tools and candidate_skills.
Forward-only; do not edit any applied migration.
Extend the Zod schemas in packages/contracts/src/candidates.ts, the repository
mapping in apps/api/src/repositories/candidates.repo.ts, and the PUT bodies so
notes round-trips. Add an integration test asserting notes persists.
```

---

### T9 · Seed skill and tool categories, including Tech Stack

**Why**
> **18:01** — *"have it be organized by section, and tech stack would be a section... and then leadership would be a section."*

**Current state** — ~~the `category` column is simply unpopulated~~. **Corrected 9 Sep**: it was
never unpopulated. All 16 rows `dev_seed.sql` inserts already carried a category —
`automation, communication, crm, design, documentation, project_management` on tools and
`administrative, analytical, client_experience, finance, marketing, operations` on skills. What was
missing were the two sections Rebecca actually named by mouth, **Tech Stack** and **Leadership**,
and enough rows in each section to be usable. So "populate category on the existing rows" was never
the job, and doing it would have *changed* correct data. This is a data task, not a schema task.

**Data half — done.** `supabase/seed/skills_tools_taxonomy_seed.sql` adds 94 tools and 90 skills
across 14 categories (the 12 that existed, plus `tech_stack` and `leadership`), leaving every
existing row and its category untouched. Applied 9 Sep: tools 8 → 102, skills 8 → 98. The two
tables now share one category vocabulary, which is what T7 needs to render them in one grouped
table.

**UI half — outstanding.** There is no admin taxonomy UI to surface `category` in: `/admin/settings`
is still the `PlaceholderPage` in `apps/web/src/routes/admin/index-pages.tsx`. The API is also
create-only — `GET`/`POST /api/v1/tools` and `/skills` exist, there is no `PATCH` and no way to flip
`is_active`, so editing a seeded row means new endpoints and new `Update*BodySchema` contracts.

```
Remaining: surface category as an editable field in the admin taxonomy UI.
Needs, in order: PATCH /api/v1/tools/:id and /api/v1/skills/:id (settings.manage)
with UpdateToolBodySchema / UpdateSkillBodySchema in packages/contracts, then the
taxonomy screen itself behind /admin/settings. Category is free-form text on
both the column and the Zod schema — keep it that way; the client edits it.
Display labels for the 14 keys live in the UI, not the data: tools/skills have
no label column. humanizeKey() in apps/web/src/lib/format.ts gives sentence
case ("Project management"), not the title case these headers want.
```

---

### ✅ T10 · Typing speed (WPM) field + typing test

**Moved.** This task now lives in [Phase 10](#phase-10--candidate-data-capture), because the typing
test is a section of the public registration form (T38) rather than an admin-only control. The plain
WPM field still belongs in the consolidated Skills section here (T7).


### T11 · Assessments section, and files moved into their own sections

**Why**
> **21:00** — *"Let's add an Assessments section where they can upload anything. I think that works for MVP."*
> **21:28** — *"For now, MVP is an upload field. List of things to have: Myers-Briggs, Wealth Dynamics, Culture Index, Predictive Index... DISC."*
> **23:30** — *"I don't think there should be a file section. I think that should just go inside of each section. So let's break that up."*

**Current state** — one generic Files card driven by a `candidate_file_type` enum. The
`candidate_assessments` table already exists as a schema hook with no UI.

**Scope guard** — upload and label only. **No scoring logic** — the assessment tool itself is
explicitly out of scope (`README.md`), and she confirmed on the call it isn't ready.

```
Two changes to candidate file handling:
1) Add an "Assessments" section using the EXISTING candidate_assessments table
   (schema hook, 02-DATABASE §8.2). MVP = upload + provider label only, NO scoring.
   Providers: Myers-Briggs, Wealth Dynamics, Culture Index, Predictive Index, DISC, Other.
2) Decompose the single "Files" card: render each file type inside its relevant
   section (CV → Professional, writing sample → Skills, assessment report →
   Assessments, certificate → Certifications) instead of one generic list.
Keep candidate_files as the single storage table and leave the signed-URL flow in
candidate-files.service.ts unchanged — this is a presentation regroup.
```

---

### T12 · Split Seniority and Skill Level into two fields

**Why**
> **57:46** — *"let's have two different fields. Seniority... and then there's Skill Level. So Skill Level would be Entry, Mid, Senior, or Expert. Entry, Mid, Expert. Lead is not clear."*

**Current state** — a single `seniority_level` enum: `junior` / `mid` / `senior` / `lead`. Used on
**both** `candidates` and `requisitions`.

**Blocked by** — D4.

```
BLOCKED until Rebecca sends the 5EOS seniority list via Slack.

Split the single seniority_level enum ('junior','mid','senior','lead') into two:
- skill_level:     'entry','mid','senior','expert'   (CONFIRMED on the call)
- seniority_level: values TBD from 5EOS              (BLOCKED)
Applies to BOTH candidates.seniority_level and requisitions.seniority_level.
Forward-only migration; keep the old column populated until the new one is
backfilled, then deprecate. Mirror both as Zod enums in packages/contracts.
```

---

## Phase 3 — Intake form & position fields

All new questions go through the **existing question engine** (`03-INTAKE-FORM-ENGINE.md`).
Do not hardcode fields into the renderer — Rebecca must be able to edit them herself.

---

### ✅ T13 · Business hours / timezone block, with deal-breaker toggle

**Why**
> **47:22** — *"Let's go back on the hours... what is your time zone of operations as a business? What are your hours as a business? What percentage of these hours do you need the candidate to work? Do you need them to be specific hours? If so, what are the hours?"*
> **48:15** — *"And then a toggle of, is this a deal breaker? Yes or no."*
> **48:40** — *"those are all like, it's a little bit more complex than a yes or no."*

**Current state** — a single seeded question `requires_us_overlap` (yes/no), plus
`overlap_start` / `overlap_end` / `overlap_timezone` columns. Too blunt for what she described.

**Context** — she mentioned a hire in **Australia**, so US-centric overlap assumptions no longer hold.

```
Replace the single `requires_us_overlap` intake question with a structured block:
- client_business_timezone         (select)
- client_business_hours_start/_end (time)
- overlap_percentage_required      (number 0-100)
- requires_specific_hours          (yes/no) → conditional: specific_hours_start/_end
- overlap_is_deal_breaker          (yes/no)
Add these as SEEDED INTAKE QUESTIONS through the existing question engine
(03-INTAKE-FORM-ENGINE) — do NOT hardcode them in the renderer.
Map to requisitions columns via MAPPED_QUESTION_KEYS where the system reasons about them.
Keep `requires_us_overlap` active until migrated, so historical answers still render
from their question_snapshot.
```

---

### ✅ T14 · Part-time → full-time growth path

**Why**
> **49:25** — *"there might be the option to start part-time and then grow into full-time, so we need to have that clarification on there, and then how quickly they're expecting to be full-time."*
> **51:00** — *"that's with Virtual Latinos — I always want to start part-time, but I always want them to grow into full-time, and I was never able to properly communicate that on their intake form."*

```
Add to the intake form and requisitions:
- starts_part_time            (boolean)
- grows_to_full_time          (boolean)
- full_time_transition_after  (enum: '2_weeks','1_month','2_months','3_months','other')
- full_time_transition_note   (text)
Conditional: only show the transition fields when starts_part_time is true.
Add as seeded questions through the question engine, mapped to new requisition
columns. Surface in the admin position detail and in the client-facing brief.
```

**What shipped (2 Sep) — and how it differs from the plan above**

Two questions, not four fields. The plan's `grows_to_full_time` boolean is redundant once the
timeframe list carries a **"It stays part-time"** option: picking a timeframe *is* the answer to
"does it grow". One fewer conditional level, one fewer click.

`full_time_transition_note` was dropped for the same reason — the enum's `longer` option
("Longer — we can discuss") absorbs the free-text case, and an unstructured note on a field this
narrow would not be read.

| Shipped | |
|---|---|
| Migration | `0019_part_time_growth.sql` — `starts_part_time boolean`, `full_time_transition_after text` |
| Seed | `intake_part_time_growth_seed.sql` — sort 104/105, in the hours block |
| Enum | `FullTimeTransitionSchema`: `2_weeks`, `1_month`, `2_months`, `3_months`, `longer`, `stays_part_time` |
| Conditional | `full_time_transition_after` shown only when `starts_part_time is_true` |
| Mapped keys | both added to `MAPPED_QUESTION_KEYS` — protected from deletion, projected onto columns |
| Admin UI | editable on the position detail fields card |

> **Not done: the client-facing surface.** The plan says "surface in the client-facing brief", but
> the brief was **deleted in T16** (Option B — dropped in favour of Job Description + Role
> Description), so that target no longer exists. The client's answers are still recorded and visible
> in the intake answers. Whether the client position page should echo the part-time arrangement back
> is a **display decision for Haider** — not built.

**Verified end to end** — a public intake submitting `starts_part_time: true` +
`full_time_transition_after: '2_months'` projected onto both columns (REQ-001002, since removed).
Option values were diffed against `FullTimeTransitionSchema`: a reworded *label* is safe, but a
changed *value* would silently stop populating the column.

---

### T15 · Region preference → dropdown with "Other"

**Why**
> **59:09** — *"Region preference, it needs to be a dropdown, yes. Country."*
> **1:00:00** — *"I'm fine with there being a dropdown, but then an other, and if other, then free-form fill-in for region."*

**Current state** — `requisitions.region_preference` is free text.
**Note** — `01-PRODUCT-OVERVIEW.md` says *"no hard constraint in schema; country remains free text."*
This is an intentional change from that.

```
Convert region_preference from free text to a single_select question with an
"Other" option that conditionally reveals a free-text field.
Options: LATAM-wide, plus individual countries (Mexico, Colombia, Argentina,
Brazil, Peru, Chile, Costa Rica, Dominican Republic, Venezuela), plus Other.
Keep the existing region_preference column; store the resolved label.
Confirm the country list with Rebecca before seeding.
```

---

### ✅ T16 · Job Description vs Role Description (file or link)

**Why**
> **35:09** — *"a job description is different than a role description. Job description is what we present externally when we're looking for a candidate. A role description is what they have once they're inside the company."*
> **35:40** — *"we cannot look for the position until we have the job description."*
> **55:17** — *"we need to make sure that it's optional for them to submit a document, but they can upload a file or a link."*
> **55:19** — *"I liked to create a Google Drive link and submit that even before I put anything on the doc."*

**Hard rule** — a position cannot move to `sourcing` without a job description. Enforce in the
transition service, not the UI.

```
Add two distinct optional documents to a position:
- job_description  (external-facing, used to attract candidates)
- role_description (internal, what they do once hired)
Each accepts EITHER an uploaded file OR a URL — she pastes Google Drive links before
the document is written. Both optional at intake time.

Enforce: a position cannot transition to `sourcing` without a job description.
Return 422 JOB_DESCRIPTION_REQUIRED from the transition service (services/
state-machines.ts path), not from the UI.

Reuse the signed-upload flow in candidate-files.service.ts. Propose whether to add a
requisition_files table or extend candidate_files with a requisition scope, and why,
BEFORE implementing.
```

---

### ⏭️ T17 · Recruiter Notes (internal-only) on a position

**Why**
> **56:00** — *"there needs to be a section that is just internal on our end. Like, this client's a little crazy, we've got to make sure we find someone the right culture fit... there's caution things that you don't want to communicate to the client."*

**Current state** — `clients.internal_notes` exists at client level; nothing at position level.

**Critical** — this must never reach a client. Follow the `requisition.view_commercials` pattern
(`04-API.md` §7): the key is **absent**, not null.

```
Add `recruiter_notes text` to requisitions — internal only.

CRITICAL: this must never reach a client. Omit it from every client-scoped
serializer and from the client requisition payload entirely — key ABSENT, not null,
matching the requisition.view_commercials pattern in 04-API §7.

Add an integration test proving a client_user's GET /requisitions/:id response has no
`recruiterNotes` key at all (assert key absence, not a null value — mirrors AC-RQ-06).
Surface in admin position detail as a visually distinct internal card.
```

---

### 🎯 T18 · Priority field on positions

**Why**
> **39:18** — Haider: *"Priority matters."* Rebecca: *"Priority definitely matters. Priority would need to be seen on the card, preview card."*

**Open question** — `requisitions.urgency` already exists (the client's stated urgency at intake).
Priority is SDB's operational ranking. Confirm whether both coexist.

```
Add `priority` to requisitions as an enum ('low','normal','high','urgent'), default
'normal'. Admin-editable; visible to the client on the position card and sortable (T24).
Mirror as a Zod enum in packages/contracts.

Note: this is distinct from the existing `urgency` intake answer, which is the CLIENT's
stated urgency at submission — priority is SDB's operational ranking.
Confirm with Haider whether both should coexist or urgency should feed priority.
```

---

## Phase 4 — Approval workflow redesign

The most significant workflow change in the call.

---

### T19 · Move approval to the client side, with a submit queue

**Why**
> **52:31** — *"I think that's not a bad thing for them to have internally... it doesn't need to come in here. It goes to the client's portal."*
> **53:00** — *"they could put together a queue of a couple different positions before they're ready to submit it to us, because they're going to incur a fee as soon as we collect that."*
> **53:20** — *"admin permissions to see who on their team has the authority, but it doesn't come to us until it is formally approved by the client."*

**Current state** — `pending_principal_approval` is an SDB-side step: the admin drafts a brief, then
requests principal approval. She wants approval to happen **before** it reaches SDB.

**Risk** — `REQUISITION_TRANSITIONS` is exhaustively tested by AC-RQ-01 and AC-RQ-02.

```
Restructure the approval flow. Today the principal approves AFTER the position reaches
SDB (status pending_principal_approval). Rebecca wants approval INSIDE the client portal
BEFORE it reaches SDB, because submission incurs a fee.

New flow:
1. A client user drafts a position → status `draft` (client-side only, invisible to SDB)
2. The client can hold several drafts in a queue
3. Only a client member with submit authority can formally submit
4. On submit → status `submitted`, now visible to SDB
5. SDB then performs its own `pending_internal_approval` step

Requires: a new `draft` status, a client-member permission for submit authority
(extend client_members / the permission set), and changes to REQUISITION_TRANSITIONS
in apps/api/src/services/state-machines.ts.

Propose the FULL revised adjacency map for review BEFORE implementing — this map is
exhaustively tested by AC-RQ-01 and AC-RQ-02.
```

---

### T20 · Rename approval statuses to client-facing language

**Why**
> **56:20** — *"pending principal approval — so, pending client approval, would say pending client approval."*
> **53:20** — *"it would just be pending manual approval... internal approval, manual approval, they're both the same thing."*

```
Rename requisition statuses for clarity:
- pending_principal_approval → pending_client_approval  (client-side, per T19)
- add pending_internal_approval                          (SDB-side)

These enum values are referenced in state-machines.ts, packages/contracts, label maps,
and tests. Use a forward-only migration to ADD new enum values and migrate rows; do not
drop old values in the same migration.
Update CLIENT_STAGE_LABELS and the admin status label maps.
```

---

### ✅ T21 · Move the approval action next to the brief

**Why**
> **56:40** — *"that would be underneath the brief, not on the right... the button to push it to get the approval needs to be next to the brief."*

```
On the admin position detail page, move the "Request approval" action out of the
right-hand rail and place it directly beneath the brief/description card, since it
acts on the brief. Keep the read-only status indicator in the right rail.
Presentation change only — no state-machine changes.
```

---

## Phase 5 — Client portal UX

---

### T22 · Collapsed / expanded candidate card views

**Why**
> **33:20** — *"there could be a potential where you have one title of a position, but you're hiring three of that position. In that case you might have 12 to 20 candidates here, and to be able to see all of those is a little bit overwhelming with the expanded cards."*

```
Add a collapsed/expanded toggle to the candidate list on the client position detail page.
- Collapsed: one compact row per candidate (photo, display name, stage, key chips)
- Expanded: today's full card
Persist the choice per user in the Zustand UI store — cross-cutting UI state, which
05-FRONTEND §1 permits; this is not server state.
Default to collapsed above 8 candidates.
```

---

### T23 · View options — card/table toggle and field checklist

**Why**
> **40:40** — *"what we could do, which might be even cleaner, is to just have a toggle. They can do a checklist for what things that they want to view on that screen, which could also include Engine."*
> **41:39** — Haider: *"I can have a table view and a card view."* Rebecca: *"table view and a card view is not a bad view option."*

```
Add a "View options" control to the client positions list:
- Layout toggle: card view / table view (table via the existing DataTable pattern)
- A checklist of which fields appear on the card: title, department, priority, stage,
  candidate counts, opened date, and engine (engine only when the client's 5eOS flag
  is on — see T25)
Persist per user in the Zustand UI store.
```

---

### T24 · Sort and group positions by Priority, Department, Engine

**Why**
> **38:40** — *"let's think about what this looks like when they have, they're hiring for 15 positions. We would want it to be able to be sorted at the top based on alphabetical department, might as well add Engine in there as well. And Priority."*

**Critical technical note** — the list uses **cursor pagination with fixed filters**
(`lib/use-cursor-pagination.ts`, HANDOFF §2). Sorting must be server-side and part of the cursor's
fixed filter set. A client-side array sort will silently break pagination.

**Depends on** — T18, T25.

```
Add sort and group controls to the client positions list: by Priority, Department,
and Engine (engine hidden unless the client's 5eOS flag is on).

IMPORTANT: the list uses cursor pagination with fixed filters
(apps/web/src/lib/use-cursor-pagination.ts). Sorting MUST be applied server-side and
become part of the cursor's fixed filter set — a client-side array sort will break
pagination. See HANDOFF.md §2.
```

---

### T25 · Per-client 5eOS toggle

**Why**
> **39:21** — *"unless we internally notate that this client is using 5eOS, and then we toggle something, and then there might be certain things that if they are using 5eOS, that it might toggle on a couple features, including that Engine would be listed here as well."*
> **39:51** — *"because if not, it's just clutter if they're not using 5eOS."*

**Scope guard** — a boolean display flag only. No shared code, no API calls to 5EOS. `README.md`
excludes *"5eOS module reuse or shared architecture."*

```
Add `uses_5eos boolean not null default false` to the clients table, admin-editable
from the client detail page.
- false: hide Engine everywhere in that client's portal (cards, filters, grouping, intake)
- true:  show it

Note: this is a DISPLAY toggle for the separate 5EOS product. docs/README.md's exclusion
table forbids 5eOS module reuse or shared architecture — this task adds a boolean flag
only: no shared code, no API calls to 5EOS, no imported modules.
```

---

## Phase 6 — Pipeline & interviews

---

### T26 · Restructure the assignment stage machine

**Why**
> **4:22** — *"Screened and Vetted at that point I think are the same."*
> **7:00** — *"those would be a couple other ones that would be in between. All of that would be done well before — client would not review anything at that point. Then they would need to interview schedule internally with us. That would happen first."*

**Blocked by** — D2.

**⚠️ Highest-risk task in this document.** Stages are enforced in the `client_visible_assignments`
SQL view, `packages/contracts/src/stages.ts`, the state machine, and ~40 tests. Getting this wrong
breaks the client-visibility gate — the product's core safety property.

```
BLOCKED until the final stage list is confirmed (D2).

Restructure assignment_stage. Rebecca indicated `screened` and `vetted` are effectively
the same step, and wants two new INTERNAL stages before `presented`: a one-way video
interview review, and an SDB-side interview with the candidate.

Before writing ANY code, produce a migration plan covering:
- the new enum values, and which existing ones are retired
- the revised ASSIGNMENT_TRANSITIONS adjacency map
- how CLIENT_VISIBLE_STAGES and PII_UNLOCKED_STAGES change (contracts/stages.ts)
- the client_visible_assignments view rebuild (defined in migration 0010)
- data migration for existing assignments sitting at retired stages
- which acceptance criteria are affected (AC-PL-01, AC-PL-07, AC-PL-08, AC-DB-07)

Do NOT implement until that plan is reviewed. This change touches the client visibility
gate, which is the product's core safety property (CLAUDE.md rules 2-4).
```

---

### T27 · Interview scheduling via GoHighLevel calendar

**Why**
> **4:22** — *"All calls can be booked on high level, so it could be one specific calendar that they're booking on for when they're interview scheduled."*
> **9:18** — *"the first calendar would be from us with the candidates... the next set of calendar would be [the client's]."*
> **10:30** — *"they book it, and then we coordinate with the candidates... and then we just manually change the calendar event titles. I think that makes the most sense."*
> **12:33** — *"This can all be manual for right now... it's not a today problem for sure."*

**Blocked by** — D6.

**Current state** — MVP uses a pasted meeting URL. `README.md` lists calendar integration as out of
scope: *"paste-a-link approach in MVP."* This supersedes that.

```
Replace the paste-a-meeting-link approach with GoHighLevel calendar booking.
Two distinct calendars:
1) SDB internal interview — SDB books the candidate
2) Client interview — the client books N back-to-back slots, one per candidate

MVP is deliberately semi-manual (confirmed on the call): the client books slots on a GHL
calendar, then an SDB admin assigns candidates to slots and renames the events.
Do NOT build candidate availability sync or an AI scheduler — both explicitly deferred
~6 months on the call.

Needs from Haider first (D6): the GHL calendar IDs, and whether booking is embedded in
the portal or a redirect.
Extend the existing interviews table rather than replacing it; keep the meeting_url
column as a fallback.
```

---

## Phase 7 — Disqualifiers

> **⚠️ Important correction:** Rebecca said *"it's not built yet"* (1:02:28). **It is built.**
> `disqualifiers-card.tsx` is a working pass/fail/N-A checklist with notes. The `disqualifiers`
> table simply has **zero seeded rows**, so the section renders empty. T28 is a data task.

---

### T28 · Seed the disqualifier list

**Why** — the section appears empty and reads as broken.

```
The disqualifiers table and its admin UI already exist and function; there are simply
zero rows, which is why the section renders empty and looked unbuilt on the call.

Seed a starter disqualifier list into supabase/seed (reference data the client edits —
NOT a migration). Draw the initial list from docs/SDB-Portal-Config-Reference.md §3 and
confirm the set with Rebecca.
Add admin CRUD for disqualifiers if not already exposed under /admin/settings.
```

---

### T29 · One-click "Disqualify" action with reason and notes

**Why**
> **1:04:30** — *"you could just have a button on the top of that section that they just hit disqualified. That puts everything in motion, says that it's that field of why they were disqualified, and then gives them the option to add any additional notes if they want."*

**Open question** — does disqualifying set `candidates.pool_status = 'do_not_use'` (person-level), or
only fail the assignment (job-level)? These are different scopes. Clarify before building.

```
Add a "Disqualify" action to the candidate detail page that:
- marks the candidate disqualified
- records WHICH disqualifier/field triggered it
- opens an optional notes field
- writes an events row (CLAUDE.md rule 6 — every state change writes an event)

Reuse the existing rejection / rejection_reasons machinery where it fits rather than
inventing a parallel concept — propose which, and why, before building.

Clarify with Haider: does disqualifying set candidates.pool_status to 'do_not_use'
(person-level, affects all requisitions) or only fail this assignment (job-level)?
These are materially different scopes.
```

---

### T30 · Client-side DQ during candidate review

**Why**
> **1:05:30** — *"on the client side, when the client is reviewing the candidate's information, I think it might make sense to have DQ on most of the fields as a button, and then they can hit that, and it links that section of why they were disqualified."*
> **1:06:00** — *"once we get more into AI, AI can then give feedback to the recruiter of candidates' preferences, patterns they're seeing in certain segments that they're disqualifying so that we know not to send them any candidates that have these kinds of things."*

**Value** — this is the structured input behind the rejection-reasons report she reacted well to
(*"I love this. Instant data that we can give to marketing itself"* — 30:20).

```
Extend the client candidate-review flow so a client can disqualify against a SPECIFIC
field/attribute, rather than only an overall rejection reason.
Store the field key alongside the rejection so the rejection-reasons report can group by
attribute — this is the input for the future AI pattern feedback she described.

Must respect the PII gate: a client can only DQ on fields they can actually SEE at that
assignment's stage. Reuse apps/api/src/repositories/client-visible.repo.ts; never query
the candidates table directly for a client caller (CLAUDE.md rules 3-4).
```

---

## Phase 8 — Post-hire tracking

---

### ✅ T31 · 30/60/90-day tracking and auto-close

**Why**
> **36:50** — *"under hired, let's have it automatically say first 30-day period, 60-day, 90-day, because until the 90 days has passed, that position is technically in a trial period."*
> **37:53** — *"that progress bar will be for the client, but it's also something that would need to be inside of our pipelines as well, so we can see of the candidates we've placed, how many are in a 30, 60, 90 day period."*
> **38:10** — *"once they're post 90 days, it's closed."*

**Blocked by** — D3 (90-day vs 12-month conflict).
**Also blocked by** — the `README.md` exclusion: *"Post-placement handheld-tier tracking — Schema hook only."*

```
BLOCKED on D3 (90-day vs the 12-month replacement guarantee recorded in README.md).
ALSO BLOCKED: docs/README.md's exclusion table lists post-placement tracking as out of
scope (schema hook only). Rebecca has now requested it — get explicit confirmation that
the exclusion is lifted before building anything.

Add post-hire milestone tracking to placements:
- derived 30/60/90-day milestone dates from start_date
- current milestone shown on the client progress bar under "Hired"
- an admin view of all placements grouped by milestone window
- auto-close the position once the guarantee window elapses (scheduled job, following
  the existing node-cron pattern in apps/api/src/jobs/)

placements.guarantee_end_date already exists — reuse it, do not duplicate.
```

---

## Phase 9 — Question & form builder

---

### ✅ T32 · Separate Client and Candidate question libraries

**Why**
> **26:00** — *"there's the candidate side of questions and there's the client side of questions, and for both of them there should be a different library of questions, and obviously the ability to create your own custom ones."*
> **26:20** — *"I like this where you can drag and drop them and edit it just like GHL into a nice clean form, and then save that as this candidate form, this client form."*

**Current state** — one question bank with `question_audience` = `client` | `internal`.

**Constraint** — AC-IF-02 guarantees internal questions are never exposed on the public endpoint
under any query parameter. Preserve that.

```
Extend the question engine to support two distinct libraries: CLIENT questions (intake,
existing) and CANDIDATE questions (new — for candidate intake/profile).

The question_audience enum is currently ('client','internal') — EXTEND it rather than
replace, and preserve the guarantee that internal questions are NEVER exposed on the
public intake endpoint (AC-IF-02).

The admin Question Manager gains a library switcher. Reuse the entire existing renderer,
snapshot, and validation pipeline — do NOT fork it. 03-INTAKE-FORM-ENGINE §3.5 already
establishes one engine with multiple entry points.
```

---

### T33 · "Add this to the library?" prompt on question creation

**Why**
> **27:11** — *"every time you create a new question for a client or candidate, it prompts you: do you want to add this to the library? Because it could be something that's just for a one-off position, that there's low odds that we're ever going to care about this question ever again."*
> **27:44** — *"We don't want to clutter it up."*

```
When creating a question, prompt whether it should be saved to the reusable library or
remain a one-off for this form only.
Add `is_library_question boolean not null default true` to questions.
One-off questions are excluded from the library browser but continue to work normally in
the form they were created for, and keep the same question_snapshot guarantees
(03-INTAKE-FORM-ENGINE §1.4).
```

---

### T34 · Stackable modular question defaults

**Why**
> **28:49** — *"Is it a leadership position? Is it a creative position? Is it a tech position? There's all these different variants."*
> **29:00** — *"what would be great is if we added the standard default and then modular defaults — so tech position, leadership — and we can stack the defaults."*
> **29:26** — *"we could have our base and then we could also add a tech and a leadership and we could stack them. Then we're 80% there for a position."*

**Open question** — this overlaps with the existing `question_role_scopes` mechanism. Determine
whether packs replace or complement role scoping.

```
Add composable question "packs" that stack onto a base set.
Example: Base + Tech + Leadership = the assembled question set for a position.

Model as named collections of question references (a question may belong to several
packs). When building a form, an admin picks a base pack plus any number of modular packs;
the union is de-duplicated by question key, preserving order.

This sits ON TOP of the existing question_role_scopes mechanism — evaluate whether packs
replace or complement role scoping, and propose which, before implementing.
```

---

## Phase 10 — Candidate data capture

> **SCOPE DECISION (28 Aug 2026, Haider).** There will be **no candidate portal** — no candidate
> role, no candidate login, no authenticated candidate surface. Candidate data enters the system
> through **exactly three sources**, and no others:
>
> | # | Source | Status |
> |---|---|---|
> | 1 | **Public registration form** (`/register`) | New — T38 |
> | 2 | **Admin manual entry** (`/admin/candidates/new`) | Already built |
> | 3 | **Inbound webhook** (`POST /candidates/webhook`) | Already built |
>
> This is a standing project rule. Any future request that implies a candidate logging in should be
> checked against it before being built.

---

### ✅ T38 · Public candidate registration form

**Why** — candidates currently have no way to enter their own information. The `user_role_key` enum
has no candidate value, so a candidate cannot hold an account at all; every candidate record today is
typed in by a recruiter or pushed in by a webhook. That makes the pool only as complete as the person
entering it, and it is why `candidates.data_completeness` exists with an `incomplete` flag.

Rebecca's framing (13:25):
> *"Whenever somebody comes into our pool, we should automatically collect all of those things"* —
> resume, one-way interview, assessments.

**What it is** — a public, branded, multi-step form at `/register`, built on the **existing question
engine** (`03-INTAKE-FORM-ENGINE.md`), not a bespoke form. Same machinery that renders the client
intake form: categories become named steps, conditional questions, server+client validation from one
schema, and per-answer question snapshots.

**Sections** (each a question category, so Rebecca can reorder/edit them herself):
1. Personal information
2. Location & availability
3. Language & communication
4. Professional experience
5. Skills & tools
6. **Typing test** (T10)
7. Documents — CV, photo, work samples
8. Consent

**Confirmed inclusions**
- **File uploads ARE in scope** (Haider, 28 Aug) — CV at minimum. A candidate record without a CV is
  of little use, and this is a primary intake path.
- **Typing test is a section here** (T10), not a separate surface.
- **Consent is captured here.** `has_consent_to_share_profile` / `consent_captured_at` /
  `consent_source` already exist. Today an admin records consent by hand, and without it presenting
  the candidate is rejected with `422 CONSENT_MISSING` (AC-PL-05). Capturing it from the candidate
  directly, with a timestamp, is a material improvement.

**Where submissions land** — as **unvetted**, never presentable until a human reviews:
- `source: 'inbound'` (the enum value already exists)
- `submission_channel`: needs a new `'self_registration'` value (currently `manual|webhook|csv_import`)
- `vetting_status: 'not_started'`
- `data_completeness` computed by the existing rules
- writes an `events` row, and one `webhook_ingest_log`-equivalent audit row

**Reuse — already built, do not rebuild**

| Existing | Reused for |
|---|---|
| Question engine + renderer | The whole form |
| Multi-step category grouping (05 §5 req 5) | The sections |
| Conditional visibility | Follow-up questions |
| `styles/tokens.css` + logo | Branding |
| Public rate limiter (60/min/IP) | Abuse control |
| Signed-upload flow | Document uploads |
| Confirmation screen pattern | Post-submit |

**PRD conflict** — `README.md` excludes *"Candidate self-signup, candidate-facing portal — Post-MVP."*
This task is candidate self-signup. **Needs Rebecca to lift that exclusion before build.**

**Blocked by** — T32 (candidate question library), D8 (upload hardening).

```
Build a public candidate registration form at /register.

CRITICAL — build it on the EXISTING question engine (03-INTAKE-FORM-ENGINE), the same
one behind the client intake form. Do NOT hand-roll a form. Categories become steps;
conditional logic, validation, and question snapshots all come for free, and Rebecca
can edit the questions herself without a deploy.

Requires the CANDIDATE question library from T32 (question_audience currently only has
'client' and 'internal'). Preserve AC-IF-02: internal questions must never be exposed
on any public endpoint.

Submissions create a CANDIDATE (not a client + requisition like /intake does):
- source: 'inbound', vetting_status: 'not_started'
- add a 'self_registration' value to submission_channel
- never presentable to a client until a human vets it
- write an events row for the submission

Includes file upload (CV at minimum) — see D8 for the hardening required, since the
current signed-upload flow assumes an authenticated admin (06-BACKEND §6).
Includes the typing test as a section (T10).
Captures consent into has_consent_to_share_profile / consent_captured_at / consent_source.

De-duplicate on email: a repeat registration updates the existing candidate rather than
creating a second record (mirror the webhook's externalId de-dup in
services/candidate-webhook.service.ts).

Public endpoints are rate-limited to 60 req/min/IP by the existing global limiter.
```

---

### T10 · Typing speed (WPM) field + in-form typing test

**Why**
> **18:01** — *"on typing, it would include words per minute. Or, you know what, let's just have that be a flat field. They should always put words per minute. And then let's also have it pop out a typing test if they don't know."*
> **20:08** — *"I'm sure it would be really easy to have AI build a typing test, right?"*
> **20:16** — *"as soon as they do it, they can do it a couple times. They can retake it as many times as they want, and it would log their average."*
> **20:26–20:41** — Haider: *"Average or highest?"* Rebecca: *"Let's do average. Let's do average."*

**Two parts, not one**
1. A **plain WPM field** — if the candidate knows their speed, they type the number.
2. A **real typing test** in the form — if they don't. Unlimited retakes; the system stores every
   attempt and reports the **average**, explicitly not the best.

**Where it lives** — a section of the registration form (T38). Admins can also enter the WPM figure
directly on the candidate record for candidates who arrived by webhook or manual entry.

```
Add typing speed to the candidate record:
1) Migration: candidates.typing_wpm_average int null,
   candidates.typing_test_attempts int not null default 0.
2) A plain editable WPM number field in the consolidated Skills section (T7), for
   admin entry.
3) A self-contained typing test component (60s, standard prompt text) that records
   each attempt and recomputes the AVERAGE across attempts — NOT the best score.
   Unlimited retakes, per Rebecca's explicit instruction.
4) Surface the test as a section of the registration form (T38).

Store attempts so the average is recomputable; do not store only the running mean.
```

---

### T36 · One-way video interview

**Why**
> **4:22** — *"I like a one-way video interview... I think it was called SparkHire."*
> **6:37** — *"the important thing is just a portal to be able to collect a one-way interview."*
> **7:00** — *"those would be submitted and there would be somebody internally to review the submissions and then approve them."*

**⚠️ Changed by the no-portal decision.** Rebecca originally described this sitting *between pipeline
stages* — a candidate is sourced, then asked to record. With no candidate portal, the only place a
candidate can record is the registration form.

**Proposed adaptation — needs Rebecca's confirmation:** the video is recorded **once, at
registration**, as a general introduction, rather than per-role later in the pipeline. Her own
"collect everything at pool entry" framing (13:25) supports this, but it is a real reduction from
what she described and should not be assumed.

**Consequence to be explicit about:** candidates who arrive by webhook or admin entry will have no
video, because they never see the form.

**Blocked by** — Rebecca's confirmation of the reduced scope; T38.

```
BLOCKED pending Rebecca's confirmation that a single general video at registration is
acceptable in place of per-role videos between pipeline stages.

Build one-way video capture as a section of the registration form (T38):
- admin-configurable prompts
- candidate records in-browser
- stored via the existing signed-upload flow (NFR-4 25MB and NFR-5 mp4/webm already cover it)
- an internal reviewer approves or rejects during vetting

Prefer browser-native MediaRecorder over a third-party embed — it avoids a new vendor
and keeps the files in Supabase Storage.
The client NEVER sees these before the candidate is presented.
```

---

### T35 · Candidate portal foundation — ❌ CANCELLED

**Cancelled 28 Aug 2026 by Haider.** No candidate portal will be built: no candidate role, no
candidate login, no authenticated candidate surface. Candidate data enters through the three sources
listed at the top of this phase.

This also restores alignment with `README.md`, which already excluded a candidate-facing portal as
post-MVP — so no exclusion needs lifting for this item.

---

### T37 · Candidate self-service profile fields — ❌ CANCELLED (absorbed into T38)

**Cancelled 28 Aug 2026 by Haider.** Candidates fill their own information **once**, through the
registration form (T38), rather than maintaining a profile in an ongoing portal.

The field-permission rule from the original task still applies to T38 and must be enforced there:
these remain **admin-only** and must never appear on any candidate-facing form —

```
recruiter_rating, watch_points, red_flags, recruiter_recommendation,
proactivity_rating, attention_to_detail_rating, communication_rating,
energy_presentation_rating, vetting_status
```

---
## 13. Deferred — explicitly not now

Each was raised on the call and explicitly pushed out. **Do not build these.**

| Item | Her words | Timestamp |
|---|---|---|
| AI resume screening / matching | *"that'll come later. There's no rush... we're not on a time crunch, which is refreshing."* | 1:09:25 |
| AI feedback on DQ patterns | *"once we get more into AI as a part of all this"* | 1:06:00 |
| Proprietary assessment tool | *"it's not anything worth throwing your way at the moment"* | 13:25 |
| Candidate availability sync / AI scheduler | *"not a today problem for sure... in six months"* | 12:33 |
| Stripe / auto-charge $2,500 | *"eventually we could automate"* | 53:00 |
| Candidate pool marketplace | discussed, no build decision | 44:10 |
| Admin access permissions review | *"we'll just on our next call"* | 1:20:05 |
| On-site staffing | *"I don't really want to mess with that. That's a whole different game."* | 59:20 |

---

## 14. Suggested build order

Revised 28 Aug 2026 to reflect what has actually shipped.

| | Tasks | State |
|---|---|---|
| **Done** | T1, T2, T3, T4, T10, T13, T16, T21, T31, T32, T38 | Shipped and verified — see the status board |
| **Next** | **T18** | T14 shipped 2 Sep. T18 is blocked on the urgency-vs-priority decision above. |
| **Then** | T6–T9, T11 | Candidate profile restructure — the area Rebecca reacted to most on the call. |
| **Then** | T5, T22–T25 | Client portal: card bubbles, collapsed view, view options, sort/group, 5eOS toggle. |
| **Then** | T28–T30 | Disqualifiers. Remember the UI already exists — T28 is a seeding task, not a build. |
| **Then** | T19, T20 | Approval workflow redesign. Largest remaining unblocked piece; revise the adjacency map first. |
| **Then** | T33, T34 | Question-library refinements. |
| **Blocked** | T12 (D4), T26 (D2), T27 (D6), T36 | Do not start — each is rework if the answer changes. |
| **Skipped** | T17 | Haider, 28 Aug. |
| **Cancelled** | T35, T37 | See Phase 10. |

**Test baseline (2 Sep 2026):** typecheck and lint clean across all three packages;
contracts 201/201; API 52/52; web 279/284. The 5 web failures are pre-existing `p3` timeouts unrelated to any of this work — the
candidate detail page is the heaviest render in the app and exceeds Vitest's default 5s limit on the
current dev machine (Node 24 against a project pinned to Node 20). They pass in isolation and in CI.
A `testTimeout` bump in `vitest.config.ts` would clear them.

**T26 is the single highest-risk item.** Sequence it deliberately, with the migration plan reviewed
before any code is written.

---

## 15. Appendix — what was verified in code

Every claim above was checked against the repository rather than assumed. Specifically:

| Claim | Verified |
|---|---|
| "Languages twice" | `SECTIONS` in `candidate-detail-page.tsx:63-80` contains both `language` and `languages` |
| Skills split three ways | `skills-summary`, `skills`, and `tools` are separate entries in the same array |
| No notes on skills | `candidate_tools` / `candidate_skills` have `proficiency` but no notes column (`02-DATABASE.md` §8.2) |
| `category` column exists | `tools` and `skills` tables both declare `category text` — unpopulated |
| Disqualifier UI exists | `components/disqualifiers-card.tsx` is a complete pass/fail/N-A + notes checklist |
| Disqualifiers unseeded | No `insert into disqualifiers` in `supabase/migrations/` or `supabase/seed/` |
| REQ ID on client card | `client-requisitions-page.tsx:44` renders `requisition.reference` |
| "Submitted X days ago" | `client-requisitions-page.tsx:60` |
| Bubbles source | `stage-count-strip.tsx` iterates `CLIENT_STAGE_ORDER` |
| No 5eOS flag | `clients` table has no such column (`02-DATABASE.md` §4) |
| No priority column | `requisitions` table has `urgency` but no `priority` (`02-DATABASE.md` §7) |
| Guarantee field exists | `placements.guarantee_end_date` (`02-DATABASE.md` §9) |
| Seniority enum | `seniority_level` = `junior`/`mid`/`senior`/`lead`; no skill-level enum exists |
| Overlap question | `requires_us_overlap` is the only seeded hours question in `dev_seed.sql` |
| Region is free text | `requisitions.region_preference text` |
| Stage machine | `ASSIGNMENT_TRANSITIONS` in `services/state-machines.ts:35-49` |
| Client internal notes | `clients.internal_notes` exists; no requisition-level equivalent |
| Cursor pagination | `lib/use-cursor-pagination.ts`, documented in `HANDOFF.md` §2 |

---

*Compiled from the 13 August 2026 call recording. Timestamps refer to the Fathom recording.
Nothing in this document has been implemented.*
