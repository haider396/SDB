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
