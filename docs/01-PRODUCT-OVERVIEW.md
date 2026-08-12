# 01 — Product Overview

## 1. Problem statement

Staffing Done Better currently runs its entire delivery process through email, Slack, and ad-hoc forms. Client requirements are gathered on calls and transcribed manually. Candidate shortlists are sent as messages. Clients have no way to see where their hire stands without asking. The business has no structured record of why candidates were rejected, which is the single most useful signal for improving the vetting bar.

The portal replaces the chasing with a two-sided workspace: clients submit structured requirements and watch live status; admins run the pipeline privately and present candidates deliberately.

---

## 2. Personas

### P1 — Super Admin (Rebecca)
Solo founder running delivery alongside other commitments. Will not browse dashboards; needs an exception queue showing what is stuck. Owns the intake questionnaire content and will edit it frequently and without warning. Needs to configure questions herself without a developer.

**Primary needs:** know what needs attention today; present candidates in two clicks; change intake questions without asking anyone.

### P2 — Admin (SDB staff and external recruiters)
External recruiters such as Ximena operate under the same `admin` role in MVP. They source, vet, add candidates, advance stages, and coordinate interviews. They do not have a reduced scope in v1, but the permission model must allow one to be added later without refactoring.

**Primary needs:** add and vet candidates fast; see which requisitions need candidates.

### P3 — Client Admin (the principal, or their operator)
Often not the founder. In the observed first engagement, a fractional COO completed the intake on the founder's behalf, and the founder then reviewed and approved the resulting brief. Can invite colleagues.

**Primary needs:** submit a hire request; approve the brief; review candidates; invite the founder or a hiring manager.

### P4 — Client User
Staff at a client company invited by their Client Admin. Same candidate actions, no user management.

### P5 — Prospect (unauthenticated)
Fills the public intake form. Has no login. Becomes a Client Admin only after an admin grants access following manual payment confirmation.

---

## 3. Primary user journeys

### J1 — Prospect submits a hire request
1. Prospect lands on the public intake URL
2. Form renders the currently active question set, grouped by active category
3. Prospect selects engine → department → role category; role-specific questions appear conditionally
4. Prospect submits
5. System creates a `client` with `status = prospect`, a `requisition` with `status = submitted`, and one `requisition_answer` row per answered question
6. Notification fires to admins
7. Prospect sees a confirmation screen. No account is created

### J2 — Admin converts a prospect to a client with portal access
1. Admin opens the submitted requisition and reviews answers
2. Admin records payment confirmation: `payment_confirmed_at`, optional `invoice_reference`
3. Admin sets `service_tier`
4. Admin grants portal access — sets `portal_access_enabled_at` and invites the primary contact as `client_admin`
5. Invitation email fires via GoHighLevel
6. Client sets a password and lands in the portal

**Rule:** portal access cannot be granted while `payment_confirmed_at` is null. The API rejects the attempt with `422 PAYMENT_NOT_CONFIRMED`.

### J3 — Principal approves the brief
1. Requisition moves to `pending_principal_approval` once the admin has drafted the brief
2. The designated principal (a client user flagged `is_principal`) sees an approval task in the portal
3. Principal approves, or requests changes with a comment
4. On approval, requisition moves to `sourcing` and the sourcing notification fires

**Rationale:** the intake may be completed by a proxy. The principal has context the proxy does not. Skipping this step is how a technically correct brief becomes a failed placement.

### J4 — Admin builds the pipeline privately
1. Admin creates a candidate manually, or a candidate arrives via webhook at stage `sourced`
2. Admin assigns the candidate to a requisition, creating an `assignment` at stage `sourced`
3. Admin advances through `screened` and `vetted`, recording ratings and notes
4. None of this is visible to the client

### J5 — Admin presents candidates
1. Admin selects one or more vetted assignments and clicks Present
2. System validates `consent_to_share_profile = true` on each candidate, rejecting with `422 CONSENT_MISSING` otherwise
3. Stage moves to `presented`; `presented_at` set; requisition status moves to `candidates_presented`
4. Notification fires to all client users
5. Candidates become visible to the client with **gated PII withheld**

### J6 — Client reviews candidates
1. Client sees candidate cards: display name (first name + last initial), photo, location, English and accent levels, experience, skills, recruiter recommendation, CV, and any media
2. Per candidate the client may: **Approve for interview**, **Reject** (structured reason required), or **Add comment**
3. Approve moves stage to `client_reviewing` → admin is notified to coordinate
4. Reject moves stage to `rejected_by_client`, writes a `rejection` row with reason and actor

### J7 — Interview
1. Admin creates an interview record: scheduled time, timezone, interviewer names, pasted meeting URL
2. Stage moves to `interview_scheduled` — **gated PII unlocks at this point**
3. Notification fires to client users and to the admin
4. After the interview, admin or client records outcome and notes

### J8 — Placement
1. Admin moves the assignment to `offer`, then `placed`
2. A `placement` row is created with start date, rate, hours, and service tier
3. Requisition status moves to `placed`. Other open assignments on that requisition are moved to `closed_not_selected`
4. Candidate `pool_status` moves to `placed`

### J9 — Super admin edits the intake questionnaire
1. Super admin opens Question Management
2. Creates, edits, reorders, activates, or deactivates questions and categories
3. Change takes effect on the next render of any intake form — no deploy, no cache purge beyond the documented 60-second TTL
4. Historical answers continue to render correctly because each answer stores a snapshot of its question definition

---

## 4. Requisition state machine

```
submitted
   └─> pending_principal_approval   (admin drafts brief)
          ├─> changes_requested     (principal requests changes) ──┐
          │        ^                                              │
          │        └──────────────────────────────────────────────┘
          └─> sourcing              (principal approves)
                 └─> candidates_presented
                        └─> interviewing
                               └─> offer_extended
                                      └─> placed
Any non-terminal state ──> on_hold ──> (returns to prior state)
Any non-terminal state ──> closed_unfilled   (terminal)
```

Transitions are validated server-side. An invalid transition returns `409 INVALID_TRANSITION` with the current and attempted states in the error detail.

## 5. Assignment stage machine

```
Internal (never visible to client):
  sourced ──> screened ──> vetted
                              │
Client-visible from here:     ▼
                          presented
                              ├─> client_reviewing
                              │        └─> interview_scheduled
                              │                 └─> interviewed
                              │                          └─> offer
                              │                                └─> placed
Terminal:
  rejected_by_admin   (from any internal stage or presented onward)
  rejected_by_client  (from presented, client_reviewing, interviewed)
  withdrawn           (candidate withdrew, any stage)
  closed_not_selected (another candidate was placed)
```

`STAGE_VISIBILITY` constant, single source of truth in `packages/contracts`:

```ts
export const CLIENT_VISIBLE_STAGES = [
  'presented', 'client_reviewing', 'interview_scheduled',
  'interviewed', 'offer', 'placed',
  'rejected_by_client', 'closed_not_selected',
] as const;

export const PII_UNLOCKED_STAGES = [
  'interview_scheduled', 'interviewed', 'offer', 'placed',
] as const;
```

Note `rejected_by_admin` and `withdrawn` are **not** client-visible: if an admin discards a presented candidate the client sees the card disappear rather than a rejection they did not make.

---

## 6. Admin needs-attention queue

The admin landing page is a queue, not a dashboard. Each item links directly to the object. Thresholds are configurable in `app_settings`.

| Queue item | Default condition |
|---|---|
| New intake submissions | `requisition.status = submitted` |
| Awaiting principal approval | `status = pending_principal_approval` for > 3 days |
| Payment confirmed, access not granted | `payment_confirmed_at is not null and portal_access_enabled_at is null` |
| No candidates presented | `status = sourcing` for > 5 days |
| Awaiting client feedback | assignment at `presented` for > 3 days |
| Interview without outcome | `interviews.scheduled_at < now()` and `outcome is null` |
| Incomplete webhook candidates | `candidates.data_completeness = 'incomplete'` |

---

## 7. Non-functional requirements

| ID | Requirement | Target |
|---|---|---|
| NFR-1 | API p95 response time, non-report endpoints | < 400 ms |
| NFR-2 | Intake form first contentful paint | < 2.0 s on 4G |
| NFR-3 | Concurrent users supported | 100 |
| NFR-4 | File upload maximum size | 25 MB per file |
| NFR-5 | Accepted upload MIME types | pdf, docx, png, jpeg, webp, mp4, webm, mp3, m4a |
| NFR-6 | Accessibility | WCAG 2.1 AA |
| NFR-7 | Browser support | Last 2 versions of Chrome, Edge, Safari, Firefox |
| NFR-8 | Responsive breakpoints | 360, 768, 1024, 1440 px |
| NFR-9 | Audit retention | Event log rows never deleted |
| NFR-10 | Backups | Supabase daily point-in-time recovery enabled |
| NFR-11 | Timezone handling | All timestamps stored UTC; rendered in the viewing user's timezone with an explicit label |
| NFR-12 | Secrets | Environment variables only. No secret in the repo, ever |
