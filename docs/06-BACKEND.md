# 06 — Back End

## 1. Language and runtime

| Concern | Choice | Rationale |
|---|---|---|
| Runtime | **Node.js 20 LTS** | Client requirement. Pin with `.nvmrc` and `engines` |
| Language | **TypeScript 5.5+**, `strict: true` | Non-negotiable. The contract-driven design depends on types being real |
| HTTP framework | **Fastify 4.x** | Chosen over Express because schema-first validation and serialisation are built in, which is what makes the API contract verifiable rather than aspirational. Also materially faster |
| Validation | **Zod 3.x** via `fastify-type-provider-zod` | Same schemas as the front end, imported from `packages/contracts` |
| OpenAPI | `@fastify/swagger` + `@asteasolutions/zod-to-openapi` | Generated from Zod. Never hand-written |
| DB access | **`postgres.js`** | Direct SQL. See §2.1 |
| Migrations | Supabase CLI (`supabase migration`) | Plain SQL files, forward-only |
| Auth verification | `jose` JWKS verification of Supabase JWTs | Verify locally, do not call Supabase per request |
| Storage | `@supabase/supabase-js` (service role) | Signed upload and download URLs only |
| Logging | **pino** with request-scoped child loggers | JSON structured logs, `requestId` on every line |
| Jobs | `node-cron` in-process | See §5. No Redis, no BullMQ at this scale |
| Testing | **Vitest** + `testcontainers` Postgres | Integration tests run against real Postgres, not mocks |
| Env validation | Zod-parsed `env.ts`, fails fast at boot | A missing variable must crash on startup, not at first request |

**Not permitted:** Express, NestJS, Prisma, TypeORM, Sequelize, GraphQL, Deno, Bun, JavaScript without types, `any` as a habit.

### 1.1 Why no ORM

`postgres.js` with hand-written SQL, wrapped in a thin repository layer. Reasoning: this schema leans on Postgres features an ORM abstracts badly — native enums, `tsvector` search, array columns, partial unique indexes, generated columns, triggers, and the `client_visible_assignments` view that is doing security work. An ORM would either fight these or require raw escape hatches everywhere, which is the worst of both. Hand-written SQL in dedicated repository files is more readable and more reviewable here.

Every query is parameterised. String-concatenated SQL is a build failure.

---

## 2. Architecture

Four layers, strict one-directional dependency. A layer may only import from the layer below it.

```
routes/        HTTP concerns only. Parse, authorise, delegate, serialise. No business logic, no SQL.
   ↓
services/      Business rules, transactions, state machines, event emission. No HTTP types, no SQL strings.
   ↓
repositories/  All SQL. Returns domain objects with camelCase keys. No business rules.
   ↓
lib/db         Connection pool, transaction helper.
```

**Enforcement:** an ESLint `no-restricted-imports` rule fails the build if a route imports a repository, or a repository imports a service.

### 2.1 Transactions

Every multi-write operation runs in an explicit transaction via a `withTransaction(fn)` helper. The following are transactional and must be tested for atomicity:

| Operation | Writes |
|---|---|
| Intake submission | client + requisition + N answers + N answer_options + event + notification enqueue |
| Grant portal access | client update + user create + client_member + user_role + event + notification |
| Present candidates | N assignment updates + requisition status + N events + notifications |
| Reject assignment | assignment update + rejection + event + notification |
| Place candidate | placement + assignment + requisition + sibling assignments + candidate pool_status + events |
| Question create with options | question + N options + N role scopes + event |

### 2.2 State machine enforcement

Transitions live in one place, `services/state-machines.ts`, as explicit adjacency maps derived from `01` §4 and §5:

```ts
export const REQUISITION_TRANSITIONS: Record<RequisitionStatus, RequisitionStatus[]> = {
  submitted:                 ['pending_principal_approval', 'on_hold', 'closed_unfilled'],
  pending_principal_approval:['sourcing', 'changes_requested', 'on_hold', 'closed_unfilled'],
  changes_requested:         ['pending_principal_approval', 'on_hold', 'closed_unfilled'],
  sourcing:                  ['candidates_presented', 'on_hold', 'closed_unfilled'],
  candidates_presented:      ['interviewing', 'sourcing', 'on_hold', 'closed_unfilled'],
  interviewing:              ['offer_extended', 'candidates_presented', 'on_hold', 'closed_unfilled'],
  offer_extended:            ['placed', 'interviewing', 'on_hold', 'closed_unfilled'],
  placed:                    [],
  on_hold:                   ['sourcing', 'candidates_presented', 'interviewing', 'closed_unfilled'],
  closed_unfilled:           [],
};
```

No handler may write a status or stage directly. All transitions go through `transitionRequisition()` / `advanceAssignment()`, which validate, write the row, and emit the event in one transaction. This is what guarantees the event log is complete.

### 2.3 Event emission

`emitEvent()` is called inside the same transaction as the state change, never after commit. Signature:

```ts
emitEvent(tx, {
  entityType: 'assignment',
  entityId: assignment.id,
  eventType: 'stage_changed',
  actorId: ctx.userId,
  actorRole: ctx.primaryRole,
  fromValue: previousStage,
  toValue: nextStage,
  metadata: { requisitionId, candidateId, note },
});
```

Database triggers also write events for stage and status changes as a backstop (`02` §12). Duplicate events are acceptable and preferable to missing ones; the read API de-duplicates on `(entity_id, event_type, occurred_at)` within a one-second window for display.

---

## 3. Authentication and authorization

1. Browser authenticates with Supabase Auth directly and receives a JWT
2. Every API request carries `Authorization: Bearer <jwt>`
3. `authenticate` middleware verifies the signature against the cached Supabase JWKS, checks `exp` and `aud`, extracts `sub`
4. `loadContext` middleware loads the user, roles, resolved permission keys, and client memberships. Cached in-process for 60 seconds keyed by user id, invalidated on any role write
5. `requirePermission('key')` route option rejects with `403 FORBIDDEN`
6. `requireClientScope()` resolves the caller's `client_id` and injects it into the request context

**Rules:**
- A client-scoped repository function takes `clientId` as a required first parameter. There is no variant without it
- Client-scoped candidate reads query `client_visible_assignments`, never `candidates`. Enforced by a lint rule restricting imports of the candidate repository to admin-scoped services
- The service role key exists only in the API's environment. It must never appear in any front-end bundle, log line, or error response

### 3.1 Environment variables

```
NODE_ENV, PORT, LOG_LEVEL
DATABASE_URL                       # pooled connection string
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_JWT_JWKS_URL
SUPABASE_STORAGE_BUCKET_CANDIDATES
WEBHOOK_INBOUND_TOKEN              # candidate ingest bearer token
GHL_API_BASE_URL
GHL_PRIVATE_INTEGRATION_TOKEN
GHL_LOCATION_ID
GHL_WEBHOOK_URL_<EVENT>            # one per notification event
TRANSACTIONAL_EMAIL_PROVIDER_KEY   # candidate-facing email, if enabled — see §4.3
PUBLIC_APP_URL
CORS_ALLOWED_ORIGINS
```

`env.ts` parses these with Zod at boot and exits non-zero on failure.

---

## 4. GoHighLevel notification integration

### 4.1 Approach

Notifications are delivered via GoHighLevel using a **private integration token**. The API does not compose or send email itself — it triggers GHL workflows, and the email content lives in GHL where Rebecca can edit it without a deploy. This is deliberate: copy changes are the most frequent request in any system like this, and routing them through a developer is a bottleneck.

Delivery mechanism: **inbound webhook trigger per event type.** For each of the seven `notification_event` values, a GHL workflow exists with an Inbound Webhook trigger. The API POSTs a JSON payload to the workflow's webhook URL, configured as `GHL_WEBHOOK_URL_<EVENT>`.

Payload contract, identical shape for every event:

```jsonc
{
  "event": "candidates_presented",
  "recipient": { "email": "...", "firstName": "...", "lastName": "...", "userId": "uuid" },
  "context": {
    "clientName": "Acme Inc.",
    "requisitionReference": "REQ-000123",
    "roleTitle": "Executive Assistant",
    "candidateCount": 3,
    "actionUrl": "https://portal.../requisitions/REQ-000123",
    "actorName": "Rebecca Kallaus"
  },
  "sentAt": "2026-08-12T09:14:22Z",
  "notificationLogId": "uuid"
}
```

Every field a template might need is included even when a given workflow does not use it, so adding a merge field to a template never requires an API change.

### 4.2 The contact-scoping problem — decision required

GoHighLevel workflows are contact-scoped: triggering one generally requires the recipient to exist as a contact in the location.

> **`TODO(client)` — decision needed from Haider before Phase 7.**
>
> Client-side recipients (client admins and client users) are legitimate CRM contacts and routing their notifications through GHL is unambiguously correct — Rebecca may well want them in nurture sequences.
>
> Candidate-facing email is the open question. Creating a GHL contact for every candidate would pollute the CRM with people who are not leads and consume contact allowance.
>
> **Recommended:** route client-side notifications through GHL; if candidate-facing email is needed later, send it via a transactional provider (Postmark or Resend) using the `TRANSACTIONAL_EMAIL_PROVIDER_KEY` slot already reserved above.
>
> **Note:** no candidate-facing notification is in MVP scope. All seven MVP events target admins or client users, so this decision does not block Phases 0–6. It must be resolved before candidate email is introduced.

### 4.3 Reliability

- Every send writes a `notification_log` row before the outbound call, status `queued`
- On `2xx`, status `sent`, `sent_at` set, response body stored in `provider_response`
- On failure, status `failed`, `attempts` incremented, `last_error` captured
- Retries with exponential backoff at 1 min, 5 min, 30 min. Maximum 3 attempts
- **A notification failure never fails the user-facing request.** Enqueue inside the transaction, dispatch after commit
- Admin UI exposes a notification log view with a manual resend action

### 4.4 The seven MVP events

| Event | Trigger | Recipients |
|---|---|---|
| `intake_submitted` | Public intake submission | All active admins |
| `portal_invitation` | Access granted or member invited | The invited user |
| `principal_approval_requested` | Requisition moves to `pending_principal_approval` | The requisition's principal |
| `candidates_presented` | Assignments presented | All users of that client |
| `client_decision_recorded` | Client approves for interview or rejects | All active admins |
| `interview_scheduled` | Interview created | Client users on that requisition + the creating admin |
| `requisition_status_changed` | Any requisition status transition | All users of that client |

---

## 5. Scheduled jobs

In-process `node-cron`. All jobs are idempotent and log start, finish, and affected row counts.

| Job | Schedule | Purpose |
|---|---|---|
| `retry-failed-notifications` | Every 5 min | Retry `notification_log` rows with `status = 'failed'` and `attempts < 3` |
| `refresh-attention-queue-cache` | Every 5 min | Materialise the attention-queue counts |
| `expire-stale-invitations` | Daily 02:00 UTC | Invalidate invitations unaccepted after 14 days |
| `extract-cv-text` | Every 2 min | Process CVs pending text extraction into `candidates.cv_search` |
| `flag-incomplete-candidates` | Daily 03:00 UTC | Recompute `data_completeness` against the required-field set |
| `data-retention-sweep` | Daily 04:00 UTC | Report candidates past `retention_until`. **Reports only — never deletes automatically** |

---

## 6. File handling

1. Client requests an upload URL. API validates `mimeType` against NFR-5 and `sizeBytes` against NFR-4, creates a `candidate_files` row with `virus_scan_status = 'pending'`, returns a Supabase Storage signed upload URL valid for 300 s
2. Browser uploads directly to Storage. Bytes never traverse the API
3. Client calls the confirm endpoint. API verifies the object exists and its reported size matches, sets the row complete
4. CV files are queued for text extraction (`pdf-parse` for PDF, `mammoth` for docx)
5. Downloads are always via short-lived signed URLs from `GET /files/:fileId/download-url`. **The Storage bucket is private. No public bucket, no permanent URLs**
6. Client callers may only obtain a download URL when the file is `is_client_visible = true` and the candidate has a client-visible assignment to that client

Virus scanning is not implemented in MVP; the column exists so it can be added without a migration. Uploads are restricted to authenticated admins, which bounds the risk.

---

## 7. Observability

- **Logs:** pino JSON to stdout. Every line carries `requestId`, `userId` when present, route, and duration. Request bodies are logged at `debug` only, with `email`, `phone`, `password`, and `token` fields redacted by a serialiser
- **Errors:** `500` responses return `requestId` only. Stack traces never leave the server
- **Metrics:** `/health` and `/health/ready` per `04` §14
- **Audit:** the `events` table is the audit trail. Every state change is queryable through `GET /api/v1/events`

---

## 8. Deployment

| Concern | Requirement |
|---|---|
| API hosting | Long-running Node process — Railway, Render, Fly.io, or a VPS. **Not serverless.** In-process cron jobs and the JWKS/permission caches assume a persistent process |
| Front end | Static build on Vercel, Netlify, or Cloudflare Pages |
| Environments | `development`, `staging`, `production`. Separate Supabase projects for staging and production. **Never point staging at production data** |
| CORS | `CORS_ALLOWED_ORIGINS` allowlist. No wildcard in production |
| Migrations | Applied via Supabase CLI in CI on merge to the environment branch. Never applied by hand in production |
| CI gates | typecheck, lint, unit tests, integration tests, build. All must pass before merge |
| Secrets | Platform environment variables only. `.env` files are gitignored, and a committed `.env.example` lists every key with empty values |
