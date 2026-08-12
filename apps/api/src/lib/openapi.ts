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
  CreateQuestionBodySchema,
  CreateQuestionCategoryBodySchema,
  CreateQuestionOptionBodySchema,
  InPortalRequisitionBodySchema,
  IntakeSubmissionSchema,
  ListQuestionCategoriesQuerySchema,
  ListQuestionsQuerySchema,
  ReorderQuestionCategoriesBodySchema,
  ReorderQuestionsBodySchema,
  UpdateQuestionBodySchema,
  UpdateQuestionCategoryBodySchema,
  UpdateQuestionOptionBodySchema,
} from '@sdb/contracts';
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
