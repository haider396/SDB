/**
 * OpenAPI 3.1 document generated from the Zod schemas in @sdb/contracts via
 * @asteasolutions/zod-to-openapi (docs/04-API.md §15). Never hand-written —
 * every path registered here references the same schema objects the routes
 * validate with, so the document and the validation share one source.
 */
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
  extendZodWithOpenApi,
} from '@asteasolutions/zod-to-openapi';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import { z } from 'zod';

// Patches ZodType.prototype with `.openapi()` — required for inline query and
// path parameter generation. Prototype patching reaches the schemas defined in
// @sdb/contracts too (same deduped zod instance).
extendZodWithOpenApi(z);
import {
  AcceptInvitationBodySchema,
  ApiErrorSchema,
  ConfirmPaymentBodySchema,
  CreateClientBodySchema,
  CreateQuestionBodySchema,
  CreateQuestionCategoryBodySchema,
  CreateQuestionOptionBodySchema,
  GrantAccessBodySchema,
  InPortalRequisitionBodySchema,
  IntakeSubmissionSchema,
  InviteMemberBodySchema,
  ListClientsQuerySchema,
  ListQuestionCategoriesQuerySchema,
  ListQuestionsQuerySchema,
  ListRequisitionsQuerySchema,
  PrincipalRequestChangesBodySchema,
  ReorderQuestionCategoriesBodySchema,
  ReorderQuestionsBodySchema,
  TransitionRequisitionBodySchema,
  UpdateClientBodySchema,
  UpdateMemberBodySchema,
  UpdateQuestionBodySchema,
  UpdateQuestionCategoryBodySchema,
  UpdateQuestionOptionBodySchema,
  UpdateRequisitionAnswersBodySchema,
  UpdateRequisitionBodySchema,
} from '@sdb/contracts';
import {
  ClientCollectionSchema,
  ClientEnvelopeSchema,
  MemberCollectionSchema,
  MemberEnvelopeSchema,
  RevokeAccessEnvelopeSchema,
} from '../schemas/clients.js';
import {
  EventCollectionSchema,
  RequisitionCollectionSchema,
  RequisitionDetailEnvelopeSchema,
  RequisitionEnvelopeSchema,
} from '../schemas/requisitions.js';
import {
  AcceptInvitationResponseSchema,
  AuthMeEnvelopeSchema,
} from '../schemas/auth.js';
import {
  HealthResponseSchema,
  ReadyResponseSchema,
} from '../schemas/health.js';
import {
  InPortalRequisitionEnvelopeSchema,
  IntakeFormEnvelopeSchema,
  IntakeFormQuerySchema,
  IntakeSubmissionEnvelopeSchema,
  TaxonomyEnvelopeSchema,
} from '../schemas/intake.js';
import {
  CategoryCollectionSchema,
  CategoryEnvelopeSchema,
  QuestionCollectionSchema,
  QuestionDeactivateEnvelopeSchema,
  QuestionEnvelopeSchema,
  ReorderResponseSchema,
} from '../schemas/questions.js';
import {
  CandidateConsentBodySchema,
  CreateCandidateAssessmentBodySchema,
  CreateCandidateBodySchema,
  CreateCandidateCertificationBodySchema,
  CreateCandidateEducationBodySchema,
  CreateCandidateEmploymentBodySchema,
  CreateCandidateLanguageBodySchema,
  CreateCandidateNoteBodySchema,
  CreateCandidateReferenceBodySchema,
  FileUploadUrlBodySchema,
  ListCandidatesQuerySchema,
  PutCandidateSkillsBodySchema,
  PutCandidateToolsBodySchema,
  PutDisqualifierChecksBodySchema,
  UpdateCandidateBodySchema,
  UpdateCandidateCertificationBodySchema,
  UpdateCandidateEducationBodySchema,
  UpdateCandidateEmploymentBodySchema,
  UpdateCandidateFileBodySchema,
  UpdateCandidateLanguageBodySchema,
  UpdateCandidateReferenceBodySchema,
  WebhookCandidateBodySchema,
  WebhookResponseSchema,
} from '@sdb/contracts';
import {
  AdvanceBodySchema,
  AttentionQueueQuerySchema,
  CreateAssignmentsBodySchema,
  CreateInterviewBodySchema,
  ListEventsQuerySchema,
  ListPlacementsQuerySchema,
  OutcomeBodySchema,
  PlaceBodySchema,
  PresentBodySchema,
  RejectBodySchema,
  RejectionReasonsQuerySchema,
  UpdateAssignmentBodySchema,
  UpdateInterviewBodySchema,
  UpdatePlacementBodySchema,
} from '@sdb/contracts';
import {
  InterviewCollectionSchema,
  InterviewEnvelopeSchema,
} from '../schemas/interviews.js';
import {
  CreateDepartmentBodySchema,
  CreateDisqualifierBodySchema,
  CreateIndustryBodySchema,
  CreateRejectionReasonBodySchema,
  CreateRoleCategoryBodySchema,
  CreateSkillBodySchema,
  CreateToolBodySchema,
  ListDepartmentsQuerySchema,
  ListDisqualifiersQuerySchema,
  ListReferenceDataQuerySchema,
  ListRejectionReasonsQuerySchema,
  ListRoleCategoriesQuerySchema,
  UpdateDepartmentBodySchema,
  UpdateDisqualifierBodySchema,
  UpdateEngineBodySchema,
  UpdateRejectionReasonBodySchema,
  UpdateRoleCategoryBodySchema,
} from '@sdb/contracts';
import {
  DepartmentCollectionSchema,
  DepartmentEnvelopeSchema,
  DisqualifierCollectionSchema,
  DisqualifierEnvelopeSchema,
  EngineCollectionSchema,
  EngineEnvelopeSchema,
  IndustryCollectionSchema,
  IndustryEnvelopeSchema,
  RejectionReasonCollectionSchema,
  RejectionReasonEnvelopeSchema,
  RoleCategoryCollectionSchema,
  RoleCategoryEnvelopeSchema,
  TaxonomySkillCollectionSchema,
  TaxonomySkillEnvelopeSchema,
  TaxonomyToolCollectionSchema,
  TaxonomyToolEnvelopeSchema,
} from '../schemas/taxonomy-admin.js';
import {
  AdminStatsEnvelopeSchema,
  AttentionQueueEnvelopeSchema,
  ClientDashboardEnvelopeSchema,
  GlobalEventCollectionSchema,
  RejectionReasonsReportEnvelopeSchema,
} from '../schemas/dashboard.js';
import {
  AdminAssignmentCollectionSchema,
  AdminAssignmentEnvelopeSchema,
  AssignmentCollectionSchema,
  AssignmentEnvelopeSchema,
  AssignmentEventCollectionSchema,
  ClientVisibleAssignmentEnvelopeSchema,
  PlacementCollectionSchema,
  PlacementEnvelopeSchema,
} from '../schemas/assignments.js';
import {
  AssessmentCollectionSchema,
  CandidateCollectionSchema,
  CandidateDetailEnvelopeSchema,
  CandidateEnvelopeSchema,
  CandidateFileEnvelopeSchema,
  CertificationCollectionSchema,
  DisqualifierCheckCollectionSchema,
  EducationCollectionSchema,
  EmploymentCollectionSchema,
  FileCollectionSchema,
  FileDownloadUrlEnvelopeSchema,
  FileUploadUrlEnvelopeSchema,
  LanguageCollectionSchema,
  NoteCollectionSchema,
  ReferenceCollectionSchema,
  SkillCollectionSchema,
  ToolCollectionSchema,
} from '../schemas/candidates.js';

function errorResponse(description: string) {
  return {
    description,
    content: { 'application/json': { schema: ApiErrorSchema } },
  };
}

export function buildOpenApiDocument(version: string): OpenAPIObject {
  const registry = new OpenAPIRegistry();

  const bearerAuth = registry.registerComponent('securitySchemes', 'bearerAuth', {
    type: 'http',
    scheme: 'bearer',
    bearerFormat: 'JWT',
    description: 'Supabase access token',
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/accept-invitation',
    summary:
      'Consume an invitation token, set the password, mark the membership accepted',
    tags: ['auth'],
    request: {
      body: {
        content: {
          'application/json': { schema: AcceptInvitationBodySchema },
        },
      },
    },
    responses: {
      200: {
        description: 'Invitation accepted',
        content: {
          'application/json': { schema: AcceptInvitationResponseSchema },
        },
      },
      400: errorResponse('Malformed request'),
      422: errorResponse('Invalid, expired, or already-used invitation token'),
      429: errorResponse('Rate limited'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/auth/me',
    summary: 'Current user, roles, resolved permission keys, and clientId',
    tags: ['auth'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      200: {
        description: 'Authenticated user context',
        content: { 'application/json': { schema: AuthMeEnvelopeSchema } },
      },
      401: errorResponse('Unauthenticated'),
      429: errorResponse('Rate limited'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/auth/logout',
    summary: 'Revoke the refresh token behind the presented access token',
    tags: ['auth'],
    security: [{ [bearerAuth.name]: [] }],
    responses: {
      204: { description: 'Logged out' },
      401: errorResponse('Unauthenticated'),
      429: errorResponse('Rate limited'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/health',
    summary: 'Liveness',
    tags: ['health'],
    responses: {
      200: {
        description: 'Service is up',
        content: { 'application/json': { schema: HealthResponseSchema } },
      },
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/health/ready',
    summary: 'Readiness: database connectivity and Storage reachability',
    tags: ['health'],
    responses: {
      200: {
        description: 'Ready',
        content: { 'application/json': { schema: ReadyResponseSchema } },
      },
      503: {
        description: 'Not ready',
        content: { 'application/json': { schema: ReadyResponseSchema } },
      },
    },
  });

  // --- intake form (public, 04 §3) ----------------------------------------
  const jsonBody = <T>(schema: T) => ({
    body: { content: { 'application/json': { schema } } },
  });
  const ok = <T>(description: string, schema: T) => ({
    description,
    content: { 'application/json': { schema } },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/intake-form',
    summary: 'Public intake form definition (03 §3.2)',
    tags: ['intake'],
    request: { query: IntakeFormQuerySchema },
    responses: {
      200: ok('Form definition', IntakeFormEnvelopeSchema),
      429: errorResponse('Rate limited'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/taxonomy/public',
    summary: 'Active staffed engines → departments → role categories',
    tags: ['intake'],
    responses: {
      200: ok('Taxonomy cascade', TaxonomyEnvelopeSchema),
      429: errorResponse('Rate limited'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/intake-submissions',
    summary: 'Public intake submission (03 §3.3, six-step validation)',
    tags: ['intake'],
    request: jsonBody(IntakeSubmissionSchema),
    responses: {
      201: ok('Submission accepted', IntakeSubmissionEnvelopeSchema),
      400: errorResponse('Malformed request'),
      422: errorResponse(
        'UNKNOWN_QUESTION | REQUIRED_ANSWER_MISSING | VALUE_TYPE_MISMATCH | VALIDATION_FAILED | INVALID_OPTION | CONDITION_NOT_MET',
      ),
      429: errorResponse('Rate limited'),
    },
  });

  registry.registerPath({
    method: 'post',
    path: '/api/v1/requisitions',
    summary: 'Authenticated in-portal requisition creation (03 §3.5)',
    tags: ['requisitions'],
    security: [{ [bearerAuth.name]: [] }],
    request: jsonBody(InPortalRequisitionBodySchema),
    responses: {
      201: ok('Requisition created', InPortalRequisitionEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing requisition.create'),
      422: errorResponse('Validation pipeline failure'),
    },
  });

  // --- requisition lifecycle (04 §7) ---------------------------------------
  const securedReq = [{ [bearerAuth.name]: [] }];
  const requisitionIdParams = { params: z.object({ id: z.string().uuid() }) };

  registry.registerPath({
    method: 'get',
    path: '/api/v1/requisitions',
    summary:
      'List requisitions — admin: all with filters; client: implicitly scoped',
    tags: ['requisitions'],
    security: securedReq,
    request: { query: ListRequisitionsQuerySchema },
    responses: {
      200: ok('Requisitions', RequisitionCollectionSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing requisition.view'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/api/v1/requisitions/{id}',
    summary:
      'Requisition detail with answers, snapshots, taxonomy labels; commercials gated by requisition.view_commercials',
    tags: ['requisitions'],
    security: securedReq,
    request: requisitionIdParams,
    responses: {
      200: ok('Requisition detail', RequisitionDetailEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found (including cross-tenant addressing)'),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/requisitions/{id}',
    summary: 'Admin update: briefMarkdown, budget, headcount, principalUserId',
    tags: ['requisitions'],
    security: securedReq,
    request: { ...requisitionIdParams, ...jsonBody(UpdateRequisitionBodySchema) },
    responses: {
      200: ok('Updated', RequisitionDetailEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing requisition.update'),
      422: errorResponse('VALIDATION_FAILED (budget unit rule, principal membership)'),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/requisitions/{id}/answers',
    summary: 'Upsert answers post-submission via the intake validation pipeline',
    tags: ['requisitions'],
    security: securedReq,
    request: {
      ...requisitionIdParams,
      ...jsonBody(UpdateRequisitionAnswersBodySchema),
    },
    responses: {
      200: ok('Answers upserted', RequisitionDetailEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      422: errorResponse(
        'UNKNOWN_QUESTION | REQUIRED_ANSWER_MISSING | VALUE_TYPE_MISMATCH | VALIDATION_FAILED | INVALID_OPTION | CONDITION_NOT_MET',
      ),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/requisitions/{id}/transition',
    summary: 'Status transition validated against the 01 §4 state machine',
    tags: ['requisitions'],
    security: securedReq,
    request: {
      ...requisitionIdParams,
      ...jsonBody(TransitionRequisitionBodySchema),
    },
    responses: {
      200: ok('Transitioned', RequisitionEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      409: errorResponse('INVALID_TRANSITION with { from, to } details'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/requisitions/{id}/request-principal-approval',
    summary: 'Move to pending_principal_approval and notify the principal',
    tags: ['requisitions'],
    security: securedReq,
    request: requisitionIdParams,
    responses: {
      200: ok('Approval requested', RequisitionEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      409: errorResponse('INVALID_TRANSITION'),
      422: errorResponse('No principal designated'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/requisitions/{id}/principal-approve',
    summary:
      'Principal approves the brief — caller must be principalUserId; moves to sourcing',
    tags: ['requisitions'],
    security: securedReq,
    request: requisitionIdParams,
    responses: {
      200: ok('Approved', RequisitionEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Caller is not the designated principal'),
      409: errorResponse('INVALID_TRANSITION'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/requisitions/{id}/principal-request-changes',
    summary: 'Principal requests changes with a required comment',
    tags: ['requisitions'],
    security: securedReq,
    request: {
      ...requisitionIdParams,
      ...jsonBody(PrincipalRequestChangesBodySchema),
    },
    responses: {
      200: ok('Changes requested', RequisitionEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Caller is not the designated principal'),
      409: errorResponse('INVALID_TRANSITION'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/api/v1/requisitions/{id}/events',
    summary: 'Chronological event log, app+trigger pairs de-duplicated (06 §2.3)',
    tags: ['requisitions'],
    security: securedReq,
    request: requisitionIdParams,
    responses: {
      200: ok('Events', EventCollectionSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing event.view'),
    },
  });

  // --- clients (04 §6) ------------------------------------------------------
  const memberParams = {
    params: z.object({ id: z.string().uuid(), userId: z.string().uuid() }),
  };

  registry.registerPath({
    method: 'get',
    path: '/api/v1/clients',
    summary: 'List clients (admin); a client-scoped caller sees only their own',
    tags: ['clients'],
    security: securedReq,
    request: { query: ListClientsQuerySchema },
    responses: {
      200: ok('Clients', ClientCollectionSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing client.view'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/clients',
    summary: 'Create a client manually, outside the intake funnel',
    tags: ['clients'],
    security: securedReq,
    request: jsonBody(CreateClientBodySchema),
    responses: {
      201: ok('Created', ClientEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing client.create'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/api/v1/clients/{id}',
    summary: 'Client detail; client users read only their own (404 otherwise)',
    tags: ['clients'],
    security: securedReq,
    request: requisitionIdParams,
    responses: {
      200: ok('Client', ClientEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found'),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/clients/{id}',
    summary: 'Update client fields',
    tags: ['clients'],
    security: securedReq,
    request: { ...requisitionIdParams, ...jsonBody(UpdateClientBodySchema) },
    responses: {
      200: ok('Updated', ClientEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing client.update'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/clients/{id}/confirm-payment',
    summary: 'Record manual payment confirmation and service tier (J2)',
    tags: ['clients'],
    security: securedReq,
    request: { ...requisitionIdParams, ...jsonBody(ConfirmPaymentBodySchema) },
    responses: {
      200: ok('Payment confirmed', ClientEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing client.grant_access'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/clients/{id}/grant-access',
    summary:
      'Grant portal access: one transaction creating the user, membership, role, event, and queued invitation',
    tags: ['clients'],
    security: securedReq,
    request: { ...requisitionIdParams, ...jsonBody(GrantAccessBodySchema) },
    responses: {
      200: ok('Access granted', ClientEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      422: errorResponse('PAYMENT_NOT_CONFIRMED'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/clients/{id}/revoke-access',
    summary:
      'Revoke portal access: clears portal_access_enabled_at, deactivates member users, revokes sessions',
    tags: ['clients'],
    security: securedReq,
    request: requisitionIdParams,
    responses: {
      200: ok('Access revoked', RevokeAccessEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/api/v1/clients/{id}/members',
    summary: 'List client members',
    tags: ['clients'],
    security: securedReq,
    request: requisitionIdParams,
    responses: {
      200: ok('Members', MemberCollectionSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/clients/{id}/members/invite',
    summary:
      'Invite a member — a client_admin may invite only into their own client',
    tags: ['clients'],
    security: securedReq,
    request: { ...requisitionIdParams, ...jsonBody(InviteMemberBodySchema) },
    responses: {
      201: ok('Invited', MemberEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('WRONG_TENANT — inviting into another client'),
      422: errorResponse('Already a member | one-principal violation'),
    },
  });
  registry.registerPath({
    method: 'delete',
    path: '/api/v1/clients/{id}/members/{userId}',
    summary: 'Soft-remove a member; the last client_admin cannot be removed',
    tags: ['clients'],
    security: securedReq,
    request: memberParams,
    responses: {
      204: { description: 'Removed' },
      401: errorResponse('Unauthenticated'),
      422: errorResponse('Last client_admin cannot be removed'),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/clients/{id}/members/{userId}',
    summary: 'Change a member role or principal flag',
    tags: ['clients'],
    security: securedReq,
    request: { ...memberParams, ...jsonBody(UpdateMemberBodySchema) },
    responses: {
      200: ok('Updated', MemberEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      422: errorResponse('Last client_admin cannot be demoted | one-principal violation'),
    },
  });

  // --- question management (04 §4) ----------------------------------------
  const secured = [{ [bearerAuth.name]: [] }];
  const questionIdParams = { params: z.object({ id: z.string().uuid() }) };
  const optionParams = {
    params: z.object({ id: z.string().uuid(), optionId: z.string().uuid() }),
  };

  registry.registerPath({
    method: 'get',
    path: '/api/v1/questions',
    summary: 'List questions (all audiences), filterable',
    tags: ['questions'],
    security: secured,
    request: { query: ListQuestionsQuerySchema },
    responses: {
      200: ok('Questions', QuestionCollectionSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing question.view'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/questions',
    summary: 'Create a question with options, scopes, and conditional logic',
    tags: ['questions'],
    security: secured,
    request: jsonBody(CreateQuestionBodySchema),
    responses: {
      201: ok('Created', QuestionEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing question.manage'),
      422: errorResponse('INVALID_VALIDATION_RULE | CIRCULAR_CONDITION | VALIDATION_FAILED'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/api/v1/questions/preview',
    summary: 'Exact public form payload for admin preview',
    tags: ['questions'],
    security: secured,
    request: { query: IntakeFormQuerySchema },
    responses: {
      200: ok('Form definition', IntakeFormEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing question.view'),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/questions/reorder',
    summary: 'Persist an explicit question order within a category',
    tags: ['questions'],
    security: secured,
    request: jsonBody(ReorderQuestionsBodySchema),
    responses: {
      200: ok('Reordered', ReorderResponseSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing question.manage'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/api/v1/questions/{id}',
    summary: 'Question detail with options, scopes, dependents, usage stats',
    tags: ['questions'],
    security: secured,
    request: questionIdParams,
    responses: {
      200: ok('Question', QuestionEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found'),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/questions/{id}',
    summary: 'Update a question within the 03 §1.5 guard rails',
    tags: ['questions'],
    security: secured,
    request: { ...questionIdParams, ...jsonBody(UpdateQuestionBodySchema) },
    responses: {
      200: ok('Updated', QuestionEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      409: errorResponse('QUESTION_TYPE_LOCKED | MAPPED_QUESTION_PROTECTED'),
      422: errorResponse('INVALID_VALIDATION_RULE | CIRCULAR_CONDITION'),
    },
  });
  registry.registerPath({
    method: 'delete',
    path: '/api/v1/questions/{id}',
    summary: 'Soft-archive a question (answers untouched; mapped keys protected)',
    tags: ['questions'],
    security: secured,
    request: questionIdParams,
    responses: {
      204: { description: 'Archived' },
      401: errorResponse('Unauthenticated'),
      409: errorResponse('MAPPED_QUESTION_PROTECTED'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/questions/{id}/activate',
    summary: 'Set is_active = true',
    tags: ['questions'],
    security: secured,
    request: questionIdParams,
    responses: {
      200: ok('Activated', QuestionEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/questions/{id}/deactivate',
    summary: 'Set is_active = false; warns about conditional dependents',
    tags: ['questions'],
    security: secured,
    request: questionIdParams,
    responses: {
      200: ok('Deactivated with warnings[]', QuestionDeactivateEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/questions/{id}/duplicate',
    summary: 'Create an inactive copy with a new key',
    tags: ['questions'],
    security: secured,
    request: questionIdParams,
    responses: {
      201: ok('Duplicated', QuestionEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/questions/{id}/options',
    summary: 'Add an option',
    tags: ['questions'],
    security: secured,
    request: { ...questionIdParams, ...jsonBody(CreateQuestionOptionBodySchema) },
    responses: {
      201: ok('Option added', QuestionEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      422: errorResponse('Duplicate option value'),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/questions/{id}/options/{optionId}',
    summary: 'Edit option label/sort; value frozen once referenced',
    tags: ['questions'],
    security: secured,
    request: { ...optionParams, ...jsonBody(UpdateQuestionOptionBodySchema) },
    responses: {
      200: ok('Option updated', QuestionEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      422: errorResponse('Value frozen once referenced'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/questions/{id}/options/{optionId}/deactivate',
    summary: 'Soft-disable an option (no hard deletes)',
    tags: ['questions'],
    security: secured,
    request: optionParams,
    responses: {
      200: ok('Option deactivated', QuestionEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/question-categories',
    summary: 'List question categories',
    tags: ['questions'],
    security: secured,
    request: { query: ListQuestionCategoriesQuerySchema },
    responses: {
      200: ok('Categories', CategoryCollectionSchema),
      401: errorResponse('Unauthenticated'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/question-categories',
    summary: 'Create a category',
    tags: ['questions'],
    security: secured,
    request: jsonBody(CreateQuestionCategoryBodySchema),
    responses: {
      201: ok('Created', CategoryEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/question-categories/reorder',
    summary: 'Persist an explicit category order',
    tags: ['questions'],
    security: secured,
    request: jsonBody(ReorderQuestionCategoriesBodySchema),
    responses: {
      200: ok('Reordered', ReorderResponseSchema),
      401: errorResponse('Unauthenticated'),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/question-categories/{id}',
    summary: 'Edit label, description, sort order',
    tags: ['questions'],
    security: secured,
    request: { ...questionIdParams, ...jsonBody(UpdateQuestionCategoryBodySchema) },
    responses: {
      200: ok('Updated', CategoryEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/question-categories/{id}/activate',
    summary: 'Reactivate a category (restores prior per-question state)',
    tags: ['questions'],
    security: secured,
    request: questionIdParams,
    responses: {
      200: ok('Activated', CategoryEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/question-categories/{id}/deactivate',
    summary: 'Hide a category and its questions without touching their is_active',
    tags: ['questions'],
    security: secured,
    request: questionIdParams,
    responses: {
      200: ok('Deactivated', CategoryEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
    },
  });

  // --- taxonomy management (04 §5) ------------------------------------------
  // settings.manage for writes, requisition.view for reads. Engines are a
  // fixed set of five — no POST/DELETE path exists for them.
  const taxonomyIdParams = { params: z.object({ id: z.string().uuid() }) };

  registry.registerPath({
    method: 'get',
    path: '/api/v1/engines',
    summary: 'List the five fixed engines (5E model)',
    tags: ['taxonomy'],
    security: secured,
    request: { query: ListReferenceDataQuerySchema },
    responses: {
      200: ok('Engines', EngineCollectionSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing requisition.view'),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/engines/{id}',
    summary:
      'Edit an engine — only label, isStaffed, sortOrder; any other field is rejected (engines cannot be created or deleted)',
    tags: ['taxonomy'],
    security: secured,
    request: { ...taxonomyIdParams, ...jsonBody(UpdateEngineBodySchema) },
    responses: {
      200: ok('Updated', EngineEnvelopeSchema),
      400: errorResponse('Field outside label/isStaffed/sortOrder'),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing settings.manage'),
      404: errorResponse('Not found'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/departments',
    summary: 'List departments, filterable by engine and active state',
    tags: ['taxonomy'],
    security: secured,
    request: { query: ListDepartmentsQuerySchema },
    responses: {
      200: ok('Departments', DepartmentCollectionSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing requisition.view'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/departments',
    summary: 'Create a department under an engine (key auto-slugged from the label)',
    tags: ['taxonomy'],
    security: secured,
    request: jsonBody(CreateDepartmentBodySchema),
    responses: {
      201: ok('Created', DepartmentEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing settings.manage'),
      404: errorResponse('Engine not found'),
      422: errorResponse('Duplicate key within the engine'),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/departments/{id}',
    summary: 'Edit a department (key immutable; isActive: true reactivates)',
    tags: ['taxonomy'],
    security: secured,
    request: { ...taxonomyIdParams, ...jsonBody(UpdateDepartmentBodySchema) },
    responses: {
      200: ok('Updated', DepartmentEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found'),
      422: errorResponse('Key is immutable after creation'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/departments/{id}/deactivate',
    summary: 'Set is_active = false (no archived_at on taxonomy tables)',
    tags: ['taxonomy'],
    security: secured,
    request: taxonomyIdParams,
    responses: {
      200: ok('Deactivated', DepartmentEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/role-categories',
    summary: 'List role categories, filterable by department, engine, active state',
    tags: ['taxonomy'],
    security: secured,
    request: { query: ListRoleCategoriesQuerySchema },
    responses: {
      200: ok('Role categories', RoleCategoryCollectionSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing requisition.view'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/role-categories',
    summary:
      'Create a role category under a department (key auto-slugged from the label)',
    tags: ['taxonomy'],
    security: secured,
    request: jsonBody(CreateRoleCategoryBodySchema),
    responses: {
      201: ok('Created', RoleCategoryEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing settings.manage'),
      404: errorResponse('Department not found'),
      422: errorResponse('Duplicate key within the department'),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/role-categories/{id}',
    summary: 'Edit a role category (key immutable; isActive: true reactivates)',
    tags: ['taxonomy'],
    security: secured,
    request: { ...taxonomyIdParams, ...jsonBody(UpdateRoleCategoryBodySchema) },
    responses: {
      200: ok('Updated', RoleCategoryEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found'),
      422: errorResponse('Key is immutable after creation'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/role-categories/{id}/deactivate',
    summary: 'Set is_active = false; the public taxonomy cache is invalidated',
    tags: ['taxonomy'],
    security: secured,
    request: taxonomyIdParams,
    responses: {
      200: ok('Deactivated', RoleCategoryEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/tools',
    summary: 'List tools (full list — small reference data, no pagination)',
    tags: ['taxonomy'],
    security: secured,
    request: { query: ListReferenceDataQuerySchema },
    responses: {
      200: ok('Tools', TaxonomyToolCollectionSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing requisition.view'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/tools',
    summary: 'Add a tool (unique name)',
    tags: ['taxonomy'],
    security: secured,
    request: jsonBody(CreateToolBodySchema),
    responses: {
      201: ok('Created', TaxonomyToolEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing settings.manage'),
      422: errorResponse('Duplicate name'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/api/v1/skills',
    summary: 'List skills (full list — small reference data, no pagination)',
    tags: ['taxonomy'],
    security: secured,
    request: { query: ListReferenceDataQuerySchema },
    responses: {
      200: ok('Skills', TaxonomySkillCollectionSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing requisition.view'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/skills',
    summary: 'Add a skill (unique name)',
    tags: ['taxonomy'],
    security: secured,
    request: jsonBody(CreateSkillBodySchema),
    responses: {
      201: ok('Created', TaxonomySkillEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing settings.manage'),
      422: errorResponse('Duplicate name'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/api/v1/industries',
    summary: 'List industries (full list — small reference data, no pagination)',
    tags: ['taxonomy'],
    security: secured,
    request: { query: ListReferenceDataQuerySchema },
    responses: {
      200: ok('Industries', IndustryCollectionSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing requisition.view'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/industries',
    summary: 'Add an industry (unique name)',
    tags: ['taxonomy'],
    security: secured,
    request: jsonBody(CreateIndustryBodySchema),
    responses: {
      201: ok('Created', IndustryEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing settings.manage'),
      422: errorResponse('Duplicate name'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/disqualifiers',
    summary:
      'List disqualifiers; roleCategoryId filter returns that scope plus global rows',
    tags: ['taxonomy'],
    security: secured,
    request: { query: ListDisqualifiersQuerySchema },
    responses: {
      200: ok('Disqualifiers', DisqualifierCollectionSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing requisition.view'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/disqualifiers',
    summary: 'Create a disqualifier (key auto-slugged from the label)',
    tags: ['taxonomy'],
    security: secured,
    request: jsonBody(CreateDisqualifierBodySchema),
    responses: {
      201: ok('Created', DisqualifierEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing settings.manage'),
      422: errorResponse('Duplicate key'),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/disqualifiers/{id}',
    summary: 'Edit a disqualifier (key immutable after creation)',
    tags: ['taxonomy'],
    security: secured,
    request: { ...taxonomyIdParams, ...jsonBody(UpdateDisqualifierBodySchema) },
    responses: {
      200: ok('Updated', DisqualifierEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found'),
      422: errorResponse('Key is immutable after creation'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/rejection-reasons',
    summary: 'List rejection reasons, filterable by actor (client/admin)',
    tags: ['taxonomy'],
    security: secured,
    request: { query: ListRejectionReasonsQuerySchema },
    responses: {
      200: ok('Rejection reasons', RejectionReasonCollectionSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing requisition.view'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/rejection-reasons',
    summary:
      'Create a rejection reason — actor (client/admin) required; key auto-slugged and immutable thereafter',
    tags: ['taxonomy'],
    security: secured,
    request: jsonBody(CreateRejectionReasonBodySchema),
    responses: {
      201: ok('Created', RejectionReasonEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing settings.manage'),
      422: errorResponse('Duplicate key'),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/rejection-reasons/{id}',
    summary: 'Edit a rejection reason (key immutable after creation)',
    tags: ['taxonomy'],
    security: secured,
    request: {
      ...taxonomyIdParams,
      ...jsonBody(UpdateRejectionReasonBodySchema),
    },
    responses: {
      200: ok('Updated', RejectionReasonEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found'),
      422: errorResponse('Key is immutable after creation'),
    },
  });

  // --- candidates (04 §8) ---------------------------------------------------
  const candidateIdParams = { params: z.object({ id: z.string().uuid() }) };
  const candidateChildParams = {
    params: z.object({ id: z.string().uuid(), entryId: z.string().uuid() }),
  };
  const candidateFileParams = {
    params: z.object({ id: z.string().uuid(), fileId: z.string().uuid() }),
  };

  registry.registerPath({
    method: 'post',
    path: '/api/v1/candidates/webhook',
    summary:
      'Inbound sourcing webhook — static WEBHOOK_INBOUND_TOKEN bearer, lenient validation, upsert on externalId (04 §8.2)',
    tags: ['candidates'],
    request: jsonBody(WebhookCandidateBodySchema),
    responses: {
      200: ok('Ingested', WebhookResponseSchema),
      401: errorResponse('Missing or wrong webhook token'),
      422: errorResponse('firstName/lastName missing'),
      429: errorResponse('Rate limited'),
    },
  });

  registry.registerPath({
    method: 'get',
    path: '/api/v1/candidates',
    summary: 'List candidates (admin pool) with combined filters and cursor pagination',
    tags: ['candidates'],
    security: securedReq,
    request: { query: ListCandidatesQuerySchema },
    responses: {
      200: ok('Candidates', CandidateCollectionSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing candidate.view'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/candidates',
    summary: 'Create a candidate — only firstName and lastName required',
    tags: ['candidates'],
    security: securedReq,
    request: jsonBody(CreateCandidateBodySchema),
    responses: {
      201: ok('Created', CandidateEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing candidate.create'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/api/v1/candidates/{id}',
    summary: 'Full internal record with all child collections',
    tags: ['candidates'],
    security: securedReq,
    request: candidateIdParams,
    responses: {
      200: ok('Candidate detail', CandidateDetailEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found'),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/candidates/{id}',
    summary: 'Update candidate fields; data_completeness is recomputed',
    tags: ['candidates'],
    security: securedReq,
    request: { ...candidateIdParams, ...jsonBody(UpdateCandidateBodySchema) },
    responses: {
      200: ok('Updated', CandidateEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/candidates/{id}/archive',
    summary: 'Soft-archive (sets archived_at)',
    tags: ['candidates'],
    security: securedReq,
    request: candidateIdParams,
    responses: {
      200: ok('Archived', CandidateEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/candidates/{id}/consent',
    summary: 'Capture profile-sharing consent; sets consent_captured_at',
    tags: ['candidates'],
    security: securedReq,
    request: { ...candidateIdParams, ...jsonBody(CandidateConsentBodySchema) },
    responses: {
      200: ok('Consent recorded', CandidateEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found'),
    },
  });

  // Child collections: [path, GET schema, create/put schema+method, update schema?]
  const childCollections: {
    segment: string;
    collection: z.ZodTypeAny;
    write: { method: 'post' | 'put'; schema: z.ZodTypeAny };
    update?: z.ZodTypeAny;
    hasDelete?: boolean;
  }[] = [
    {
      segment: 'languages',
      collection: LanguageCollectionSchema,
      write: { method: 'post', schema: CreateCandidateLanguageBodySchema },
      update: UpdateCandidateLanguageBodySchema,
      hasDelete: true,
    },
    {
      segment: 'tools',
      collection: ToolCollectionSchema,
      write: { method: 'put', schema: PutCandidateToolsBodySchema },
    },
    {
      segment: 'skills',
      collection: SkillCollectionSchema,
      write: { method: 'put', schema: PutCandidateSkillsBodySchema },
    },
    {
      segment: 'employment-history',
      collection: EmploymentCollectionSchema,
      write: { method: 'post', schema: CreateCandidateEmploymentBodySchema },
      update: UpdateCandidateEmploymentBodySchema,
      hasDelete: true,
    },
    {
      segment: 'education',
      collection: EducationCollectionSchema,
      write: { method: 'post', schema: CreateCandidateEducationBodySchema },
      update: UpdateCandidateEducationBodySchema,
      hasDelete: true,
    },
    {
      segment: 'certifications',
      collection: CertificationCollectionSchema,
      write: { method: 'post', schema: CreateCandidateCertificationBodySchema },
      update: UpdateCandidateCertificationBodySchema,
      hasDelete: true,
    },
    {
      segment: 'references',
      collection: ReferenceCollectionSchema,
      write: { method: 'post', schema: CreateCandidateReferenceBodySchema },
      update: UpdateCandidateReferenceBodySchema,
      hasDelete: true,
    },
    {
      segment: 'notes',
      collection: NoteCollectionSchema,
      write: { method: 'post', schema: CreateCandidateNoteBodySchema },
    },
    {
      segment: 'disqualifier-checks',
      collection: DisqualifierCheckCollectionSchema,
      write: { method: 'put', schema: PutDisqualifierChecksBodySchema },
    },
    {
      segment: 'assessments',
      collection: AssessmentCollectionSchema,
      write: { method: 'post', schema: CreateCandidateAssessmentBodySchema },
    },
  ];

  for (const child of childCollections) {
    const base = `/api/v1/candidates/{id}/${child.segment}`;
    registry.registerPath({
      method: 'get',
      path: base,
      summary: `List candidate ${child.segment}`,
      tags: ['candidates'],
      security: securedReq,
      request: candidateIdParams,
      responses: {
        200: ok('Collection', child.collection),
        401: errorResponse('Unauthenticated'),
        404: errorResponse('Not found'),
      },
    });
    registry.registerPath({
      method: child.write.method,
      path: base,
      summary:
        child.write.method === 'put'
          ? `Replace the full ${child.segment} set`
          : `Add a ${child.segment} entry`,
      tags: ['candidates'],
      security: securedReq,
      request: { ...candidateIdParams, ...jsonBody(child.write.schema) },
      responses: {
        [child.write.method === 'put' ? 200 : 201]: ok(
          'Collection after write',
          child.collection,
        ),
        401: errorResponse('Unauthenticated'),
        422: errorResponse('Invalid reference or duplicate entry'),
      },
    });
    if (child.update !== undefined) {
      registry.registerPath({
        method: 'patch',
        path: `${base}/{entryId}`,
        summary: `Update a ${child.segment} entry`,
        tags: ['candidates'],
        security: securedReq,
        request: { ...candidateChildParams, ...jsonBody(child.update) },
        responses: {
          200: ok('Collection after write', child.collection),
          401: errorResponse('Unauthenticated'),
          404: errorResponse('Not found'),
        },
      });
    }
    if (child.hasDelete === true) {
      registry.registerPath({
        method: 'delete',
        path: `${base}/{entryId}`,
        summary: `Delete a ${child.segment} entry`,
        tags: ['candidates'],
        security: securedReq,
        request: candidateChildParams,
        responses: {
          204: { description: 'Deleted' },
          401: errorResponse('Unauthenticated'),
          404: errorResponse('Not found'),
        },
      });
    }
  }

  // --- candidate files (04 §8.1) --------------------------------------------
  registry.registerPath({
    method: 'post',
    path: '/api/v1/candidates/{id}/files/upload-url',
    summary:
      'Signed Storage upload URL; 415 outside NFR-5 MIME set, 413 above NFR-4 size',
    tags: ['candidates'],
    security: securedReq,
    request: { ...candidateIdParams, ...jsonBody(FileUploadUrlBodySchema) },
    responses: {
      201: ok('Pending file + signed URL', FileUploadUrlEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      413: errorResponse('FILE_TOO_LARGE'),
      415: errorResponse('UNSUPPORTED_MEDIA_TYPE'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/candidates/{id}/files/{fileId}/confirm',
    summary:
      'Confirm the upload (object exists, size matches); a CV queues text extraction',
    tags: ['candidates'],
    security: securedReq,
    request: candidateFileParams,
    responses: {
      200: ok('Confirmed', CandidateFileEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      422: errorResponse('Object missing or size mismatch'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/api/v1/candidates/{id}/files',
    summary: 'List candidate files',
    tags: ['candidates'],
    security: securedReq,
    request: candidateIdParams,
    responses: {
      200: ok('Files', FileCollectionSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found'),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/candidates/{id}/files/{fileId}',
    summary: 'Toggle isClientVisible, change fileType',
    tags: ['candidates'],
    security: securedReq,
    request: { ...candidateFileParams, ...jsonBody(UpdateCandidateFileBodySchema) },
    responses: {
      200: ok('Updated', CandidateFileEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found'),
    },
  });
  registry.registerPath({
    method: 'delete',
    path: '/api/v1/candidates/{id}/files/{fileId}',
    summary: 'Remove the storage object and the row',
    tags: ['candidates'],
    security: securedReq,
    request: candidateFileParams,
    responses: {
      204: { description: 'Deleted' },
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/api/v1/files/{fileId}/download-url',
    summary:
      '300-second signed download URL; client callers only for client-visible files of client-visibly assigned candidates',
    tags: ['candidates'],
    security: securedReq,
    request: { params: z.object({ fileId: z.string().uuid() }) },
    responses: {
      200: ok('Signed URL', FileDownloadUrlEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found or not visible to this caller'),
    },
  });

  // --- assignments and pipeline (04 §9) -------------------------------------
  const assignmentIdParams = { params: z.object({ id: z.string().uuid() }) };

  registry.registerPath({
    method: 'post',
    path: '/api/v1/requisitions/{id}/assignments',
    summary:
      'Assign candidates at sourced; 409 DUPLICATE_ASSIGNMENT on repeat; do-not-present list enforced',
    tags: ['assignments'],
    security: securedReq,
    request: { ...requisitionIdParams, ...jsonBody(CreateAssignmentsBodySchema) },
    responses: {
      201: ok('Assignments created', AdminAssignmentCollectionSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing candidate.assign'),
      409: errorResponse('DUPLICATE_ASSIGNMENT'),
      422: errorResponse('VALIDATION_FAILED — do_not_present_to_client_ids'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/api/v1/requisitions/{id}/assignments',
    summary:
      'Admin: full rows with candidate summary. Client: rows from client_visible_assignments only',
    tags: ['assignments'],
    security: securedReq,
    request: requisitionIdParams,
    responses: {
      200: ok('Assignments', AssignmentCollectionSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found (including cross-tenant addressing)'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/assignments/present',
    summary:
      'Bulk present, all-or-nothing: consent validated on every candidate; requisition → candidates_presented; notification per client user',
    tags: ['assignments'],
    security: securedReq,
    request: jsonBody(PresentBodySchema),
    responses: {
      200: ok('Presented', AdminAssignmentCollectionSchema),
      401: errorResponse('Unauthenticated'),
      409: errorResponse('INVALID_TRANSITION'),
      422: errorResponse('CONSENT_MISSING — nothing was presented'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/api/v1/assignments/{id}',
    summary: 'Admin: full row. Client: view-backed and stage-gated (404 for non-visible stages)',
    tags: ['assignments'],
    security: securedReq,
    request: assignmentIdParams,
    responses: {
      200: ok('Assignment', AssignmentEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found or not visible to this caller'),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/assignments/{id}',
    summary: 'Update adminNote, clientNote, sortOrder',
    tags: ['assignments'],
    security: securedReq,
    request: { ...assignmentIdParams, ...jsonBody(UpdateAssignmentBodySchema) },
    responses: {
      200: ok('Updated', AdminAssignmentEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing assignment.advance'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/assignments/{id}/advance',
    summary: 'Stage transition validated against the 01 §5 machine',
    tags: ['assignments'],
    security: securedReq,
    request: { ...assignmentIdParams, ...jsonBody(AdvanceBodySchema) },
    responses: {
      200: ok('Advanced', AdminAssignmentEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      409: errorResponse('INVALID_TRANSITION with { from, to } details'),
      422: errorResponse('CONSENT_MISSING when advancing into presented'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/assignments/{id}/approve-for-interview',
    summary:
      'Client action: presented → client_reviewing; fires client_decision_recorded to admins',
    tags: ['assignments'],
    security: securedReq,
    request: assignmentIdParams,
    responses: {
      200: ok('Approved', ClientVisibleAssignmentEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found or not a client-scoped caller'),
      409: errorResponse('INVALID_TRANSITION'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/assignments/{id}/reject',
    summary:
      'Reject: actor derived from the caller, never the body; writes a rejections row',
    tags: ['assignments'],
    security: securedReq,
    request: { ...assignmentIdParams, ...jsonBody(RejectBodySchema) },
    responses: {
      200: ok('Rejected', AssignmentEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      409: errorResponse('INVALID_TRANSITION'),
      422: errorResponse('VALIDATION_FAILED — reasonId or reasonOther required'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/assignments/{id}/request-interview',
    summary: 'Client action: notifies admins; no stage change, no interview record',
    tags: ['assignments'],
    security: securedReq,
    request: assignmentIdParams,
    responses: {
      200: ok('Requested', ClientVisibleAssignmentEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found or not a client-scoped caller'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/assignments/{id}/place',
    summary:
      'One transaction: placement row, assignment → placed, requisition → placed, siblings → closed_not_selected, candidate pool_status = placed',
    tags: ['placements'],
    security: securedReq,
    request: { ...assignmentIdParams, ...jsonBody(PlaceBodySchema) },
    responses: {
      201: ok('Placed', PlacementEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      409: errorResponse('INVALID_TRANSITION (assignment or requisition)'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/api/v1/assignments/{id}/events',
    summary: 'Chronological event log, app+trigger pairs de-duplicated (06 §2.3)',
    tags: ['assignments'],
    security: securedReq,
    request: assignmentIdParams,
    responses: {
      200: ok('Events', AssignmentEventCollectionSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing event.view'),
    },
  });

  // --- placements (04 §11) --------------------------------------------------
  registry.registerPath({
    method: 'get',
    path: '/api/v1/placements',
    summary: 'List placements — admin: all with filters; client: implicitly scoped',
    tags: ['placements'],
    security: securedReq,
    request: { query: ListPlacementsQuerySchema },
    responses: {
      200: ok('Placements', PlacementCollectionSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing client.view'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/api/v1/placements/{id}',
    summary: 'Placement detail; client callers read only their own (404 otherwise)',
    tags: ['placements'],
    security: securedReq,
    request: assignmentIdParams,
    responses: {
      200: ok('Placement', PlacementEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found (including cross-tenant addressing)'),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/placements/{id}',
    summary: 'Update placement terms or status; writes an event',
    tags: ['placements'],
    security: securedReq,
    request: { ...assignmentIdParams, ...jsonBody(UpdatePlacementBodySchema) },
    responses: {
      200: ok('Updated', PlacementEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing client.update'),
    },
  });

  // --- interviews (04 §10) ----------------------------------------------------
  registry.registerPath({
    method: 'post',
    path: '/api/v1/assignments/{id}/interviews',
    summary:
      'Create an interview; client_reviewing → interview_scheduled through the stage machine, unlocking gated PII; notifies client users and the creating admin',
    tags: ['interviews'],
    security: securedReq,
    request: { ...assignmentIdParams, ...jsonBody(CreateInterviewBodySchema) },
    responses: {
      201: ok('Interview created', InterviewEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing interview.create'),
      409: errorResponse('INVALID_TRANSITION — the machine has no edge into interview_scheduled from this stage'),
      422: errorResponse('VALIDATION_FAILED — round already exists'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/api/v1/assignments/{id}/interviews',
    summary:
      'List interviews of an assignment; client callers only for client-visible assignments of their own tenant',
    tags: ['interviews'],
    security: securedReq,
    request: assignmentIdParams,
    responses: {
      200: ok('Interviews', InterviewCollectionSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not found or not visible to this caller'),
    },
  });
  registry.registerPath({
    method: 'patch',
    path: '/api/v1/interviews/{id}',
    summary: 'Update schedule fields while the outcome is pending',
    tags: ['interviews'],
    security: securedReq,
    request: { ...assignmentIdParams, ...jsonBody(UpdateInterviewBodySchema) },
    responses: {
      200: ok('Updated', InterviewEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      422: errorResponse('Outcome already recorded'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/interviews/{id}/outcome',
    summary:
      'Record the outcome; interview_scheduled → interviewed when the resolved round leaves nothing pending',
    tags: ['interviews'],
    security: securedReq,
    request: { ...assignmentIdParams, ...jsonBody(OutcomeBodySchema) },
    responses: {
      200: ok('Outcome recorded', InterviewEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      422: errorResponse('Outcome already recorded'),
    },
  });
  registry.registerPath({
    method: 'post',
    path: '/api/v1/interviews/{id}/cancel',
    summary:
      'Cancel a pending interview (outcome = cancelled); the assignment stage is deliberately unchanged',
    tags: ['interviews'],
    security: securedReq,
    request: assignmentIdParams,
    responses: {
      200: ok('Cancelled', InterviewEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      422: errorResponse('Outcome already recorded'),
    },
  });

  // --- dashboards and reporting (04 §12) -------------------------------------
  registry.registerPath({
    method: 'get',
    path: '/api/v1/client/dashboard',
    summary:
      'Client landing page: own requisitions with client-visible stage summaries, pending actions, recent events',
    tags: ['dashboards'],
    security: securedReq,
    responses: {
      200: ok('Dashboard', ClientDashboardEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not a client-scoped caller'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/api/v1/admin/attention-queue',
    summary:
      'The seven needs-attention buckets of 01 §6; cached by the 5-minute refresh job, ?refresh=true recomputes',
    tags: ['dashboards'],
    security: securedReq,
    request: { query: AttentionQueueQuerySchema },
    responses: {
      200: ok('Attention queue', AttentionQueueEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not an admin-scoped caller'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/api/v1/admin/stats',
    summary:
      'Open requisitions, candidates by stage, average days-to-present (90d), active placements',
    tags: ['dashboards'],
    security: securedReq,
    responses: {
      200: ok('Stats', AdminStatsEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      404: errorResponse('Not an admin-scoped caller'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/api/v1/reports/rejection-reasons',
    summary:
      'Grouped rejection counts split by actor; free-text reasons listed under the other row',
    tags: ['reports'],
    security: securedReq,
    request: { query: RejectionReasonsQuerySchema },
    responses: {
      200: ok('Report', RejectionReasonsReportEnvelopeSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing event.view'),
      422: errorResponse('from after to'),
    },
  });
  registry.registerPath({
    method: 'get',
    path: '/api/v1/events',
    summary:
      'Queryable audit trail: filters + cursor pagination, app+trigger pairs de-duplicated (06 §2.3)',
    tags: ['events'],
    security: securedReq,
    request: { query: ListEventsQuerySchema },
    responses: {
      200: ok('Events', GlobalEventCollectionSchema),
      401: errorResponse('Unauthenticated'),
      403: errorResponse('Missing event.view'),
    },
  });

  const generator = new OpenApiGeneratorV31(registry.definitions);
  return generator.generateDocument({
    openapi: '3.1.0',
    info: {
      title: 'Staffing Done Better Portal API',
      version,
      description:
        'Generated from the Zod schemas in packages/contracts (docs/04-API.md §15).',
    },
    servers: [{ url: '/' }],
  });
}
