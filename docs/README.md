# Staffing Done Better — Client & Candidate Portal
## Product Requirements Document (MVP v1.0)

| | |
|---|---|
| **Product** | Staffing Done Better Portal |
| **Client** | Business Done Better / Staffing Done Better (Rebecca Kallaus) |
| **Vendor** | Rank Genics (Haider Jutt) |
| **Version** | 1.1 — FINAL (brand palette applied) |
| **Date** | 12 August 2026 |
| **Status** | Locked for build |
| **Build agent** | Claude Code |

---

## Document set

Read in this order. Each file is self-contained and independently verifiable.

| File | Contents |
|---|---|
| `README.md` | This index, scope summary, glossary |
| `CLAUDE.md` | Build rules, conventions, and definition of done for the coding agent |
| `01-PRODUCT-OVERVIEW.md` | Personas, user journeys, in/out of scope, non-goals |
| `02-DATABASE.md` | Postgres/Supabase schema, full DDL, enums, indexes, RLS, migrations |
| `03-INTAKE-FORM-ENGINE.md` | Dynamic question management — data model decision, admin capabilities, rendering contract |
| `04-API.md` | REST contract, every endpoint, request/response schemas, error model, auth |
| `05-FRONTEND.md` | React stack, routing, state, design system, UI/UX standard, branding tokens |
| `06-BACKEND.md` | Node service architecture, layering, integrations (GoHighLevel, Supabase Storage), webhooks, jobs |
| `07-ACCEPTANCE-CRITERIA.md` | Numbered, testable acceptance criteria — the build contract |
| `SDB-Portal-Config-Reference.md` | Source content: role taxonomy, question bank, extracted call intelligence |

---

## One-paragraph scope summary

Staffing Done Better places vetted Latin American talent into three functional areas (Client Experience, Operations, Brand) of client companies. The portal productises that service. A prospective client completes a **public intake form** describing the hire they need. Staffing Done Better admins review it, and once payment is confirmed manually, an admin **grants portal access**. Inside the portal, client users track the live status of their hire, review candidates that an admin has explicitly **presented**, and approve or reject each one with a structured reason. Admins source, vet, and assign candidates, manage pipeline stages, record interviews, and configure the intake questionnaire itself through a **question management interface** that updates client-facing forms live.

---

## Scope boundaries

### In scope (MVP)

1. Public intake form (unauthenticated) with dynamic, admin-configurable questions
2. Admin panel — client management, requisitions, candidates, pipeline, interviews, question management
3. Client portal — requisition status tracking, candidate review, approve/reject, request interview
4. Authentication with role-based access; admin-granted client access gated on manual payment confirmation
5. Multi-user client companies with `client_admin` self-service invitations
6. Candidate records with file upload (CV, photo, video/voice, work samples)
7. Inbound candidate webhook for third-party sourcing platforms
8. Notification emails via GoHighLevel on five defined events
9. Structured rejection reasons with actor attribution
10. Immutable event log across all stage transitions

### Explicitly out of scope

| Excluded | Reason |
|---|---|
| Public marketing site | Client decision — separate property |
| Cost-of-living / regional rate map | Pre-existing project, not part of this build |
| Proprietary assessment tool (Culture Index alternative) | Depends on scoring psychology not yet authored. Schema hook only |
| Team-composition dashboards and AI interpretation | Depends on assessment tool |
| Candidate self-signup, candidate-facing portal | Post-MVP |
| Candidate marketplace / subscription pools / Upwork replacement | Explicitly de-scoped by client |
| 5eOS module reuse or shared architecture | Explicitly de-scoped. Build standalone |
| Stripe or any payment processing | Payment is manual and external |
| Calendar integration for interview scheduling | Paste-a-link approach in MVP |
| "Up next role" suggestions | De-scoped |
| Post-placement handheld-tier tracking | Schema hook only |

**Instruction to the build agent:** do not implement, stub, scaffold, or architect for anything in the excluded table beyond the explicitly stated schema hooks. Excluded scope must not appear in the codebase.

---

## Glossary

| Term | Definition |
|---|---|
| **Engine** | Top-level functional division of a business, from the client's 5eOS framework. Five exist: Revenue, Brand, Client Experience, Operations, Leadership. Staffing Done Better staffs only Client Experience, Operations, and Brand |
| **Department** | Subdivision of an engine |
| **Role category** | A staffable role within a department (e.g. Executive Assistant, Client Success Manager) |
| **Requisition** | One hiring need submitted by a client. The central work unit |
| **Intake** | The questionnaire a client completes to open a requisition |
| **Principal** | The decision-maker at the client company. May differ from the person who completed the intake |
| **Candidate** | A person in the talent pool |
| **Assignment** | The link between one candidate and one requisition. **Pipeline stage lives here, never on the candidate** |
| **Presented** | The explicit admin action that makes a candidate visible to a client. The visibility gate |
| **Placement** | A candidate hired into a requisition |
| **Service tier** | `standard_placement` or `handheld_six_month` |

---

## Appendix — commercial model, and two open items

The following was established from the client's public site after the first draft of this PRD, and corrects an earlier inference.

### Fee structure (corrected)

The $2,500 figure discussed on the discovery call is an **initiation fee that starts the process and is fully credited toward the total placement fee** — not the placement fee itself. The placement fee is **a percentage of the hire's annual salary**, payable across **five payment plans ranging from a single payment to 24 months**, with a **12-month replacement guarantee** on the 12-month plan.

An earlier draft modelled `service_tier` as a flat-fee label. That was wrong. `placements` therefore needs:

```sql
alter table placements
  add column fee_basis text check (fee_basis in ('percentage_of_salary','flat')),
  add column fee_percentage numeric(5,2),
  add column annual_salary_basis numeric(12,2),
  add column initiation_fee_amount numeric(12,2),
  add column is_initiation_fee_credited boolean default true,
  add column payment_plan text;
```

> **`OPEN-1` — needs Haider's confirmation before this migration is written.** Two questions: (a) should the system model fees at all, or does billing stay entirely outside the product with `service_tier` kept as a label only? (b) if it does model them, what are the five payment plan options exactly? `single_payment / 3_month / 6_month / 12_month / 24_month` is a guess from the "single payment to 24 months" range and must not be built on.
>
> Until resolved, the migration above is **not** part of `0008_pipeline.sql`. Build against the schema in `02-DATABASE.md` as written.

### Relationship to the 5E quiz

The current "Start Your Search" call to action routes to a **12-step 5E diagnostic**, not to a staffing intake. It scores all five engines, labels each Strong / Needs work / Needs attention / Secondary gap / Primary gap, and identifies the client's primary gap engine — then invites a conversation.

This is a lead-generation funnel that sits *before* staffing intake, and it already captures the one field the requisition most needs: which engine is failing.

> **`OPEN-2` — needs Haider's decision.** Does the portal's public intake form (a) replace the quiz, (b) sit downstream of it, receiving the quiz result and pre-selecting the engine, or (c) run alongside it independently? Option (b) is the strongest product answer and the most work. **MVP assumes (c) — independent, no integration.** Any quiz integration is out of scope for v1.

### Verified service facts now reflected in the PRD

| Fact | Source | Where it lands |
|---|---|---|
| Top three candidates presented, with a recommendation, client chooses | Public site | Confirms the present-then-client-decides flow; `recruiter_recommendation` is client-visible |
| 21 days average to first match | Public site | Consistent with the 2–3 week expectation; informs the `queue.no_candidates_days` threshold |
| Every placement processed through Sigma Remote | Public site | Compliance partner. No system integration in MVP |
| 12-month replacement guarantee | Public site | `placements.guarantee_end_date` already exists |
| Multi-stage vetting, culture-screened | Public site | Consistent with `vetting_status` and the fit-rating fields |
| LATAM only | Public site and call transcripts | No hard constraint in schema; `country` remains free text |
