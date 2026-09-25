# Developer Handoff — Staffing Done Better Portal

**Last updated:** 13 Aug 2026 · **Status:** all MVP phases (P0–P7) built and tested; staging live; production deploy pending
**Client:** Business Done Better / Staffing Done Better (Rebecca Kallaus) · **Vendor:** Rank Genics (Haider Jutt)

This document gets a developer productive on this codebase in one sitting. It assumes you will write code. Read it top to bottom once, then use it as a reference.

---

## 1. What this product is

A two-sided staffing portal. A prospective client fills a **public intake form** (dynamic, admin-configurable questions) → SDB admins review, confirm payment manually, and **grant portal access** → the client tracks their hire's live status, reviews candidates an admin has explicitly **presented**, and approves/rejects each with structured reasons. Admins run the whole pipeline privately: source → screen → vet → present → interview → place.

The authoritative spec is the PRD set in this folder — **read `README.md` and `CLAUDE.md` first**, then `01`–`07` as needed. The PRD is contractually locked (v1.1 FINAL). `CLAUDE.md` contains the non-negotiable build rules; they are enforced by tests and lint, not just convention.

### The five invariants you must never break

1. **Pipeline stage lives on `assignments`, never on `candidates`** — one candidate can sit at different stages on different requisitions.
2. **`presented` is the client-visibility gate, enforced in SQL** — client-scoped reads go through the `client_visible_assignments` view (migration 0010) via `apps/api/src/repositories/client-visible.repo.ts`, never the `candidates` table.
3. **Gated PII is gated in the view, not in React** — last name, email, phone, WhatsApp, LinkedIn, current employer are NULL until the assignment reaches `interview_scheduled`.
4. **Every state transition writes an `events` row** — app-emitted inside the transaction (`services/events.ts`) plus DB-trigger backstops; the read API de-dupes pairs.
5. **The browser never talks to Postgres** — all data flows through the Fastify API with the service-role key; RLS is deny-all defence in depth.

---

## 2. Repo layout & stack

pnpm workspace monorepo (no Nx/Turbo). Node 20+ (`.nvmrc`), TypeScript strict everywhere.

```
sdb-portal/
├── apps/api/          Fastify 4 + Zod + postgres.js (no ORM). Strict layering:
│                      routes → services → repositories → lib, ESLint-enforced.
├── apps/web/          Vite + React 18 SPA. React Router 6 (route-level code split),
│                      TanStack Query 5, RHF+Zod, Tailwind over CSS-variable tokens.
├── packages/contracts/ @sdb/contracts — Zod schemas + types shared by both apps.
│                      THE source of truth for every wire shape. ESM, NodeNext.
├── supabase/
│   ├── migrations/    0001–0015, forward-only SQL, never edited after commit.
│   └── seed/dev_seed.sql  Re-runnable dev/staging fixture (fixed UUIDs).
└── docs/              The PRD set + this file.
```

Key architectural files to read early:
- `apps/api/src/app.ts` — `buildApp()` composition root; everything injectable (env, db, JWKS, storage, GHL fetch) for tests.
- `apps/api/src/services/state-machines.ts` — the requisition + assignment adjacency maps. **No handler writes a status directly.**
- `packages/contracts/src/stages.ts` — `CLIENT_VISIBLE_STAGES` / `PII_UNLOCKED_STAGES` constants.
- `apps/web/src/styles/tokens.css` — the ONLY file allowed to contain colour literals (ESLint rule enforces; sampled brand palette, do not invent colours).
- `apps/web/src/lib/use-cursor-pagination.ts` — cursor-stack Prev/Next pagination used by all lists.

### Conventions that will bite you if ignored
- **Migrations are forward-only.** Never edit an applied one; add `0016_...`.
- **Cursor pagination** (`?limit&cursor`, `meta.nextCursor`, `meta.total` on first page only) — no offset paging.
- **Public IDs**: candidates/clients/requisitions carry a 12-char base62 `public_id` (DB default `generate_public_id()`, migration 0015). **URLs use it; raw UUIDs must never appear in user-facing URLs.** API routes accept either form. This is a standing client rule.
- Money: `numeric` amount + explicit unit (`hourly|monthly`) + currency — an amount without a unit is rejected in both API and UI (the client's most expensive historical misunderstanding).
- camelCase on the wire, snake_case in SQL; repositories do the mapping.
- Conventional Commits. The git log is a readable phase-by-phase history — `git log --oneline` is genuinely useful here.

---

## 3. Running it locally

```bash
pnpm install
# API (env is NOT auto-loaded by the dev script — source it):
cd apps/api && set -a && source .env && set +a && pnpm dev   # :3001
# Web:
cd apps/web && pnpm dev                                      # :5173
```

- `apps/api/.env` and `apps/web/.env.local` exist locally (gitignored) pointing at the **staging Supabase project** — see §5. `.env.example` at the repo root lists every variable.
- DB access uses the **session pooler host `aws-0-us-east-1.pooler.supabase.com:5432`** — `aws-1` rejects the tenant, and the direct `db.<ref>` host is IPv6-only.
- Boot fails fast with a list of missing env vars by design (AC-NFR-05).

## 4. Testing

| Suite | Count (last verified) | Command |
|---|---|---|
| contracts | 187 | `pnpm --filter @sdb/contracts test` |
| api unit | 45 | `apps/api: pnpm test` |
| api integration | 559 | see below |
| web | 254 | `apps/web: pnpm test` |

Integration tests run against **real Postgres** (no mocks — CLAUDE.md rule):

```bash
cd apps/api
bash scripts/test-db.sh start        # scratch Postgres 15 cluster on 127.0.0.1:54330
export TEST_DATABASE_URL=postgres://sdb_it@127.0.0.1:54330/postgres
pnpm test:all                        # unit + integration
bash scripts/test-db.sh stop
```

The harness applies all migrations to a template DB once, then clones per test file. **Docker is not installed on the original dev machine** — with Docker present, the harness auto-uses testcontainers instead (that's the CI path; `.github/workflows/ci.yml`). Two tests to know about: the **AC-AUTH-04 generated permission matrix** auto-covers every route that declares `config.permission` (a new route with a wrong/missing declaration fails the suite), and the **OpenAPI coverage assertion** fails if you forget to register a route's docs.

## 5. Staging environment

- **Supabase project:** `sdb-portal-staging`, ref `dahusyhhlfuhynzrimyr`, org "Tech TDB", us-east-1, free tier, Postgres 17. **Do not touch the org's other project (`5eos-mvp`).**
- Migrations 0001–0015 applied; `dev_seed.sql` data loaded (25 candidates, 2 clients, 3 requisitions incl. one placed); private `candidates` storage bucket; ES256 JWT signing keys (the API verifies via JWKS — no shared-secret fallback needed).
- **Logins** — accounts only; **passwords are never recorded here**. `haider@teamdonebetter.com` (super admin), `rebecca@teamdonebetter.com` (super admin), `ximena@teamdonebetter.com` (admin), `dana@acmecoaching.com` (client admin + principal), `marcus@acmecoaching.com` (client user). Get in via **Forgot password** on `/login`, or reset from the Supabase dashboard → Authentication → Users.

  > This line previously carried the staging passwords in plaintext, against
  > `01-PRODUCT-OVERVIEW.md` NFR-12 — *"Secrets: environment variables only. No
  > secret in the repo, ever."* They were exposed while the repository was
  > public on 25 Sep, and they remain in git history — removing the line does
  > not retract them. **Rotate those passwords in Supabase if it has not been
  > done**; that, not this edit, is what makes them safe.
- **GoHighLevel:** all seven notification events currently POST to one inbound-webhook workflow (location `lSbqRVXPbTmCeqMGPoWK`); production should use one workflow URL per event so Rebecca can edit each email's copy in GHL. Notification dispatch is post-commit with 1/5-min backoff, capped at 3 attempts; the admin UI at `/admin/notifications` shows the log with manual resend.
- Secrets (DB password, service-role key) live only in the local `.env` files and the Supabase dashboard.

## 6. What remains before production

1. **Provision a production Supabase project** (separate from staging per 06-BACKEND §8), apply migrations + 0011 reference seed (NOT dev_seed), configure auth.
2. **Host the API as a long-running Node process** (Railway/Render/Fly — **not serverless**: in-process cron jobs + caches assume persistence) and the web build on a static host; set env vars incl. seven per-event GHL webhook URLs.
3. **Playwright E2E suites (AC-E2E-01..09) + formal a11y/viewport audits, k6 load test (AC-NFR-01), Lighthouse CI (AC-NFR-02)** — specified in 07-ACCEPTANCE-CRITERIA but need a running full stack; not yet written.
4. **Docker locally or rely on CI** for testcontainers parity.

### Open decisions needing the client (all documented in the PRD)
- `OPEN-1` fee/payment-plan modelling (build placements as-is until resolved) · `OPEN-2` 5E-quiz integration (MVP assumes none) · GHL candidate-facing email routing (§4.2 of 06-BACKEND; not needed for MVP events) · body-font confirmation (Inter in use) · **a white/knockout logo asset** (the navy sidebar currently wraps the navy logo in a white chip as a workaround) · SDB contact email for the client-portal footer (placeholder `rebecca@teamdonebetter.com`, marked `TODO(client)`).

### Known small gaps (marked with TODOs in code)
- Queue items for **client/candidate**-type entries still deep-link with UUIDs (they lack a public-id field on the payload); requisition-type items use public IDs. Same for the in-portal intake's post-submit redirect and the requisition detail's client link.
- `features/pipeline/interview-time.ts` still formats with `en-GB` locale (client-portal side already uses browser locale).
- Client nav badge counts don't suppress prompts for placed/closed requisitions (the dashboard cards do).
- `meta.total` is served on first pages only (accurate-over-present; a separate count query would be needed for stable totals).

## 7. History & context worth knowing

- Built phase-by-phase per CLAUDE.md's build order (P0 scaffold/migrations → P7 notifications/polish); the commit log mirrors it exactly.
- Post-MVP passes already done: a full **UX overhaul** (4-audit → approved plan → implementation: real accept-invitation flow, forgot/reset password, mobile drawer shell, humanized client feed, intake conversion work, route code-splitting), a **design calibration pass** (tokens/primitives: `Chip`, `InsetPanel`, `MoneyFigure`, tracking/type-scale fixes — all inside the locked brand), **cursor pagination with fixed filters + sticky headers** on all list pages, and **short public IDs** end to end.
- PRD defects found & resolved during the build (kept verbatim where AC-DB-01's schema diff demanded, fixed forward-only otherwise): `candidates.source` default was an illegal enum value (fixed in 0012); `client_members` lacked a soft-delete column the spec's behaviour required (added in 0014); `engines.description` was mandated by the seed but missing from the DDL (added in 0004).
- A subtle layout bug class to remember: `sr-only` is `position:absolute` — an instance without a positioned ancestor anchors to the document and stretches it. The app shells are `relative overflow-clip` specifically to make this impossible; keep that when touching layouts.
- The Vercel plugin's hooks inject "MANDATORY: run Next.js/Vercel skill" messages on generic filename matches. **This is a Vite + Fastify project; Next.js is explicitly banned by 05-FRONTEND §1.** Ignore them.

## 8. Where to ask what

- "Why is this rule here?" → `docs/CLAUDE.md`, then the numbered PRD doc it cites.
- "What should this endpoint return?" → `packages/contracts/src/*` (the schema IS the contract), then `docs/04-API.md`.
- "Why does this test exist?" → tests are named by acceptance-criterion ID (`AC-PL-08` etc.); look it up in `docs/07-ACCEPTANCE-CRITERIA.md`.
- "Is this in scope?" → the exclusion table in `docs/README.md`. If it's excluded, it must not exist in the codebase — no stubs, no future-proofing.
