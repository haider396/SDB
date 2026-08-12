# 07 — Acceptance Criteria

Every criterion is independently verifiable by an automated test. Each references the phase from `CLAUDE.md`. A phase is complete when all of its criteria pass in CI.

**Format:** `AC-<AREA>-<NN>` — Given / When / Then, with the verification method stated.

---

## 1. Database (Phase P0)

| ID | Criterion | Verified by |
|---|---|---|
| AC-DB-01 | All 11 migrations apply cleanly to an empty database and the schema matches the DDL in `02-DATABASE.md` | `supabase db reset` in CI, then a schema snapshot diff |
| AC-DB-02 | Migrations are forward-only; re-running an applied migration is a no-op | CI applies twice |
| AC-DB-03 | Inserting a `clients` row with `portal_access_enabled_at` set and `payment_confirmed_at` null raises a check violation | Integration test asserting the error |
| AC-DB-04 | Inserting a `requisition_answers` row with two non-null value columns raises a check violation | Integration test |
| AC-DB-05 | Inserting a `requisition_answers` row whose populated value column does not match the question's type raises a check violation — tested for all 12 question types | Parameterised integration test, 12 cases |
| AC-DB-06 | `UPDATE` or `DELETE` on `events` raises an exception | Integration test, both statements |
| AC-DB-07 | `client_visible_assignments` returns rows only for the 8 client-visible stages, and null for all 6 gated PII fields at stages `presented` and `client_reviewing` | Integration test seeding one assignment per stage and asserting the full matrix |
| AC-DB-08 | Using the `anon` key and a valid `authenticated` client-user JWT, `select * from candidates` returns no rows or a permission error | Integration test with both keys |
| AC-DB-09 | Changing `questions.question_type` while `answer_count > 0` raises an exception | Integration test |
| AC-DB-10 | Every assignment stage change writes exactly one trigger-sourced `events` row | Integration test |
| AC-DB-11 | Two `client_members` rows for the same client with `is_primary_contact = true` violates a unique index; same for `is_principal` | Integration test, both indexes |
| AC-DB-12 | Deleting a `question_options` row referenced by any answer is blocked by the FK | Integration test |

## 2. Authentication and authorization (Phase P0)

| ID | Criterion | Verified by |
|---|---|---|
| AC-AUTH-01 | A request with no `Authorization` header to any non-public route returns `401 UNAUTHENTICATED` | Route-table-driven test iterating every registered non-public route |
| AC-AUTH-02 | A request with an expired JWT returns `401` | Integration test with a synthetic expired token |
| AC-AUTH-03 | `GET /auth/me` returns roles and the fully resolved permission key list | Integration test per role |
| AC-AUTH-04 | For every route, each of the 4 roles either succeeds or receives `403 FORBIDDEN` exactly as specified in `04-API.md` | Generated permission matrix test — the single most important test in the suite |
| AC-AUTH-05 | A `client_user` of client A requesting a requisition belonging to client B receives `403 WRONG_TENANT` or `404`, never data | Integration test |
| AC-AUTH-06 | A `client_admin` may invite a member into their own client and receives `403` attempting to invite into another client | Integration test |
| AC-AUTH-07 | Removing the last `client_admin` from a client is rejected | Integration test |
| AC-AUTH-08 | The Supabase service role key does not appear in the built front-end bundle | CI grep of `apps/web/dist` |

## 3. Question management (Phase P1)

| ID | Criterion | Verified by |
|---|---|---|
| AC-Q-01 | A `super_admin` creates a question with options; it appears in `GET /intake-form` within the cache TTL | Integration test with clock control |
| AC-Q-02 | An `admin` (non-super) receives `403` on every `/questions` write endpoint | Integration test |
| AC-Q-03 | Deactivating a question removes it from `GET /intake-form` and leaves all existing answers intact and readable | Integration test asserting answer count before and after |
| AC-Q-04 | Deactivating a category removes its questions from the form without changing any question's own `is_active`; reactivating restores the prior per-question state exactly | Integration test |
| AC-Q-05 | `PATCH /questions/:id` changing `questionType` on an answered question returns `409 QUESTION_TYPE_LOCKED` | Integration test |
| AC-Q-06 | `question.key` cannot be changed after creation | Integration test |
| AC-Q-07 | A question in `MAPPED_QUESTION_KEYS` cannot be deleted or re-keyed; returns `409 MAPPED_QUESTION_PROTECTED` | Integration test |
| AC-Q-08 | Creating a conditional chain that forms a cycle returns `422 CIRCULAR_CONDITION` | Integration test with a 3-question cycle |
| AC-Q-09 | Deactivating a question that others depend on conditionally returns `200` with a `warnings` array naming the dependents | Integration test |
| AC-Q-10 | `PATCH /questions/reorder` persists the exact order supplied and `GET /intake-form` reflects it | Integration test |
| AC-Q-11 | `validation` containing an unrecognised key returns `422 INVALID_VALIDATION_RULE` | Integration test |
| AC-Q-12 | Every question create, update, activate, and deactivate writes an `events` row with `entity_type = 'question'` and correct from/to values | Integration test |
| AC-Q-13 | `GET /questions/:id` returns an accurate `answerCount` and `lastAnsweredAt` | Integration test |
| AC-Q-14 | Question management UI live preview reflects an edit without a page reload | Playwright E2E |

## 4. Intake form (Phase P1)

| ID | Criterion | Verified by |
|---|---|---|
| AC-IF-01 | `GET /intake-form` returns only active questions in active categories, and only active options | Integration test with a mixed-state fixture |
| AC-IF-02 | `GET /intake-form` never returns a question with `audience = 'internal'`, under any query-parameter combination including explicit `audience=internal` | Integration test asserting the internal question is absent in all cases |
| AC-IF-03 | Questions scoped to role category X are returned for X and absent for Y; unscoped questions are always returned | Integration test |
| AC-IF-04 | Omitting `roleCategoryId` returns only unscoped questions | Integration test |
| AC-IF-05 | Categories with no visible questions are omitted from the response | Integration test |
| AC-IF-06 | Submission omitting a required active question returns `422 REQUIRED_ANSWER_MISSING` listing every missing key | Integration test |
| AC-IF-07 | Submission with a value field mismatched to the question type returns `422 VALUE_TYPE_MISMATCH` | Parameterised test, all 12 types |
| AC-IF-08 | Submission referencing an inactive or foreign option returns `422 INVALID_OPTION` | Integration test, both cases |
| AC-IF-09 | Submission answering a hidden conditional question returns `422 CONDITION_NOT_MET` | Integration test |
| AC-IF-10 | A successful submission creates exactly one `clients` row with `status = 'prospect'`, one `requisitions` row with `status = 'submitted'`, and one answer row per submitted answer | Integration test with row counts |
| AC-IF-11 | Every created answer row has a non-empty `question_snapshot` containing label, type, and options as at submission time | Integration test |
| AC-IF-12 | After submission, editing the question's label leaves the stored snapshot unchanged, and the requisition detail view renders the original label | Integration test |
| AC-IF-13 | A failed submission creates no rows in any table | Integration test asserting counts unchanged after a `422` |
| AC-IF-14 | Submission response contains only `requisitionReference` — no internal UUIDs | Integration test asserting the exact response keys |
| AC-IF-15 | Mapped question answers populate their corresponding `requisitions` and `clients` columns | Integration test for all mapped keys |
| AC-IF-16 | Public intake endpoints are rate-limited to 60 requests per IP per minute, returning `429` with `Retry-After` | Integration test |
| AC-IF-17 | The intake form renderer writes nothing to `localStorage` or `sessionStorage` | Playwright E2E asserting both stores are empty |
| AC-IF-18 | Adding a new `question_type` to the enum without updating the renderer map is a TypeScript compile error | Deliberate compile-failure test in CI |

## 5. Clients and access (Phase P2)

| ID | Criterion | Verified by |
|---|---|---|
| AC-CL-01 | `POST /clients/:id/grant-access` with `payment_confirmed_at` null returns `422 PAYMENT_NOT_CONFIRMED` | Integration test |
| AC-CL-02 | Granting access creates the user, the `client_members` row, the `client_admin` role assignment, an event, and a queued `portal_invitation` notification, all in one transaction | Integration test |
| AC-CL-03 | If notification enqueue fails, the access grant still commits | Integration test with a forced provider failure |
| AC-CL-04 | The invited user can accept the invitation, set a password, and read only their own client | E2E test |
| AC-CL-05 | An unaccepted invitation older than 14 days is invalidated by the scheduled job | Integration test with clock control |
| AC-CL-06 | `POST /clients/:id/revoke-access` prevents further logins for that client's members | Integration test |

## 6. Requisitions and principal approval (Phase P2)

| ID | Criterion | Verified by |
|---|---|---|
| AC-RQ-01 | Every valid transition in `REQUISITION_TRANSITIONS` succeeds and writes an event | Parameterised test over the full adjacency map |
| AC-RQ-02 | Every invalid transition returns `409 INVALID_TRANSITION` with `from` and `to` in the error details | Parameterised test over the complement of the map |
| AC-RQ-03 | `placed` and `closed_unfilled` accept no outbound transitions | Integration test |
| AC-RQ-04 | Only the user identified as `principalUserId` may call `principal-approve`; any other client user receives `403` | Integration test |
| AC-RQ-05 | `principal-request-changes` requires a comment and moves the requisition to `changes_requested` | Integration test |
| AC-RQ-06 | A caller without `requisition.view_commercials` receives a requisition payload with budget fields absent | Integration test asserting key absence, not null values |
| AC-RQ-07 | `reference` values are unique and sequential in the format `REQ-NNNNNN` under 50 concurrent creations | Concurrency integration test |

## 7. Candidates and webhook (Phase P3)

| ID | Criterion | Verified by |
|---|---|---|
| AC-CA-01 | A candidate is creatable with only `firstName` and `lastName` | Integration test |
| AC-CA-02 | `display_name` is generated as `<first or preferred> <last initial>.` and is not writable | Integration test |
| AC-CA-03 | Signed upload URL is refused for a MIME type outside NFR-5 with `415`, and for a size above NFR-4 with `413` | Integration test, both |
| AC-CA-04 | A CV upload populates `candidates.cv_search` and becomes findable by a distinctive word from the document | Integration test with a real fixture PDF |
| AC-CA-05 | `GET /files/:fileId/download-url` returns a URL expiring in 300 seconds | Integration test |
| AC-CA-06 | A client user cannot obtain a download URL for a file that is not `isClientVisible`, or for a candidate with no client-visible assignment to them | Integration test, both cases |
| AC-CA-07 | The webhook rejects a request with a missing or wrong bearer token with `401` | Integration test |
| AC-CA-08 | Posting the same `externalId` twice creates one candidate and updates it on the second call | Integration test |
| AC-CA-09 | A webhook payload missing optional fields creates the candidate with `data_completeness = 'incomplete'` and returns `200` | Integration test |
| AC-CA-10 | A webhook payload missing `firstName` or `lastName` returns `422` and creates no candidate | Integration test |
| AC-CA-11 | Unknown enum values in a webhook payload are dropped, listed in `droppedFields`, and recorded in `webhook_ingest_log` | Integration test |
| AC-CA-12 | Every webhook request writes exactly one `webhook_ingest_log` row regardless of outcome | Integration test across success, partial, and rejection |
| AC-CA-13 | A webhook cannot create an assignment or set a stage | Integration test asserting zero assignment rows |
| AC-CA-14 | Candidate search filters combine correctly: role category + country + English level + max accent + rate ceiling returns only matching candidates | Integration test over a 25-candidate fixture |

## 8. Pipeline and presentation (Phase P4–P6)

| ID | Criterion | Verified by |
|---|---|---|
| AC-PL-01 | Every valid assignment stage transition succeeds and writes an event; every invalid one returns `409` | Parameterised test over the full stage machine |
| AC-PL-02 | The same candidate can be assigned to two requisitions and sit at different stages on each simultaneously | Integration test |
| AC-PL-03 | Assigning the same candidate twice to one requisition returns `409 DUPLICATE_ASSIGNMENT` | Integration test |
| AC-PL-04 | Assigning a candidate whose `do_not_present_to_client_ids` contains the requisition's client is rejected | Integration test |
| AC-PL-05 | `POST /assignments/present` with any candidate lacking consent returns `422 CONSENT_MISSING` and presents none of them | Integration test asserting atomicity |
| AC-PL-06 | Presenting sets `presented_at`, moves the requisition to `candidates_presented`, and queues one notification per client user | Integration test |
| AC-PL-07 | A client listing assignments never sees a candidate at `sourced`, `screened`, `vetted`, `rejected_by_admin`, or `withdrawn` | Integration test seeding all stages |
| AC-PL-08 | A client sees null for `email`, `phone`, `lastName`, `whatsapp`, `linkedinUrl`, and `currentEmployer` at `presented`, and real values at `interview_scheduled` | Integration test asserting the transition unlocks exactly these six fields and no others |
| AC-PL-09 | A client rejection writes a `rejections` row with `actor = 'client'` and `rejected_by` set to the calling user, regardless of any actor value in the request body | Integration test attempting actor spoofing |
| AC-PL-10 | An admin rejection writes `actor = 'admin'` | Integration test |
| AC-PL-11 | Rejection without a `reasonId` or `reasonOther` is rejected by the database constraint and the API | Integration test |
| AC-PL-12 | Creating an interview moves the assignment to `interview_scheduled` and notifies the client users and creating admin | Integration test |
| AC-PL-13 | `POST /assignments/:id/place` creates the placement, moves the assignment and requisition to `placed`, sets siblings to `closed_not_selected`, and sets the candidate `pool_status = 'placed'` — all or nothing | Integration test asserting every write and a rollback case |
| AC-PL-14 | `GET /admin/attention-queue` returns all seven buckets with correct counts against a fixture engineered to populate each | Integration test |
| AC-PL-15 | `GET /reports/rejection-reasons` returns correct grouped counts split by actor | Integration test |

## 9. Notifications (Phase P7)

| ID | Criterion | Verified by |
|---|---|---|
| AC-NT-01 | Each of the seven events dispatches to the correct GHL webhook URL with the full documented payload shape | Integration test per event against a mock GHL server |
| AC-NT-02 | A `notification_log` row is written before the outbound call and updated to `sent` or `failed` after | Integration test |
| AC-NT-03 | A GHL failure does not fail or roll back the triggering user request | Integration test with a forced 500 from the mock |
| AC-NT-04 | The retry job retries `failed` rows with backoff and stops after 3 attempts | Integration test with clock control |
| AC-NT-05 | Notification payloads never contain gated PII for client recipients who should not yet see it | Integration test inspecting payloads |

## 10. Front end and UX

| ID | Criterion | Verified by |
|---|---|---|
| AC-UI-01 | No component contains a raw hex colour or an arbitrary Tailwind colour value | ESLint rule in CI |
| AC-UI-02 | Every list, table, and detail view renders distinct loading, empty, and error states | Component tests per surface |
| AC-UI-03 | Every form field has an associated label; automated a11y scan reports zero critical or serious violations on every route | axe-core via Playwright on all routes |
| AC-UI-04 | Full keyboard traversal of the intake form, present-candidates flow, and question manager with visible focus throughout | Playwright keyboard-only E2E |
| AC-UI-05 | Modals trap focus and restore it to the trigger on close | Component test |
| AC-UI-06 | All numeric table columns use tabular numerals | Visual regression snapshot |
| AC-UI-07 | Layout is correct with no horizontal scroll at 360, 768, 1024, and 1440 px | Playwright viewport tests |
| AC-UI-08 | `prefers-reduced-motion: reduce` disables all non-essential animation | Playwright with the media feature emulated |
| AC-UI-09 | Navigating away from a dirty form prompts to confirm | E2E test |
| AC-UI-10 | Destructive actions require typing the object name to confirm | E2E test |

## 11. End-to-end journeys

Each is a single Playwright scenario covering the corresponding journey in `01-PRODUCT-OVERVIEW.md` §3.

| ID | Journey |
|---|---|
| AC-E2E-01 | J1 — prospect completes the public intake and receives a reference |
| AC-E2E-02 | J2 — admin confirms payment, grants access, invited client admin logs in |
| AC-E2E-03 | J3 — admin drafts the brief, principal approves, requisition reaches `sourcing` |
| AC-E2E-04 | J4+J5 — admin adds a candidate, vets, presents; client sees it with PII withheld |
| AC-E2E-05 | J6 — client approves one candidate and rejects another with a structured reason; admin sees both decisions |
| AC-E2E-06 | J7 — admin schedules an interview; client now sees the previously gated contact details |
| AC-E2E-07 | J8 — admin places the candidate; siblings close; requisition and candidate statuses update |
| AC-E2E-08 | J9 — super admin adds a question and deactivates another; a new intake reflects both, and an existing requisition still renders its original answers |
| AC-E2E-09 | Client admin invites a colleague, who accepts and can review candidates but not invite others |

## 12. Non-functional verification

| ID | Criterion | Verified by |
|---|---|---|
| AC-NFR-01 | API p95 under 400 ms for the candidate list, requisition detail, and intake form endpoints at a 25-candidate and 50-requisition fixture size | k6 load script, 100 virtual users |
| AC-NFR-02 | Intake form Lighthouse performance ≥ 85 on simulated 4G | Lighthouse CI |
| AC-NFR-03 | `pnpm typecheck`, `pnpm lint`, `pnpm test`, and `pnpm build` all pass with zero warnings | CI |
| AC-NFR-04 | No `any` types outside explicitly commented third-party gaps | `eslint no-explicit-any` as error |
| AC-NFR-05 | Boot fails with a clear message when any required environment variable is missing | Integration test |
| AC-NFR-06 | Logs contain no email addresses, phone numbers, or tokens at `info` level or above | Log-scan test over a full E2E run |
| AC-NFR-07 | `/api/v1/openapi.json` validates as OpenAPI 3.1 and documents every registered route | Spectral lint plus a route-coverage assertion |

---

## 13. Sign-off

The build is accepted when:

1. Every criterion above passes in CI
2. Open items are resolved: `OPEN-1` (fee and payment-plan modelling) and `OPEN-2` (5E quiz relationship) in `README.md`, and the GoHighLevel candidate-email routing decision in `06-BACKEND.md` §4.2. The brand palette is **closed** — real sampled values are in `05-FRONTEND.md` §3.4
3. A staging environment is deployed with dummy data and demonstrated against the nine E2E journeys
4. The generated OpenAPI document is reviewed and matches this PRD
