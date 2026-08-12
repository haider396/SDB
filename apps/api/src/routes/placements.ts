/**
 * Placement endpoints (docs/04-API.md §11). Creation happens exclusively via
 * POST /assignments/:id/place (routes/assignments.ts) — there is no
 * POST /placements.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ListPlacementsQuerySchema,
  UpdatePlacementBodySchema,
} from '@sdb/contracts';
import { ApiError } from '../lib/errors.js';
import { requirePermission } from '../middleware/require-permission.js';
import {
  PlacementCollectionSchema,
  PlacementEnvelopeSchema,
  PlacementIdParamSchema,
} from '../schemas/assignments.js';
import type {
  PlacementActor,
  PlacementsService,
} from '../services/placements.service.js';

export interface PlacementRoutesOptions {
  placementsService: PlacementsService;
}

function actorOf(request: FastifyRequest): PlacementActor {
  const ctx = request.ctx;
  if (ctx === null) {
    throw new ApiError('UNAUTHENTICATED', 'Missing request context.');
  }
  return {
    userId: ctx.userId,
    role: ctx.primaryRole,
    // Membership-derived scope (04 §1.3): null for admin callers.
    ownClientId: ctx.clientIds[0] ?? null,
  };
}

export async function placementRoutes(
  fastify: FastifyInstance,
  opts: PlacementRoutesOptions,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { placementsService } = opts;

  const guarded = (permission: Parameters<typeof requirePermission>[0]) => ({
    config: { permission },
    onRequest: [app.authenticate],
    preValidation: [app.loadContext, requirePermission(permission)],
  });

  app.get(
    '/placements',
    {
      ...guarded('client.view'),
      schema: {
        querystring: ListPlacementsQuerySchema,
        response: { 200: PlacementCollectionSchema },
      },
    },
    async (request) => {
      const { data, nextCursor } = await placementsService.list(
        request.query,
        actorOf(request),
      );
      return { data, meta: { count: data.length, nextCursor } };
    },
  );

  app.get(
    '/placements/:id',
    {
      ...guarded('client.view'),
      schema: {
        params: PlacementIdParamSchema,
        response: { 200: PlacementEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await placementsService.get(request.params.id, actorOf(request)),
    }),
  );

  app.patch(
    '/placements/:id',
    {
      ...guarded('client.update'),
      schema: {
        params: PlacementIdParamSchema,
        body: UpdatePlacementBodySchema,
        response: { 200: PlacementEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await placementsService.update(
        request.params.id,
        request.body,
        actorOf(request),
      ),
    }),
  );
}
