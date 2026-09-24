# Change Requests — Haider + Rebecca Pulse, 21 September 2026

| | |
|---|---|
| **Source** | Fathom call recording, 59 minutes — "Haider + Rebecca Pulse - Staffing DB ATS - September 21" |
| **Attendees** | Haider Jutt (Rank Genics), Rebecca Kallaus (Business Done Better) |
| **Compiled** | 24 September 2026 |
| **Status** | Tiers agreed. Tier 1 in progress |
| **Baseline** | PRD v1.1 FINAL, migrations 0001–0030 applied, deployed to Railway + Vercel |
| **Predecessor** | `CHANGE-REQUESTS-2026-08-13.md` — T1–T38. This document continues at **T39** |

Every task below is grounded in the current codebase — file paths, column names and stored
values were checked against the repo and the live database, not assumed. Where the call was
ambiguous, the ambiguity is recorded and the resolution attributed.

---

## Status board

| Tier | Tasks | State |
|---|---|---|
| **Tier 1 — minor** | T39–T45 | Copy, labels, layout. No schema |
| **Tier 2 — normal** | T46–T57 | New fields, conditional logic, migrations |
| **Tier 3 — complex** | T58–T62 | Post-hire / candidate portal. Deferred until Tiers 1–2 land |
| **Blocked** | T53 (budget basis), part of T56 | See §2 |

Rebecca's own framing of the timeline, 53:42: the small items *"this week"*, with the post-hire
portal needing an estimate before it is scheduled.

---

## 1. Decisions taken on this round

Resolved by Haider, 24 Sep, in answer to the ambiguities below. Recorded with the transcript
evidence that made each one a genuine question rather than a detail.

### R1 — Start part-time duration field: **remove**

The call contradicted itself inside a minute. **14:27** — *"then you don't need this field."*
**15:08** — *"I guess it's fine. You can just leave that one. We'll leave that one."*

**Resolved: remove it.** Once "Start part-time → full-time" is its own engagement option, the
separate duration field is redundant — which is what 14:27 recognised.

### R2 — Urgency reason appears only at `urgent`

Also contradictory. **16:44** — *"when it's above, when it's higher."* **17:05** — *"honestly, I
think it's only needed if it's urgent."*

**Resolved: only when priority is `urgent`.** Hidden at every other priority.

### R3 — "Default values" on manual candidate creation means the default form template

**23:22–24:40**, Rebecca: *"when you create a candidate from here, you should have an option to
fill up our default values… just our default candidate profile."*

**Resolved:** manual creation renders the **default candidate form template** — the same one
served at `/register` — for SDB staff to fill in. Not a second hand-built form; the existing form
engine, reused.

### R4 — Company Culture score lives on the client profile

**0:35–1:41.** A manual 0–100% slider, red→green gradient, *"think of it like a health score."*
Nothing feeds it yet: *"we don't have to have anything connected to it right now."*

**Resolved:** client profile (the admin surface), manual entry only.

### R5 — Two new client fields, banded like team size

**3:27.** Rebecca's phrasing — *"total teams. Size, how many are on their leadership team, and the
number of owners"* — read as three fields on first pass. It is two: **number of owners** and
**leadership team size**, both banded single-selects in the same style as team size. "Total team
size" is the existing `team_size_band`.

### R6 — Candidates get a portal, on hire

**26:09** — *"do candidates have a login to the ATS to edit their profile?"* Haider: *"No."*
Then **38:00–39:23**: once hired, *"that would be a user type would be a team member,"* with
access to their KPIs.

**Resolved:** build the candidate portal. Access is granted **on hire** and is **revocable by
admin, exactly as client portal access is today**. Deferred to Tier 3.

> ⚠️ **This reverses a standing project rule.** `CHANGE-REQUESTS-2026-08-13.md` Phase 10 records,
> 28 Aug: *"There will be no candidate portal — no candidate role, no candidate login, no
> authenticated candidate surface… This is a standing project rule."* It is deliberately
> overridden here, not drifted past. See §2.

---

## 2. Conflicts, blocks and open questions

### C1 — The candidate portal reverses an explicit exclusion — twice

`README.md`'s exclusion table lists *"Candidate self-signup, candidate-facing portal — Post-MVP"*,
and the August document hardened that into a standing rule. T58 lifts both.

Consequences to plan for, not discover:

- `user_role_key` is a Postgres enum with four values and no candidate member. Adding one is a
  migration, and every row of the **AC-AUTH-04 generated permission matrix** — which covers every
  route declaring `config.permission` — gains a case.
- A placed candidate is a `users` row today only if someone made one. Placement must now create or
  link an identity.
- The PII gate (`client_visible_assignments`) governs what a *client* sees. A team member seeing
  their own record is a new axis of visibility with no existing view behind it.

### C2 — `BLOCKED` Budget basis vs engagement type (T53)

**20:42–22:52.** Rebecca wants a Salary / Hourly / Project selector on budget, defaulting to
hourly, with project greyed out. But `engagement_type` is already `full_time | part_time | project`
and `budget_unit` is already `hourly | monthly`. Whether the new selector *is* one of those, or a
third concept, decides whether this is a label change or a migration.

**Haider, 24 Sep: to be confirmed with Rebecca.** Nothing in T53 starts until it is.

### C3 — `OPEN` How an un-hired candidate accepts an invitation (T56)

**25:46–26:09** — the invite *"would fire an email to them saying you've been invited to this job
description. Do you accept?"*

R6 grants a portal **on hire**. A candidate being invited to a position has not been hired, so they
still have no login. The accept/decline therefore needs a tokenised link, in the shape of the
existing `POST /auth/accept-invitation` flow.

Second half, unresolved since the original PRD: `06-BACKEND.md` §4.2 flags candidate-facing email
as an open decision precisely because *"creating a GHL contact for every candidate would pollute
the CRM with people who are not leads and consume contact allowance."* Its recommendation was a
transactional provider via the reserved `TRANSACTIONAL_EMAIL_PROVIDER_KEY`. This request is the
first thing to actually need that decision.

### C4 — `OPEN` Priority values never confirmed by the client

`low / normal / high / urgent` (migration `0030`) is a vendor proposal that Rebecca has never seen
a list of. She used *"normal"* (16:20) and *"urgent"* (17:05) by mouth, which the set satisfies,
but **T45 depends on `urgent` existing exactly**.

### C5 — Team size band never had options to begin with

Not raised on the call as a data problem, but it is one. See T46 — the stored values have already
drifted, which is the actual cause of the `620` Rebecca reported.

---

## 3. Tier 1 — minor: copy, labels, layout

No migrations. No schema. Nothing here touches the visibility gate.

---

### T39 · "Send brief for approval" → "Send descriptions for approval"

**Why**
> **11:15** — *"I think we call it descriptions. Why don't we say send descriptions for approval?"*

The button sends the job description and the role description together — T16 replaced the single
"brief" with those two — so the old label names a thing that no longer exists.

**Scope** — the button label and its confirmation copy. No behaviour change.

---

### T40 · Headcount → Position Count

**Why**
> **17:18** — *"Headcount. Let's change this to number of position hires."*
> **17:33** — *"Hiring count, position count. Let's do position count… because headcount is a little bit confusing."*

**Scope** — visible label only, both portals. The column stays `requisitions.headcount`, as does
the contract field `headcount` — this is the T1 rule: rename the word, never the identity.

---

### T41 · Overlap → Day Start Time / Day Finish Time

**Why**
> **15:39** — *"let's just say, day start, day start time, day finish time."*
> **15:54** — Haider: *"Much simpler."*

"Overlap" described the mechanism (the window in which a candidate's hours overlap the client's),
not the thing being entered. Two labels for `overlap_start` and `overlap_end`.

**Scope** — position detail and the intake question wording. Columns unchanged.

---

### T42 · Member "Role" → "Access"

**Why**
> **5:09** — *"If I remember, you know, instead of role, put access."*

**Files** — `apps/web/src/features/clients/components/edit-member-dialog.tsx:85`, and the members
table header.

---

### T43 · "Principal" → "Approver"

**Why**
> **5:48** — *"principal, that word can have multiple meanings. Principal usually means, like, I associate that with the owner… But here you're just giving it, they have the authority to approve the brief."*
> **6:50** — *"I think to just say approver is fine."*

She tried and rejected "decision maker" (6:34) on the grounds that the person may only be
authorised to edit, not to decide.

**Scope** — every user-visible instance across the client profile, position detail and client
portal. The checkbox becomes **"Has authority to approve the brief."**

**Do not rename** — `client_members.is_principal`, `requisitions.principal_user_id`, the
permission key `requisition.approve_as_principal`, the notification event
`principal_approval_requested`, or the requisition status `pending_principal_approval`. The status
is already scheduled for renaming by **T20**, on its own migration; doing it here would collide.

**Widest task in Tier 1** — the word appears in labels, chips, empty states and toasts.

---

### T44 · Move Portal access to the bottom of the rail

**Why**
> **7:21** — *"Portal access you want to revoke on, give them access to login. Yeah, I think that's fine. Just put that at the bottom."*

**Files** — `apps/web/src/features/clients/client-detail-page.tsx:232`. Card order only.

---

### T45 · Urgency reason — rename, reorder, and show only at `urgent`

**Why**
> **16:27** — *"just say, then say urgency reason and flip these two."*
> **16:40** — Haider: *"And it only comes when you select urgency."*
> **17:05** — *"honestly, I think it's only needed if it's urgent. So this would disappear unless it's urgent."*

**Scope** — `requisitions.urgency` is relabelled **Urgency reason**, rendered **below** Priority,
and shown only when `priority === 'urgent'` (R2).

**Careful with the existing value.** `urgency` holds the client's stated timeline captured at
intake; `0030`'s comment is explicit that it is *not* the same field as `priority`. Hiding the
input must not clear the stored value — a position dropped from `urgent` back to `normal` keeps
what it already said, it simply stops offering the field.

**Depends on** — C4.

---

## 4. Tier 2 — normal: fields, logic, migrations

Summarised here; each gets its detail when Tier 1 lands.

| # | Task | Notes |
|---|---|---|
| **T46** | Team size band → real single-select bound to the `team_size` question's options; render the label; backfill drifted rows | The `620` bug and the single-select ask are one fix |
| **T47** | Number of owners + leadership team size, banded like team size | R5 |
| **T48** | Company Culture score — 0–100 slider, red→green | R4. Gradient from `tokens.css`; AC-UI-01 forbids raw hex |
| **T49** | Company Time Zone → dropdown | Mirror the overlap-timezone control |
| **T50** | Engagement: add "start part-time → full-time"; grey out part-time and project; drop the duration field | R1 |
| **T51** | Region preference: country picker, LATAM–All default, + Spain and Portugal, disclaimer on specific picks | Supersedes T15 |
| **T52** | Role description as link upload + iframe preview, keeping the typed field | AI rephrase explicitly deferred |
| **T53** | Budget: basis selector, hourly default, project greyed, unit above min/max, USD fixed | **BLOCKED** — C2 |
| **T54** | Manual candidate creation renders the default form template | R3 |
| **T55** | Open candidate profile in a new tab from the picker | |
| **T56** | Invite candidate → position, with email | Accept mechanism **OPEN** — C3 |
| **T57** | Manual pipeline stage move | Must route through `advanceAssignment()` — CLAUDE.md rule 6 |
| **T58a** | Admin master toggle for offered engagement types / budget bases | Needs `/admin/settings`, still a `PlaceholderPage` |

### On the master toggle (T58a)

**21:43** — *"You just have it where it's grayed out and you can't click it… But then on the
backend toggle, that way we can, if we turn it on in six months from now, you can just click one
thing, and then now we do offer project-based."*

`app_settings` already exists for exactly this shape of configuration (`02-DATABASE.md` §10). The
cost is not the toggle, it is that `/admin/settings` has never been built.

---

## 5. Tier 3 — complex: post-hire / candidate portal

Deferred until Tiers 1–2 are done. Scoped here so the estimate Rebecca asked for (53:42) has
something behind it.

| # | Task |
|---|---|
| **T59** | Candidate portal foundation — role, access on placement, revocable, permission matrix |
| **T60** | KPI templates per role + link upload with iframe preview |
| **T61** | Automated check-ins at weeks 1, 2, 4, 6, 8, 12 |
| **T62** | "Hired" navigation section |
| **T63** | 90-day swim-lane view, per-client and SDB-wide |

**What she is actually buying.** 28:41 is the clearest statement of intent in the call and worth
keeping in front of whoever builds this:

> *"we're not tracking KPIs, we're just creating the portal for KPIs to be, to have notes on them
> for those 90 days. Because that way we need to be able to have the client be accountable… If
> there's just no communication, 80 days go by and they're like, ah, this person isn't working
> out. I want somebody new. If that's the only communication we've had with them, that doesn't
> work."*

The feature is an accountability record, not a performance-management tool. 37:51 — the client
*"will not be eligible unless they've actually submitted certain things and it's all in the
portal."*

**Shape, from the call:**

- **KPIs** are a link upload (Google Drive) with an iframe preview, 30:44–31:16. Built from
  **role-based templates**, *"the same format that you did for the forms"* (37:25) — a library per
  role, selected then edited per placement. Admin and client edit; team member views only (35:49).
- **Check-ins** at weeks 1, 2, 4, 6, 8, 12 (29:23). Team member: a 1–10 rating, the only required
  field, plus optional notes. Client: same cadence, optional.
- **Swim lanes** (45:03–51:01): a 90-day axis, one lane per placed team member, coloured by rating
  — *"If the team member and the client are both rating high ratings, 8 to 10, then their circle
  is green"*. Two levels, per-client and SDB-wide. Filter by client, days elapsed, rating; sort by
  client, team member, rating. Three ratings tracked: client, team member, average.

**Explicitly not in this phase.** Messaging between SDB and team members — Rebecca weighed it and
declined for now: *"We do not need it at this stage. This could be done in January"* (43:53).

---

## 6. Deferred — do not build

| Item | Her words | Timestamp |
|---|---|---|
| Messaging / team-member inbox | *"We do not need it at this stage. This could be done in January"* | 43:53 |
| AI anywhere in the ATS | *"I want to finish all the non-AI things first, have those be finished, and then take an AI approach to everything"* | 32:09 |
| AI rephrase on role description | Same — the typed field ships without it | 32:35 |
| Attention queue changes | *"for now, this is great. We don't need to touch anything"* | 53:18 |
| Job title as a dropdown | Haider proposed it; *"I think job title can be a fill-in. That's totally fine"* | 5:09 |

Not build tasks, recorded so they are not lost: connect with Juan about AI within 24 hours
(32:46), and the Referli mobile-app feasibility question under Lovable (56:33) — a different
product, out of scope here.

---

## 7. Build order

1. **Tier 1** — T39–T45. One pass, one commit each.
2. **Tier 2** — T46–T48 (client profile) → T49–T52 (position detail) → T54–T57 (candidates).
   T53 waits on C2; T58a waits on `/admin/settings`.
3. **Tier 3** — estimate first, then T59–T63.

---

## 8. Appendix — what was verified in code

Checked against the repo and the live database on 24 Sep, not assumed.

| Claim | Verified |
|---|---|
| Team size band is free text | `edit-client-sheet.tsx:32` — `z.string().max(100)`, rendered as `<Input>` at `:159` |
| …but the question is a single-select | `question_options` for `team_size`: `1_5`, `6_20`, `21_50`, `50_plus` |
| …and stored values have already drifted | `clients.team_size_band` holds `"1_5"` for one client and `"6-20"` for another — one raw option value, one hand-typed. Neither is the label `6–20` |
| "Role" label on members | `edit-member-dialog.tsx:85` |
| Portal access card position | `client-detail-page.tsx:232` |
| Headcount is a real column | `requisitions.headcount`, `fields-card.tsx:39` |
| Overlap fields exist | `overlap_start`, `overlap_end`, `overlap_timezone`; `fields-card.tsx:46` |
| Urgency is free text and distinct from priority | `requisitions.urgency text`; `0030_requisition_priority.sql` states why they cannot be one field |
| Priority enum values | `low, normal, high, urgent` — in rank order |
| No candidate role exists | `user_role_key` = `super_admin, admin, client_admin, client_user` |
| `/admin/settings` is unbuilt | `PlaceholderPage` in `apps/web/src/routes/admin/index-pages.tsx` |
| `app_settings` exists for toggles | `02-DATABASE.md` §10 |

---

*Compiled from the 21 September 2026 call recording. Timestamps refer to the Fathom recording.*
