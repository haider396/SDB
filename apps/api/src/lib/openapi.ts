/**
 * OpenAPI 3.1 document generated from the Zod schemas in @sdb/contracts via
 * @asteasolutions/zod-to-openapi (docs/04-API.md §15). Never hand-written —
 * every path registered here references the same schema objects the routes
 * validate with, so the document and the validation share one source.
 */
import {
  OpenAPIRegistry,
  OpenApiGeneratorV31,
} from '@asteasolutions/zod-to-openapi';
import type { OpenAPIObject } from 'openapi3-ts/oas31';
import {
  AcceptInvitationBodySchema,
  ApiErrorSchema,
} from '@sdb/contracts';
import {
  AcceptInvitationResponseSchema,
  AuthMeEnvelopeSchema,
} from '../schemas/auth.js';
import {
  HealthResponseSchema,
  ReadyResponseSchema,
} from '../schemas/health.js';

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
