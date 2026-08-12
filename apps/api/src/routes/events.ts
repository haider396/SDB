/**
 * Global event log (docs/04-API.md §12 GET /events): the queryable audit
 * trail (06 §7). Cursor-paginated newest first, app+trigger pairs
 * de-duplicated for display (06 §2.3).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { ListEventsQuerySchema } from '@sdb/contracts';
import { ApiError } from '../lib/errors.js';
import { requirePermission } from '../middleware/require-permission.js';
import { GlobalEventCollectionSchema } from '../schemas/dashboard.js';
import type {
  ReportingActor,
  ReportingService,
} from '../services/reporting.service.js';

export interface EventRoutesOptions {
  reportingService: ReportingService;
}

function actorOf(request: FastifyRequest): ReportingActor {
  const ctx = request.ctx;
  if (ctx === null) {
    throw new ApiError('UNAUTHENTICATED', 'Missing request context.');
  }
  return {
    userId: ctx.userId,
    role: ctx.primaryRole,
    ownClientId: ctx.clientIds[0] ?? null,
  };
}

export async function eventRoutes(
  fastify: FastifyInstance,
  opts: EventRoutesOptions,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { reportingService } = opts;

  app.get(
    '/events',
    {
      config: { permission: 'event.view' },
      onRequest: [app.authenticate],
      preValidation: [app.loadContext, requirePermission('event.view')],
      schema: {
        querystring: ListEventsQuerySchema,
        response: { 200: GlobalEventCollectionSchema },
      },
    },
    async (request) => {
      const { data, nextCursor } = await reportingService.listEvents(
        request.query,
        actorOf(request),
      );
      return { data, meta: { count: data.length, nextCursor } };
    },
  );
}
