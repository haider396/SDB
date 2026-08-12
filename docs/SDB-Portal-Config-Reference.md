# Staffing Done Better Portal — Configuration Reference

**Purpose:** standing reference doc for role taxonomy, screening questions, and intake question bank. This is the input file for the CloudCo PRD. Everything here is configuration content, not architecture.

**Status:** v0.1 — draft, awaiting Rebecca's inputs and Yener Fathom recordings
**Owner:** Haider Jutt (Rank Genics)
**Last updated:** 12 Aug 2026

> **Persistence note:** Claude's working container resets between sessions. Re-upload this file at the start of any future session so it can be updated in place rather than rebuilt from scratch.

---

## 0. Scope context (locked)

**In MVP:** admin panel, client intake form, role taxonomy + admin configuration, candidate vetting and assignment, candidate stage tracking, client portal with admin-granted access after payment.

**Out of MVP (confirmed excluded):**
- Public marketing site and cost-of-living map
- Upwork replacement / candidate marketplace / candidate self-signup
- Subscription tiers and candidate pool community
- Proprietary assessment tool (Culture Index alternative)
- Team-composition dashboards and AI interpretation
- 5eOS module reuse — no shared-architecture work, no 5eOS considerations in design
- Client intake forms built in GoHighLevel — forms are native to the app

### 0.1 Confirmed decisions (round 2, 12 Aug)

| Area | Decision |
|---|---|
| Client users | Multiple users per client company. Client owner = `client_admin` (not super admin). Client admin can invite their own staff. |
| "Up next" role suggestions (M7) | **Out of MVP.** |
| Candidate entry | Manual admin entry + file upload (CV etc. to Supabase Storage). Plus an inbound webhook endpoint so third-party platforms can POST candidate records. |
| Candidate seed data | None exists. Build against dummy data; spreadsheet import later. |
| Notifications | All five event triggers required. Email delivered via GoHighLevel / LeadConnector, authenticated with a private integration token. Workflows built in GHL, app fires the trigger. |
| Payment | Manual, outside the system. Admin toggles portal access. |
| PRD deliverables | Branded PDF (for Rebecca) + Markdown handoff files (for Claude Code build). |
| Timeline | No hard deadline. |

---

## 1. Role taxonomy

Hierarchy: **Engine → Department → Role**

### 1.1 Engines (in scope for staffing)

| Engine | In scope | Notes |
|---|---|---|
| Client Experience | Yes | Confirmed on 5 Aug call |
| Operations | Yes | Confirmed on 5 Aug call |
| Brand | Yes | Confirmed on 5 Aug call |
| Revenue | **No** | Rebecca: SDB does not staff revenue |
| Leadership | **No** | Rebecca: SDB does not staff leadership |

**Open:** is the engine list above the complete 5eOS engine set, or are there other engines that simply aren't staffed? Needed only for label accuracy in the admin dropdown.

### 1.2 Departments

_AWAITING INPUT — Rebecca_

| Engine | Department | Notes |
|---|---|---|
| Client Experience | TBD | |
| Operations | TBD | |
| Brand | TBD | |

### 1.3 Roles

_AWAITING INPUT — Rebecca + Yener recordings_

| Engine | Department | Role title | Seniority tiers | Notes |
|---|---|---|---|---|
| | | TBD | | |

**Design decision:** taxonomy is fully admin-configurable (create/edit/archive engines, departments, roles) so an empty or partial taxonomy at launch is not a blocker. Ship with whatever is confirmed; Rebecca adds the rest herself.

---

## 2. Client intake question bank

### 2.1 Structure

Two question layers:

1. **Universal questions** — asked on every intake regardless of role. Drafted below as v0.1.
2. **Role-specific questions** — conditional, attached to a role (or department) in the taxonomy. Content pending Rebecca + Yener recordings.

Question types the form engine must support: short text, long text, single select, multi select, number, currency range, date, scale (1–5), file upload, yes/no with conditional follow-up.

### 2.2 Universal intake questions — DRAFT v0.1 (Haider)

Marked `[R]` = required.

**Section 1 — Company & contact**
1. Company name `[R]`
2. Company website
3. Industry `[R]`
4. Current team size (select: 1–5 / 6–15 / 16–50 / 51–200 / 200+) `[R]`
5. Primary contact name `[R]`
6. Contact job title `[R]`
7. Contact email `[R]`
8. Contact phone / WhatsApp
9. Company timezone `[R]`
10. Preferred communication channel (select: email / Slack / WhatsApp / phone)

**Section 2 — The role**
11. Engine (select: Client Experience / Operations / Brand) `[R]`
12. Department (conditional on engine) `[R]`
13. Role title / what you'd call this person `[R]`
14. One-line summary of what this person is for `[R]`
15. Is this a new seat or a replacement? (select: new seat / backfill / expanding existing function) `[R]`
16. What's breaking right now because this seat is empty? (long text) `[R]`
17. How many people are you hiring for this role? (number, default 1) `[R]`

**Section 3 — Scope of work**
18. Top 3–5 outcomes you need in the first 90 days (long text) `[R]`
19. Describe a typical day/week for this person (long text) `[R]`
20. Tools and software they must already know (multi select + "other") `[R]`
21. Tools they'll need to learn on the job (multi select + "other")
22. Will they own a process end-to-end or support someone else's? (select: own / support / both)

**Section 4 — Requirements**
23. Minimum years of relevant experience (select: <1 / 1–2 / 3–5 / 5+) `[R]`
24. Must-have skills or experience (long text) `[R]`
25. Nice-to-have skills (long text)
26. Spoken English requirement (scale: basic / conversational / professional / native-equivalent) `[R]`
27. Written English requirement (scale: basic / conversational / professional / native-equivalent) `[R]`
28. Industry-specific experience required? (yes/no → if yes, which)
29. Certifications or qualifications required?
30. Portfolio or work samples required? (yes/no)

**Section 5 — Working arrangement**
31. Full-time or part-time? (select) `[R]`
32. Hours per week (number) `[R]`
33. Required overlap hours (from–to) and against which timezone `[R]`
34. Target start date `[R]`
35. Expected engagement length (select: ongoing / 3 months / 6 months / project-based) `[R]`
36. Who provides equipment? (select: candidate / client / TBD)

**Section 6 — Budget**
37. Monthly budget range (currency range, USD) `[R]`
38. Is the budget flexible for an exceptional candidate? (yes/no) `[R]`
39. Any bonus, commission or review structure?

**Section 7 — Team & culture**
40. Who does this person report to (name + title) `[R]`
41. How many people are on their immediate team?
42. Working style you need (select: highly autonomous / needs clear direction / mix) `[R]`
43. Communication style you prefer (select: async-first / daily check-ins / heavy real-time)
44. Name 2–3 things that would make someone fail in this seat (long text) `[R]`
45. Absolute deal-breakers (long text)

**Section 8 — Hiring process**
46. Who will interview candidates (names + titles) `[R]`
47. How many interview rounds do you run? (number) `[R]`
48. How fast do you need this filled? (select: ASAP / 2–4 weeks / 1–2 months / no rush) `[R]`
49. Anything else we should know? (long text)

**Internal / admin-only fields (not client-visible)**
- Lead source
- Sales owner
- Internal notes
- Priority flag

### 2.3 Recruiter intake framework — extracted from Ximena Toaspern call (18 Jun)

Source: 87-min call, Ximena Toaspern (ex-VL recruiting manager, now working with Yener) running her standard client intake on Rebecca for a CSM role.

**Her question sequence, in order asked:**

1. Is this role for your company or for your clients?
2. Do they need knowledge of your specific tools (ClickUp, GoHighLevel), or is general CRM / tech-savviness enough?
3. What's driving this hire — growth, or replacing someone?
4. What's currently missing in your team that this person should fill?
5. Do you have a manager for this team, or are you the direct manager?
6. Anything specific I should know about that manager — how they work, how they communicate — that affects who we recruit?
7. Six months from now, what should this person be doing for you to say they're killing it?
8. What's the hardest part of the role that usually trips people up in training?
9. **What would immediately disqualify a candidate?** — CV looks great, you take the meeting, you come out and say no. What causes that?
10. What does a typical week look like?
11. How does the team communicate day to day? What tools?
12. What does your company offer someone ambitious? (growth path, advancement)
13. Anything in this search — timeline, budget, or talent availability — that worries you?
14. Do you have a country of preference?
15. Budget / rate range confirmation
16. Timeline — when does this person need to start?
17. How do you handle interviews? Who conducts them, how many rounds, who makes the final call?

**Plus her client-readiness gate**, which she says is always in her intake: *what are you offering this person? Do you have anything in place for them to feel welcome, or do you expect them to know what to do on day one?* She screens clients on onboarding readiness before agreeing to recruit for them.

> **Q9 is the standout question.** Rebecca's reaction: "I don't think I've ever been asked this question. Love it." This is almost certainly the non-standard question she flagged on the 5 Aug call. Treat as required in intake.

**Still awaiting:**

| Source | Status | Notes |
|---|---|---|
| Rebecca's own additions | Not received | She flagged she will add "a lot of things" |
| Yener call transcript | Not received | Haider to supply |
| Haider research on standard screening questions | Partially covered by Ximena set |

### 2.4 Additional intake fields required (from 18 Jun call)

- **Budget with explicit unit.** Clients think hourly ($12–20/hr on Rebecca's team), recruiters quote monthly (Mexico City ~$3,200, Argentina ~$4,000). Store amount + unit + currency, or the two scales collide.
- **Accent level** — separate field from English proficiency. Rebecca treats it independently; "as little accent as possible" for client-facing roles. Drove a country-level exclusion.
- **Region / country preference** — soft preference, not a hard filter. Context: Mexico rated strongest overall; Argentina and Colombia strong for tech and marketing (universities) but Argentina flagged for heavy accent; LATAM only.
- **Job title vs internal role title** — Rebecca learned to advertise "Client Success Manager" rather than "Account Manager" because the latter attracts BPO candidates used to 80–150 accounts when the real cap is 8–10. Advertised title and internal role need to be separate fields.
- **Client onboarding readiness** — short section per Ximena's gate.
- **Benchmark person** — free text: "who on your team is the bar for this role, and what makes them it?" Rebecca answered with Carlos and Stanley, and it produced the most useful signal in the call.

---

## 2.5 Interview and panel configuration (from 18 Jun call)

Recruiter workflow as stated by Ximena, end to end:

`Post on LinkedIn → recruiter pre-vets and interviews for culture fit → presents shortlist to client → client selects who to interview → recruiter coordinates scheduling (client + candidate + recruiter) → client interviews → decision`

BDB's own internal panel pattern: EA and engine manager interview separately or together; only on dual approval does it escalate to Rebecca. Implication: requisitions need configurable interview rounds and named interviewers, not a single interview flag.

**Evergreen requisitions:** Rebecca on the CSM role — "I'll need another one in a month, and another in a couple months." Requisitions that close on placement don't model this. Needs a recurring requisition type or a clonable template.

---

## 2.6 Engine → manager mapping (confirmed 18 Jun)

Five 5eOS engines confirmed: **Revenue, Brand, Client Experience, Operations, Leadership.** SDB staffs only Client Experience, Operations, Brand.

Each engine has a designated owner who is the direct manager for hires in that engine (e.g. Mark owns Client Experience and manages CSMs). Schema should allow an engine or department to carry a manager reference, so "reports to" can prefill.

---

## 2.7 Open role question: external recruiters

Ximena is neither SDB staff nor a client. She sources, pre-vets, presents candidates, and coordinates interviews — i.e. most of what was assigned to `admin` in the MVP spec.

**Decision needed:** does the MVP include a `recruiter` role, scoped to assigned requisitions, able to add and advance candidates but blind to other clients and to commercial terms? Recommendation: yes, build it now — retrofitting a scoped role after RLS policies exist is materially more work, and the SDB model depends on external recruiters doing the sourcing.

---

## 3. Rejection reason taxonomies (draft)

Structured reasons + optional free text. Kept here because it's configuration, not code.

**Client-side rejection reasons**
- Skills gap
- Experience level too junior / too senior
- English or communication level
- Culture or working-style fit
- Salary expectation mismatch
- Availability or timezone overlap
- Chose a different candidate
- Role paused or cancelled
- Other (free text)

**Admin-side rejection reasons**
- Failed vetting
- Unresponsive
- Withdrew from process
- Salary expectation out of range
- Better fit for a different client
- Duplicate record
- Other (free text)

---

## 4. Candidate stage list (draft — see chat for rationale)

**Internal, hidden from client:** Sourced → Screened → Vetted
**Client-visible:** Presented → Client reviewing → Interview scheduled → Interviewed → Offer → Placed
**Terminal:** Rejected (admin) / Rejected (client) / Withdrawn / On hold

---

## 5. Open inputs log

| # | Input needed | Owner | Status |
|---|---|---|---|
| 1 | Department list per engine | Rebecca | Open |
| 2 | Role list + seniority tiers | Rebecca | Open |
| 3 | Role-specific screening questions | Rebecca | Open |
| 4 | Yener recruiter Fathom recordings (x2) | Haider | Open |
| 5 | Rebecca's additional intake questions | Rebecca | Open |
| 6 | Review/approve universal intake draft v0.1 | Rebecca | Open |
| 7 | Confirm engine list completeness | Rebecca | Open |

---

## 6. Access control (decided 12 Aug)

**MVP roles:**

| Role | Scope |
|---|---|
| `admin` | Full access. Rebecca, SDB staff, **and external recruiters** all operate as admin in MVP. No recruiter-specific role. |
| `client_admin` | Own company only. Can invite/remove company users, submit requisitions, act on presented candidates. |
| `client_user` | Own company only. Same candidate actions, no user management. |

**External recruiters:** get their own portal logins, operating as `admin`. Webhook remains available and should be built, but whether recruiters use it is undecided.

**Architectural requirement:** roles and permissions must be modelled granularly from day one so new roles and scopes can be added without refactoring. Recommended approach:

- `roles` table (id, key, label, is_system)
- `permissions` table (id, key, e.g. `candidate.create`, `candidate.present`, `requisition.view_commercials`, `client.invite_user`)
- `role_permissions` join table
- `user_roles` join (supports multiple roles per user)
- Optional `scope` column on `user_roles` (null = global, or client_id / requisition_id for future scoped roles)
- Supabase RLS policies read from resolved permissions, not from hard-coded role string comparisons

This means adding a scoped `recruiter` role later is a data change plus policy adjustment, not a rewrite.

---

## 7. Rebecca's client intake question set — extracted from Susie Carder call (5 Aug)

Source: 67-min call. **Dr. Susie Carder** = fractional COO acting as proxy for **Eunicea**, the actual founder/client. First real SDB paying engagement. Role being filled: **Executive Assistant**, replacing an underperforming Pakistan-based hire.

This is Rebecca's own intake framework, in the order she asked:

**Relationship and company context**
1. How long have you worked with the founder? (establishes proxy authority)
2. How big is the team? What's the contractor/employee/part-time mix?
3. How long has the company been around?
4. Where would you place the culture on a spectrum from corporate to casual startup?
5. Do the other team members share your vibe, or do you set the standard?
6. Is the existing team made up of doers or advisors? (Rebecca: "I'm not hiring for advisors and executives — hiring for doers is my strength")

**Benchmarking the current/previous hire**
7. Where is the current person located and what are you paying them?
8. What specifically isn't working about them?
9. What does the founder not like about how they work/write?
10. Are you repositioning them or removing them entirely?

**Hours, timezone, cadence**
11. How many hours are you looking for? Part-time or full-time?
12. If part-time, how many hours and how many days a week? Preference on which days?
13. How soon would this become full-time?
14. What are the founder's working hours, and in which timezone?
15. What are the company's hours? When does the team dissipate for the day?
16. Does the company operate on a single declared timezone? Do you all speak in that timezone?
17. Is the founder a morning or evening person?

**Scope and role shape**
18. How much is this person supporting the founder directly vs doing operational work with the rest of the team? (positions the hire on the EA ↔ Operations Manager spectrum)
19. What types of communication will they handle — sales follow-up, client, lead gen, vendor/partner?
20. What's the whole tech stack — project management, CRM, email, comms?
21. Do you have an AI meeting recorder preference?

**Communication and management style**
22. Does the founder want daily updates and heavy reporting, or is that noise to them?
23. How does the founder communicate? — and specifically: *give me your experience of her, not what she would say about herself.*
24. Does she spell out every detail, or expect the person to infer the gaps and run?

**Onboarding readiness**
25. What does your team-member onboarding process look like? What exists today?
26. Who is the new hire's main point person? Who's the backup?
27. Who handles orientation on tech stack, SOPs, and where things live?

**Security and confidentiality**
28. Do you have a password management system?
29. How confidential is this role? Will they handle sensitive or financial information?

**Close**
30. Anything else on your end you think we missed?

> **Question 23 is the sharpest one in the set** — asking the proxy for their observed experience of the founder rather than the founder's self-description. Should be phrased that way in the form when intake is completed by someone other than the principal.

### 7.1 Structural insight: intake proxy + principal approval

Susie filled the intake; Rebecca then booked a separate 30-minute call with Eunicea to validate the resulting job description and capture "any emotional things, work pacing things, or subconscious things" the proxy might have missed.

**Portal implication:** a requisition needs an intake author and a separate principal approver, with an explicit `pending_principal_approval` state between submission and sourcing. Multiple users per client company isn't just a convenience — the delivery process depends on it.

### 7.2 Structural insight: no unicorns — one requisition may become two hires

Rebecca's framing for EAs: one **primary** skill (executive support) plus at most one **secondary** specialisation (operations coordinator / marketing-creative / sales / tech). Anything beyond that is two people, not one. Susie agreed: "I'd rather have two people that can support her."

**Portal implication:** requisition needs `primary_role` and `secondary_specialisation` fields, and must support splitting into multiple hires / multiple openings.

### 7.3 Service tiers (affects requisition schema)

| Tier | Terms as discussed |
|---|---|
| Standard placement | Placement fee (quoted $2,500, halved for this client). Invoice on this engagement: **$12,500**. SDB sources, vets, presents 1–3 candidates with a personal recommendation, optionally joins interviews. |
| 6-month handheld program | ~$30K+ for six months full-time. Placed candidate stays partly on SDB's team: extra training (GoHighLevel, ops), regular check-ins, back-end coaching, and the client isn't obligated to retain them. |

Expected fill time: **2–3 weeks**. Requisition needs a `service_tier` field; the handheld tier implies post-placement tracking (check-ins, training progress) which is **out of MVP** but shapes the placement record.

Client comms happen in a **shared Slack channel per client** — "we use Slack for all of our clients."

### 7.4 Assessments — confirmed as future, with schema hook

Rebecca has no assessment tool today ("ridiculously expensive"), offers to run whatever the client wants, and wants to build her own and license it out. Susie recommended the **Harrison Assessment** (~$197 per run when licensed; surfaces behaviour under stress rather than just strengths). Culture Index, Predictive Index and Wealth Dynamics also referenced.

**Schema hook only:** a `candidate_assessments` table (provider, type, score, summary, chart/report file, raw payload) lets third-party results be attached now and a proprietary tool slot in later, with zero MVP build cost.

---

## 8. Candidate data model

Design principles:

1. **Wide but normalised.** Repeating structures (tools, files, assessments, interviews, notes, references) go in child tables, not JSON blobs on `candidates`, so they're queryable and filterable.
2. **Client visibility is explicit.** Every field is either internal-only, gated (visible from interview stage), or client-visible. Enforced by a view, not by front-end conditionals.
3. **Stage never lives here.** Pipeline stage lives on the `assignments` table (candidate ↔ requisition).

### 8.1 `candidates` — core table

| Column | Type | Visibility | Notes |
|---|---|---|---|
| id | uuid PK | — | |
| external_id | text unique | internal | For webhook idempotency |
| first_name | text | client | |
| last_name | text | **gated** | Hidden until interview stage |
| preferred_name | text | client | |
| display_name | text generated | client | "Maria G." — pre-interview client view |
| email | citext | **gated** | |
| phone | text | **gated** | |
| whatsapp | text | **gated** | Primary channel for LATAM |
| linkedin_url | text | **gated** | Direct-poach risk pre-interview |
| portfolio_url | text | client | |
| photo_path | text | client | Profile picture |
| country | text | client | |
| region_state | text | client | Drives cost-of-living comparison later |
| city | text | client | |
| timezone | text | client | |
| nationality | text | internal | |
| relocation_status | text | internal | e.g. Venezuelan in Colombia/Spain |
| pool_status | enum | internal | active / passive / placed / unavailable / do-not-use |
| created_at, updated_at | timestamptz | internal | |

### 8.2 Language and communication

| Column | Type | Visibility | Notes |
|---|---|---|---|
| english_spoken_level | enum | client | basic / conversational / professional / native-equivalent |
| english_written_level | enum | client | Rebecca treats these separately |
| accent_strength | enum | client | none / light / moderate / heavy — **separate field**, she rejected Argentina on this alone |
| accent_notes | text | internal | |
| language_assessed_by | uuid → users | internal | |
| language_assessed_at | timestamptz | internal | |
| voice_sample_path | text | client | Lets client judge accent themselves |
| video_intro_path | text | client | |
| writing_sample_path | text | client | Susie's client rejected the incumbent on writing tone |

`candidate_languages` child table: candidate_id, language, spoken_level, written_level, is_native.

### 8.3 Professional background

| Column | Type | Visibility |
|---|---|---|
| years_experience_total | numeric | client |
| years_experience_relevant | numeric | client |
| current_title | text | client |
| current_employer | text | **gated** |
| employment_status | enum | internal (employed / available / serving notice) |
| notice_period_days | int | internal |
| available_from | date | client |
| seniority_level | enum | client |
| primary_role_category | uuid → role_categories | client |
| secondary_specialisation | uuid → role_categories | client (per §7.2) |
| engine | enum | client |
| management_experience | bool | client |
| team_size_managed | int | client |
| client_facing_experience | bool | client |
| us_client_experience | bool | client |
| remote_experience_years | numeric | client |
| industries | uuid[] → industries | client |

`candidate_employment_history`: candidate_id, employer, title, start_date, end_date, is_current, responsibilities, reason_for_leaving (internal).
`candidate_education`: candidate_id, institution, degree, field, start_year, end_year, country.
`candidate_certifications`: candidate_id, name, issuer, issued_date, expires_date, credential_url.

### 8.4 Skills and tools

`candidate_tools`: candidate_id, tool_id, proficiency (enum: aware / working / proficient / expert), years_used, last_used_year.
`candidate_skills`: candidate_id, skill_id, proficiency, verified_by, verified_at.

On `candidates`:

| Column | Type | Notes |
|---|---|---|
| ai_tool_proficiency | enum | Recurring theme in both calls |
| typing_wpm | int | Rebecca explicitly cares — the copy-paste anecdote |
| tech_literacy_rating | int 1–5 | Assessed, internal |

### 8.5 Compensation and terms

| Column | Type | Visibility | Notes |
|---|---|---|---|
| expected_rate_amount | numeric | internal | |
| expected_rate_unit | enum | internal | **hourly / monthly** — the two scales collide otherwise |
| expected_rate_currency | char(3) | internal | Default USD |
| rate_min / rate_max | numeric | internal | |
| rate_negotiable | bool | internal | |
| current_rate_amount / unit | numeric / enum | internal | |
| engagement_types | enum[] | client | full_time / part_time / project |
| hours_available_per_week | int | client | |
| overlap_start / overlap_end | time | client | |
| overlap_timezone | text | client | |
| max_clients | int | internal | Whether they can hold multiple placements |

### 8.6 Remote work environment

Practical LATAM screening data an expert recruiter collects and clients never think to ask for:

| Column | Type |
|---|---|
| internet_speed_down_mbps / up_mbps | numeric |
| backup_internet | bool |
| backup_power | bool |
| computer_specs | text |
| dual_monitor | bool |
| headset_quality | enum |
| workspace_type | enum (dedicated home office / shared / coworking) |
| quiet_environment_verified | bool |
| speedtest_evidence_path | text |

### 8.7 Vetting, scoring and fit signals

| Column | Type | Visibility | Notes |
|---|---|---|---|
| vetting_status | enum | internal | not_started / in_progress / passed / failed |
| vetted_by | uuid → users | internal | |
| vetted_at | timestamptz | internal | |
| screening_call_at | timestamptz | internal | |
| recruiter_rating | int 1–5 | internal | |
| recruiter_recommendation | text | client | Rebecca's "personal stamp of approval" note |
| strengths | text | client | |
| watch_points | text | internal | Her "leadership watch points" concept |
| red_flags | text | internal | |
| autonomy_level | enum | client | needs_direction / balanced / fully_autonomous |
| manages_up | bool | client | Explicit requirement in the EA brief |
| proactivity_rating | int 1–5 | internal | Her single biggest LATAM-vs-Philippines criterion |
| attention_to_detail_rating | int 1–5 | internal | "One typo, it's a no" |
| communication_rating | int 1–5 | internal | |
| energy_presentation_rating | int 1–5 | internal | Monotone / low-engagement is an instant no |
| sales_background_weight | enum | internal | Treated as a caution flag, not a plus |
| ops_background | bool | internal | Positive signal |
| entrepreneurial_ambition | bool | internal | The Carlos signal |
| references_checked | bool | internal | |
| background_check_status | enum | internal | |

`candidate_disqualifier_checks`: candidate_id, disqualifier_id, result (pass/fail/na), notes — turns Rebecca's deal-breaker list into structured, reportable data.
`candidate_references`: candidate_id, referee_name, relationship, company, contact, checked_by, checked_at, outcome, notes.
`candidate_notes`: candidate_id, author_id, body, is_client_visible, created_at.
`candidate_tags`: candidate_id, tag_id.

### 8.8 Assessments (schema only, no MVP build)

`candidate_assessments`: id, candidate_id, provider (Harrison / Culture Index / Predictive Index / Wealth Dynamics / internal), assessment_type, taken_at, score_summary jsonb, report_file_path, chart_image_path, interpreted_by, interpretation_notes, raw_payload jsonb.

### 8.9 Files

`candidate_files`: id, candidate_id, file_type (enum: cv / photo / video_intro / voice_sample / writing_sample / portfolio / certificate / assessment_report / speedtest / other), storage_path, original_filename, mime_type, size_bytes, is_client_visible, uploaded_by, uploaded_at, virus_scan_status.

Plus on `candidates`: `cv_primary_file_id`, `cv_parsed_text` (tsvector for search).

### 8.10 Source and provenance

| Column | Type | Notes |
|---|---|---|
| source | enum | linkedin / upwork / referral / partner_recruiter / inbound / webhook / import |
| source_detail | text | |
| sourced_by | uuid → users | Which admin or external recruiter |
| submitted_via | enum | manual / webhook / csv_import |
| external_system | text | Originating platform for webhook records |
| first_contacted_at | timestamptz | |
| responsiveness_rating | int 1–5 | Unresponsiveness is an admin rejection reason |
| last_activity_at | timestamptz | |
| data_completeness | enum | complete / incomplete — drives the webhook "incomplete" badge |

### 8.11 Consent and retention

| Column | Type | Notes |
|---|---|---|
| consent_to_share_profile | bool | Required before presenting to a client |
| consent_captured_at | timestamptz | |
| consent_source | text | |
| retention_until | date | |
| do_not_present_to_client_ids | uuid[] | Conflict-of-interest and prior-rejection control |

### 8.12 Placement (thin in MVP)

`placements`: id, candidate_id, client_id, requisition_id, start_date, end_date, rate_amount, rate_unit, hours_per_week, service_tier, status, guarantee_end_date. The handheld tier's check-in and training tracking hangs off this later.
