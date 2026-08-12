/**
 * Dashboard endpoints (docs/04-API.md §12): the client landing page and the
 * admin attention queue + stats. Routes parse, authorise, delegate,
 * serialise — bucket assembly, thresholds, caching, and tenant scoping live
 * in the services.
 *
 * All three declare `requisition.view`; which SURFACE exists depends on the
 * caller's membership scope, resolved server-side (04 §1.3): the client
 * dashboard 404s for unscoped callers, the admin endpoints 404 for
 * client-scoped callers.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { AttentionQueueQuerySchema } from '@sdb/contracts';
import { ApiError } from '../lib/errors.js';
import { requirePermission } from '../middleware/require-permission.js';
import {
  AdminStatsEnvelopeSchema,
  AttentionQueueEnvelopeSchema,
  ClientDashboardEnvelopeSchema,
} from '../schemas/dashboard.js';
import type { AttentionQueueService } from '../services/attention-queue.service.js';
import type {
  DashboardActor,
  DashboardService,
} from '../services/dashboard.service.js';
import type { ReportingService } from '../services/reporting.service.js';

export interface DashboardRoutesOptions {
  dashboardService: DashboardService;
  attentionQueueService: AttentionQueueService;
  reportingService: ReportingService;
}

function actorOf(request: FastifyRequest): DashboardActor {
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

export async function dashboardRoutes(
  fastify: FastifyInstance,
  opts: DashboardRoutesOptions,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { dashboardService, attentionQueueService, reportingService } = opts;

  const guarded = (permission: Parameters<typeof requirePermission>[0]) => ({
    config: { permission },
    onRequest: [app.authenticate],
    preValidation: [app.loadContext, requirePermission(permission)],
  });

  app.get(
    '/client/dashboard',
    {
      ...guarded('requisition.view'),
      schema: { response: { 200: ClientDashboardEnvelopeSchema } },
    },
    async (request) => ({
      data: await dashboardService.getClientDashboard(actorOf(request)),
    }),
  );

  app.get(
    '/admin/attention-queue',
    {
      ...guarded('requisition.view'),
      schema: {
        querystring: AttentionQueueQuerySchema,
        response: { 200: AttentionQueueEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await attentionQueueService.get(actorOf(request), {
        ...(request.query.refresh !== undefined
          ? { forceRefresh: request.query.refresh }
          : {}),
      }),
    }),
  );

  app.get(
    '/admin/stats',
    {
      ...guarded('requisition.view'),
      schema: { response: { 200: AdminStatsEnvelopeSchema } },
    },
    async (request) => ({
      data: await reportingService.getAdminStats(actorOf(request)),
    }),
  );
}
