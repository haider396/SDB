/**
 * Reporting endpoints (docs/04-API.md §12): the rejection-reasons report —
 * the report that justifies structured rejection reasons (AC-PL-15).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { RejectionReasonsQuerySchema } from '@sdb/contracts';
import { ApiError } from '../lib/errors.js';
import { requirePermission } from '../middleware/require-permission.js';
import { RejectionReasonsReportEnvelopeSchema } from '../schemas/dashboard.js';
import type {
  ReportingActor,
  ReportingService,
} from '../services/reporting.service.js';

export interface ReportRoutesOptions {
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

export async function reportRoutes(
  fastify: FastifyInstance,
  opts: ReportRoutesOptions,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { reportingService } = opts;

  app.get(
    '/reports/rejection-reasons',
    {
      config: { permission: 'event.view' },
      onRequest: [app.authenticate],
      preValidation: [app.loadContext, requirePermission('event.view')],
      schema: {
        querystring: RejectionReasonsQuerySchema,
        response: { 200: RejectionReasonsReportEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await reportingService.getRejectionReasonsReport(
        request.query,
        actorOf(request),
      ),
    }),
  );
}
