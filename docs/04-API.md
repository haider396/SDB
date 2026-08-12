# 04 — API

## 1. Conventions

| Concern | Rule |
|---|---|
| Base path | `/api/v1` |
| Transport | HTTPS only. HTTP redirects to HTTPS |
| Body format | JSON, `camelCase` keys |
| Dates | ISO 8601 with timezone offset, UTC on the wire |
| IDs | UUID v4 strings |
| Auth | `Authorization: Bearer <supabase_access_token>` on all endpoints except those marked **Public** |
| Idempotency | `Idempotency-Key` header honoured on `POST /candidates/webhook` |
| Pagination | Cursor-based: `?limit=25&cursor=<opaque>`. Max `limit` 100 |
| Sorting | `?sort=field:asc|desc`. Whitelisted per endpoint |
| Filtering | Explicit query params only. No arbitrary filter DSL |
| Rate limits | 60 req/min per IP on public endpoints; 600 req/min per user on authenticated endpoints |

### 1.1 Standard response envelopes

Single resource:
```jsonc
{ "data": { ... } }
```

Collection:
```jsonc
{
  "data": [ ... ],
  "meta": { "count": 25, "nextCursor": "eyJpZCI6..." }
}
```

Error:
```jsonc
{
  "error": {
    "code": "REQUIRED_ANSWER_MISSING",
    "message": "Some required answers are missing.",
    "details": { "missingKeys": ["company_name", "budget_range"] },
    "requestId": "01J9X8..."
  }
}
```

### 1.2 Error codes

| HTTP | Code | Meaning |
|---|---|---|
| 400 | `MALFORMED_REQUEST` | Body is not valid JSON or fails base schema |
| 401 | `UNAUTHENTICATED` | Missing or invalid token |
| 403 | `FORBIDDEN` | Authenticated but lacks the required permission |
| 403 | `WRONG_TENANT` | Client user requested another client's resource |
| 404 | `NOT_FOUND` | Resource absent or not visible to this caller |
| 409 | `INVALID_TRANSITION` | Illegal state transition. `details` carries `from` and `to` |
| 409 | `QUESTION_TYPE_LOCKED` | Type change attempted on an answered question |
| 409 | `MAPPED_QUESTION_PROTECTED` | Delete or key change on a mapped question |
| 409 | `DUPLICATE_ASSIGNMENT` | Candidate already assigned to this requisition |
| 422 | `PAYMENT_NOT_CONFIRMED` | Access grant attempted before payment confirmation |
| 422 | `CONSENT_MISSING` | Present attempted without candidate profile-sharing consent |
| 422 | `REQUIRED_ANSWER_MISSING` | See `03-INTAKE-FORM-ENGINE.md` §3.3 |
| 422 | `VALUE_TYPE_MISMATCH` | Answer value field does not match question type |
| 422 | `VALIDATION_FAILED` | A validation rule failed |
| 422 | `INVALID_OPTION` | Option not active or not owned by that question |
| 422 | `CONDITION_NOT_MET` | Conditional question answered while hidden |
| 422 | `UNKNOWN_QUESTION` | Question key not active or out of scope |
| 422 | `CIRCULAR_CONDITION` | Conditional chain forms a cycle |
| 422 | `INVALID_VALIDATION_RULE` | Unknown key in the validation bag |
| 413 | `FILE_TOO_LARGE` | Exceeds NFR-4 |
| 415 | `UNSUPPORTED_MEDIA_TYPE` | MIME type not in NFR-5 |
| 429 | `RATE_LIMITED` | `Retry-After` header set |
| 500 | `INTERNAL_ERROR` | Logged with `requestId`; no internals leaked |

### 1.3 Authorization

Every route declares its required permission in the route definition. Middleware resolves the caller's permissions from `user_roles → role_permissions → permissions` and rejects with `403 FORBIDDEN` before the handler runs.

Client-scoped routes additionally resolve the caller's `client_id` from `client_members` and inject it as a mandatory filter. **A client-scoped handler never accepts a `clientId` from the request.** Attempting to reference another tenant's resource returns `403 WRONG_TENANT`, not `404`, only when the resource is known to exist and belong elsewhere; otherwise `404 NOT_FOUND`.

---

## 2. Auth

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/auth/accept-invitation` | **Public** | Body: `{ token, password, fullName, timezone }`. Consumes the invitation, sets the password via Supabase Admin API, marks `client_members.accepted_at` |
| GET | `/auth/me` | authenticated | Returns user, roles, resolved permission keys, and `clientId` when applicable |
| POST | `/auth/logout` | authenticated | Revokes the refresh token |

Login, password reset, and token refresh are handled by the Supabase Auth client directly in the browser. The API does not proxy them.

---

## 3. Intake form (public)

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/intake-form` | **Public** | Query: `roleCategoryId?`, `audience=client`. See `03` §3.2 |
| GET | `/taxonomy/public` | **Public** | Active staffed engines → departments → role categories, for the cascading selects |
| POST | `/intake-submissions` | **Public** | See `03` §3.3. Returns `201 { requisitionReference }` |

---

## 4. Question management

All require `question.manage` except the read endpoints, which require `question.view`.

| Method | Path | Notes |
|---|---|---|
| GET | `/questions` | Query: `categoryId?`, `isActive?`, `roleCategoryId?`, `includeAnswerCounts=true`. Returns all questions including `internal` audience |
| POST | `/questions` | Body: `{ categoryId, key?, label, helpText?, placeholder?, questionType, audience, isRequired, sortOrder?, validation?, options?, roleCategoryIds?, conditional? }` |
| GET | `/questions/:id` | Includes options, scopes, dependents, `answerCount`, `lastAnsweredAt` |
| PATCH | `/questions/:id` | Enforces §1.5 of `03`. `questionType` change with answers → `409` |
| POST | `/questions/:id/activate` | Sets `is_active = true` |
| POST | `/questions/:id/deactivate` | Sets `is_active = false`. Returns `200` with `warnings[]` listing conditional dependents |
| POST | `/questions/:id/duplicate` | Creates an inactive copy with a new key |
| PATCH | `/questions/reorder` | Body: `{ categoryId, orderedQuestionIds: [uuid] }` |
| POST | `/questions/:id/options` | Add an option |
| PATCH | `/questions/:id/options/:optionId` | Label and sort order only; `value` change blocked once referenced |
| POST | `/questions/:id/options/:optionId/deactivate` | Soft-disable |
| GET | `/question-categories` | Query: `isActive?` |
| POST | `/question-categories` | Body: `{ key?, label, description?, sortOrder? }` |
| PATCH | `/question-categories/:id` | |
| POST | `/question-categories/:id/activate` \| `/deactivate` | Cascades visibility, not per-question state |
| PATCH | `/question-categories/reorder` | Body: `{ orderedCategoryIds: [uuid] }` |
| GET | `/questions/preview` | Query: `roleCategoryId?`. Returns the exact public payload for preview |

---

## 5. Taxonomy management

Require `settings.manage` for writes, `requisition.view` for reads.

| Method | Path |
|---|---|
| GET / PATCH | `/engines`, `/engines/:id` |
| GET / POST / PATCH | `/departments`, `/departments/:id` |
| GET / POST / PATCH | `/role-categories`, `/role-categories/:id` |
| POST | `/departments/:id/deactivate`, `/role-categories/:id/deactivate` |
| GET / POST | `/tools`, `/skills`, `/industries` |
| GET / POST / PATCH | `/disqualifiers`, `/disqualifiers/:id` |
| GET / POST / PATCH | `/rejection-reasons`, `/rejection-reasons/:id` |

Engines cannot be created or deleted — the five are fixed. Only `label`, `is_staffed`, and `sort_order` are editable.

---

## 6. Clients

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/clients` | `client.view` | Admin only. Query: `status?`, `search?`, `hasPendingAccess?` |
| POST | `/clients` | `client.create` | Manual creation outside the intake funnel |
| GET | `/clients/:id` | `client.view` | Client users may only read their own; returns `404` otherwise |
| PATCH | `/clients/:id` | `client.update` | |
| POST | `/clients/:id/confirm-payment` | `client.grant_access` | Body: `{ paymentConfirmedAt, invoiceReference?, serviceTier }` |
| POST | `/clients/:id/grant-access` | `client.grant_access` | Body: `{ primaryContactEmail, primaryContactName, isPrincipal }`. Rejects `422 PAYMENT_NOT_CONFIRMED` if payment is unconfirmed. Creates the `client_admin` invitation and fires `portal_invitation` |
| POST | `/clients/:id/revoke-access` | `client.grant_access` | Clears `portal_access_enabled_at`, deactivates client member users |
| GET | `/clients/:id/members` | `client.view` | |
| POST | `/clients/:id/members/invite` | `client.invite_user` | Body: `{ email, fullName, jobTitle?, role: 'client_admin'\|'client_user', isPrincipal? }`. A `client_admin` may invite only into their own client |
| DELETE | `/clients/:id/members/:userId` | `client.invite_user` | Soft removal. Cannot remove the last `client_admin` |
| PATCH | `/clients/:id/members/:userId` | `client.invite_user` | Change role, principal flag |

---

## 7. Requisitions

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/requisitions` | `requisition.view` | Admin: all, filterable by `status`, `clientId`, `engineId`, `roleCategoryId`, `search`. Client: implicitly scoped to own client |
| POST | `/requisitions` | `requisition.create` | Authenticated in-portal creation. Body as `03` §3.3 plus `clientId` for admins |
| GET | `/requisitions/:id` | `requisition.view` | Includes answers with snapshots, taxonomy labels, counts by stage. Commercial fields omitted unless caller has `requisition.view_commercials` |
| PATCH | `/requisitions/:id` | `requisition.update` | Admin fields including `briefMarkdown`, budget, headcount, `principalUserId` |
| PATCH | `/requisitions/:id/answers` | `requisition.update` | Upsert answers post-submission. Same validation pipeline |
| POST | `/requisitions/:id/transition` | `requisition.transition` | Body: `{ toStatus, note? }`. Validates against the state machine in `01` §4 |
| POST | `/requisitions/:id/request-principal-approval` | `requisition.transition` | Moves to `pending_principal_approval`, fires notification |
| POST | `/requisitions/:id/principal-approve` | `requisition.approve_as_principal` | Caller must be the requisition's `principalUserId`. Moves to `sourcing` |
| POST | `/requisitions/:id/principal-request-changes` | `requisition.approve_as_principal` | Body: `{ comment }`. Moves to `changes_requested` |
| GET | `/requisitions/:id/events` | `event.view` | Chronological event log |
| GET | `/requisitions/:id/assignments` | `assignment.view` | **Admin** returns all stages from `assignments`. **Client** returns only rows from `client_visible_assignments` |

---

## 8. Candidates

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/candidates` | `candidate.view` | Admin only. Query: `search`, `roleCategoryId`, `engineId`, `country`, `englishSpokenLevel`, `maxAccentStrength`, `poolStatus`, `vettingStatus`, `availableFrom`, `rateMax`, `rateUnit`, `toolIds`, `dataCompleteness`. Full-text `search` hits `cv_search` and the name trigram index |
| POST | `/candidates` | `candidate.create` | Full body per `02` §8.1. Only `firstName` and `lastName` required |
| GET | `/candidates/:id` | `candidate.view` | Full internal record with all child collections |
| PATCH | `/candidates/:id` | `candidate.update` | |
| POST | `/candidates/:id/archive` | `candidate.update` | Sets `archived_at` |
| POST | `/candidates/:id/consent` | `candidate.update` | Body: `{ hasConsentToShareProfile, consentSource }`. Sets `consent_captured_at` |
| GET/POST/PATCH/DELETE | `/candidates/:id/languages` | `candidate.update` | |
| GET/PUT | `/candidates/:id/tools` | `candidate.update` | `PUT` replaces the full set |
| GET/PUT | `/candidates/:id/skills` | `candidate.update` | |
| GET/POST/PATCH/DELETE | `/candidates/:id/employment-history` | `candidate.update` | |
| GET/POST/PATCH/DELETE | `/candidates/:id/education` | `candidate.update` | |
| GET/POST/PATCH/DELETE | `/candidates/:id/certifications` | `candidate.update` | |
| GET/POST/PATCH/DELETE | `/candidates/:id/references` | `candidate.update` | |
| GET/POST | `/candidates/:id/notes` | `candidate.view` | |
| GET/PUT | `/candidates/:id/disqualifier-checks` | `candidate.update` | |
| GET/POST | `/candidates/:id/assessments` | `candidate.update` | Storage only. No scoring logic in MVP |

### 8.1 Files

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/candidates/:id/files/upload-url` | `candidate.update` | Body: `{ fileType, originalFilename, mimeType, sizeBytes }`. Validates against NFR-4/5, returns a Supabase Storage signed upload URL and a pending `candidate_files` row id |
| POST | `/candidates/:id/files/:fileId/confirm` | `candidate.update` | Marks the upload complete, triggers CV text extraction when `fileType = 'cv'` |
| GET | `/candidates/:id/files` | `candidate.view` | |
| PATCH | `/candidates/:id/files/:fileId` | `candidate.update` | Toggle `isClientVisible`, change `fileType` |
| DELETE | `/candidates/:id/files/:fileId` | `candidate.update` | Removes the storage object and the row |
| GET | `/files/:fileId/download-url` | `candidate.view` \| client with a visible assignment | Returns a signed URL valid for 300 seconds. For client callers, permitted only when the file `isClientVisible` **and** the candidate has a client-visible assignment to that client |

Direct browser-to-Storage upload with a signed URL. File bytes never pass through the API.

### 8.2 Inbound webhook

| Method | Path | Auth |
|---|---|---|
| POST | `/candidates/webhook` | `Authorization: Bearer <WEBHOOK_TOKEN>` — a static token distinct from user JWTs |

Body:
```jsonc
{
  "externalId": "src_9931",
  "source": "linkedin",
  "sourceDetail": "Recruiter pipeline export",
  "firstName": "Maria",
  "lastName": "Gomez",
  "email": "maria@example.com",
  "phone": "+52...",
  "country": "Mexico",
  "regionState": "CDMX",
  "englishSpokenLevel": "professional",
  "accentStrength": "light",
  "yearsExperienceTotal": 6,
  "expectedRateAmount": 2200,
  "expectedRateUnit": "monthly",
  "primaryRoleCategoryKey": "executive_assistant",
  "cvUrl": "https://...",
  "raw": { }
}
```

Behaviour:

1. Upsert on `externalId`. Re-posting the same `externalId` updates rather than duplicating
2. **Lenient field validation.** Missing or unrecognised optional fields do not reject the payload. The candidate is created with `data_completeness = 'incomplete'` and surfaces in the admin needs-attention queue. Only `firstName` and `lastName` are strictly required; absence returns `422`
3. Unknown enum values are discarded, not coerced, and recorded in `webhook_ingest_log.error_detail`
4. `primaryRoleCategoryKey` is resolved to an id; unresolvable keys are left null and flagged
5. `cvUrl` is fetched server-side, stored in Supabase Storage, and linked as a `cv` file. Fetch failure does not fail the request
6. Candidates always land at `pool_status = 'active'` with no assignment. **A webhook can never create an assignment or present a candidate**
7. Every request writes a `webhook_ingest_log` row regardless of outcome
8. Returns `200 { "candidateReference": "CAN-000123", "result": "created"|"updated", "dataCompleteness": "complete"|"incomplete", "droppedFields": [] }`

Rationale for leniency: third-party payloads are inconsistent, and a strict validator means candidates silently fail to arrive and nobody notices for weeks.

---

## 9. Assignments and pipeline

| Method | Path | Permission | Notes |
|---|---|---|---|
| POST | `/requisitions/:id/assignments` | `candidate.assign` | Body: `{ candidateIds: [uuid], adminNote? }`. Creates assignments at `sourced`. `409 DUPLICATE_ASSIGNMENT` on repeat. Rejects candidates whose `do_not_present_to_client_ids` contains this client |
| GET | `/assignments/:id` | `assignment.view` | Admin: full. Client: view-backed and stage-gated |
| PATCH | `/assignments/:id` | `assignment.advance` | `adminNote`, `clientNote`, `sortOrder` |
| POST | `/assignments/:id/advance` | `assignment.advance` | Body: `{ toStage, note? }`. Validates the stage machine in `01` §5 |
| POST | `/assignments/present` | `candidate.present` | Body: `{ assignmentIds: [uuid], clientNote? }`. Bulk. Validates consent on every candidate, all-or-nothing. Sets `presented_at`, moves the requisition to `candidates_presented`, fires `candidates_presented` once per client user |
| POST | `/assignments/:id/approve-for-interview` | `assignment.view` (client) | Client action. Moves to `client_reviewing`, fires `client_decision_recorded` |
| POST | `/assignments/:id/reject` | `assignment.reject` | Body: `{ reasonId?, reasonOther?, detail? }`. Actor derived from the caller's role, never from the body. Writes a `rejections` row and moves to `rejected_by_admin` or `rejected_by_client` |
| POST | `/assignments/:id/request-interview` | `assignment.view` (client) | Notifies admins. Does not create an interview record |
| GET | `/assignments/:id/events` | `event.view` | |

---

## 10. Interviews

| Method | Path | Permission |
|---|---|---|
| POST | `/assignments/:id/interviews` | `interview.create` |
| GET | `/assignments/:id/interviews` | `interview.view` |
| PATCH | `/interviews/:id` | `interview.update` |
| POST | `/interviews/:id/outcome` | `interview.update` |
| POST | `/interviews/:id/cancel` | `interview.update` |

Creating an interview moves the assignment to `interview_scheduled`, which unlocks gated PII for that client. Body: `{ scheduledAt, timezone, durationMinutes?, meetingUrl?, interviewerNames?, roundNumber? }`. No calendar provider integration.

---

## 11. Placements

| Method | Path | Permission |
|---|---|---|
| POST | `/assignments/:id/place` | `assignment.advance` |
| GET | `/placements` | `client.view` |
| GET | `/placements/:id` | `client.view` |
| PATCH | `/placements/:id` | `client.update` |

`POST /place` runs in one transaction: creates the `placements` row, moves the assignment to `placed`, moves the requisition to `placed`, moves all sibling assignments not already terminal to `closed_not_selected`, and sets the candidate `pool_status = 'placed'`.

---

## 12. Dashboards and reporting

| Method | Path | Permission | Notes |
|---|---|---|---|
| GET | `/admin/attention-queue` | `requisition.view` | Returns the seven buckets from `01` §6, each with count and items |
| GET | `/admin/stats` | `requisition.view` | Open requisitions, candidates by stage, average days-to-present, active placements |
| GET | `/reports/rejection-reasons` | `event.view` | Query: `from`, `to`, `actor?`, `roleCategoryId?`. Grouped counts. This is the report that justifies structured rejection reasons |
| GET | `/client/dashboard` | `requisition.view` (client) | Own requisitions with stage summaries and pending actions |
| GET | `/events` | `event.view` | Query: `entityType?`, `entityId?`, `eventType?`, `actorId?`, `from?`, `to?` |

---

## 13. Settings and users

| Method | Path | Permission |
|---|---|---|
| GET / PATCH | `/settings` | `settings.manage` |
| GET | `/users` | `user.manage` |
| POST | `/users/invite` | `user.manage` |
| PATCH | `/users/:id` | `user.manage` |
| POST | `/users/:id/deactivate` | `user.manage` |
| GET | `/roles` | `user.manage` |
| GET | `/permissions` | `user.manage` |
| PUT | `/users/:id/roles` | `user.manage` |

---

## 14. Health

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/health` | **Public** | `{ status, version, uptimeSeconds }` |
| GET | `/health/ready` | **Public** | Verifies database connectivity and Storage reachability |

---

## 15. OpenAPI

The service must expose a generated OpenAPI 3.1 document at `/api/v1/openapi.json`, produced from the Zod schemas in `packages/contracts` via `@asteasolutions/zod-to-openapi`. Hand-written OpenAPI is not acceptable — the document and the validation must derive from one source, or they will diverge.

Swagger UI served at `/api/v1/docs` in non-production environments only.
