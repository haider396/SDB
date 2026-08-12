# CLAUDE.md — Build Rules

You are building the Staffing Done Better Portal. This file governs how you build. Read `README.md`, then `01`–`07` in order, before writing code.

---

## Non-negotiable rules

1. **Do not implement anything in the "Explicitly out of scope" table** in `README.md`. No stubs, no placeholder routes, no "future-proofing" comments. If you believe an excluded item is required, stop and ask.
2. **Pipeline stage lives on `assignments`, never on `candidates`.** A candidate may be at different stages for different requisitions simultaneously. Violating this is a rewrite.
3. **The `presented` stage is the client visibility gate.** No candidate at a stage earlier than `presented` may be returned by any client-scoped endpoint under any circumstances. This is enforced in the data layer, not the UI.
4. **Gated PII is gated in SQL, not in React.** Last name, email, phone, WhatsApp, LinkedIn, and current employer are exposed to a client only when that candidate's assignment stage is `interview_scheduled` or later. Implemented as a database view. A front-end conditional is not an acceptable implementation.
5. **All database access flows through the Node API using the Supabase service role key.** The browser never talks to Supabase directly except for authentication. RLS is enabled with deny-all policies as defence in depth — see `02-DATABASE.md` §9.
6. **Every state transition writes an event row.** No exceptions, no silent updates.
7. **TypeScript strict mode on, both packages.** No `any` except where a third-party type is genuinely missing, and then with a comment explaining why.
8. **No `localStorage` or `sessionStorage` for auth tokens.** Use the Supabase client's session handling.

---

## Repository layout

```
sdb-portal/
├── apps/
│   ├── api/                    # Node + Fastify + TypeScript
│   │   ├── src/
│   │   │   ├── routes/         # One file per resource
│   │   │   ├── services/       # Business logic. No HTTP awareness
│   │   │   ├── repositories/   # All SQL. No business logic
│   │   │   ├── schemas/        # Zod schemas, shared with client via packages/contracts
│   │   │   ├── middleware/
│   │   │   ├── integrations/   # GoHighLevel, Supabase Storage
│   │   │   ├── jobs/
│   │   │   └── lib/
│   │   └── tests/
│   └── web/                    # React + Vite + TypeScript
│       ├── src/
│       │   ├── routes/
│       │   ├── features/       # Feature-scoped components + hooks
│       │   ├── components/ui/  # shadcn/ui primitives
│       │   ├── lib/
│       │   └── styles/
│       └── tests/
├── packages/
│   └── contracts/              # Zod schemas + inferred types shared by api and web
├── supabase/
│   ├── migrations/             # Numbered, forward-only SQL
│   └── seed/
└── docs/                       # This PRD set, committed
```

**Monorepo tooling:** pnpm workspaces. No Nx, Turborepo, or Lerna.

---

## Conventions

| Concern | Rule |
|---|---|
| Database naming | `snake_case`, plural tables, singular column names, `_id` suffix on FKs, `_at` suffix on timestamps, `is_`/`has_` prefix on booleans |
| Primary keys | `uuid` with `gen_random_uuid()` default. Never serial integers |
| Timestamps | `timestamptz`, always. Never `timestamp` |
| Money | `numeric(12,2)` with a separate `currency char(3)` and `unit` enum. Never floats |
| Enums | Postgres native `create type ... as enum`. Mirrored in `packages/contracts` as Zod enums |
| Soft delete | `archived_at timestamptz null`. No hard deletes on any business entity |
| API paths | `/api/v1/{resource}`, kebab-case multi-word resources |
| API casing | `camelCase` in JSON bodies. Repository layer maps to `snake_case` |
| Migrations | `NNNN_description.sql`, forward-only, never edited after commit |
| Commits | Conventional Commits |
| Tests | Vitest both packages. Integration tests hit a real Postgres, not mocks |

---

## Definition of done

A feature is done when all of the following are true:

- [ ] Zod schema exists in `packages/contracts` and is used by both API validation and front-end forms
- [ ] Endpoint returns the documented shape, verified by an integration test
- [ ] Authorization tested for every role that can and cannot reach it, including a negative test proving a `client_user` from company A cannot read company B's data
- [ ] Event row written for any state change, asserted in test
- [ ] Loading, empty, and error states implemented in the UI — not just the happy path
- [ ] Keyboard navigable, focus visible, form fields labelled
- [ ] Acceptance criteria IDs from `07-ACCEPTANCE-CRITERIA.md` referenced in the PR description

---

## Build order

Work in these phases. Do not begin a phase before the previous one passes its acceptance criteria.

| Phase | Deliverable |
|---|---|
| **P0** | Repo scaffold, Supabase project, migrations 0001–0010, auth, roles/permissions, seed data |
| **P1** | Question management (admin) + public intake form rendering + submission |
| **P2** | Admin: clients, requisitions, access granting, principal approval flow |
| **P3** | Candidates: CRUD, file upload, inbound webhook |
| **P4** | Assignments, pipeline stages, present action, gated PII view |
| **P5** | Client portal: dashboard, requisition tracking, candidate review, approve/reject/request interview |
| **P6** | Interviews, rejection reasons, admin needs-attention queue |
| **P7** | GoHighLevel notifications, event log surfacing, polish pass against `05-FRONTEND.md` |

---

## When to stop and ask

Stop and ask the human rather than deciding, if:

- A requirement in this PRD contradicts another requirement in this PRD
- An acceptance criterion cannot be met without adding out-of-scope functionality
- A third-party API (GoHighLevel) does not behave as described in `06-BACKEND.md` §4
- You need a credential, hex colour, or business rule that is marked `TODO(client)`

Do not resolve ambiguity by guessing and do not silently expand scope.
