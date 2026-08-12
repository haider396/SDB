/**
 * Auth endpoints (docs/04-API.md §2). Routes parse, authorise, delegate,
 * serialise — business logic lives in services/auth.service.ts.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AcceptInvitationBodySchema } from '@sdb/contracts';
import { ApiError } from '../lib/errors.js';
import {
  AcceptInvitationResponseSchema,
  AuthMeEnvelopeSchema,
} from '../schemas/auth.js';
import type { AuthService } from '../services/auth.service.js';

export interface AuthRoutesOptions {
  authService: AuthService;
}

 
export async function authRoutes(
  fastify: FastifyInstance,
  opts: AuthRoutesOptions,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  // Public. Rate-limited at the public tier by the global limiter.
  app.post(
    '/auth/accept-invitation',
    {
      schema: {
        body: AcceptInvitationBodySchema,
        response: { 200: AcceptInvitationResponseSchema },
      },
    },
    async (request) => {
      const result = await opts.authService.acceptInvitation(request.body);
      return { data: result };
    },
  );

  app.get(
    '/auth/me',
    {
      onRequest: [app.authenticate],
      preHandler: [app.loadContext],
      schema: { response: { 200: AuthMeEnvelopeSchema } },
    },
    async (request) => {
      const ctx = request.ctx;
      if (ctx === null) {
        throw new ApiError('UNAUTHENTICATED', 'Missing request context.');
      }
      return {
        data: {
          user: ctx.user,
          roles: ctx.roles,
          permissions: [...ctx.permissions],
          clientId: ctx.clientIds[0] ?? null,
        },
      };
    },
  );

  app.post(
    '/auth/logout',
    { onRequest: [app.authenticate] },
    async (request, reply) => {
      const token = request.accessToken;
      if (token === null) {
        throw new ApiError('UNAUTHENTICATED', 'Missing bearer token.');
      }
      await opts.authService.logout(token);
      return reply.code(204).send();
    },
  );
}
