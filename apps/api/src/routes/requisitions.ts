/**
 * POST /api/v1/requisitions — the authenticated in-portal entry point of the
 * intake form engine (docs/03-INTAKE-FORM-ENGINE.md §3.5, 04 §7).
 *
 * Same engine and validation pipeline as the public submission; differences:
 * - requires `requisition.create`
 * - client-scoped callers attach to their own client (clientId never accepted
 *   from the request, 04 §1.3); admins must pass `clientId`
 * - no prospect client is created
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { InPortalRequisitionBodySchema } from '@sdb/contracts';
import { ApiError } from '../lib/errors.js';
import { requirePermission } from '../middleware/require-permission.js';
import { InPortalRequisitionEnvelopeSchema } from '../schemas/intake.js';
import type { IntakeSubmissionService } from '../services/intake-submission.service.js';

export interface RequisitionRoutesOptions {
  intakeSubmissionService: IntakeSubmissionService;
}

export async function requisitionRoutes(
  fastify: FastifyInstance,
  opts: RequisitionRoutesOptions,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    '/requisitions',
    {
      config: { permission: 'requisition.create' },
      onRequest: [app.authenticate],
      preValidation: [app.loadContext, requirePermission('requisition.create')],
      schema: {
        body: InPortalRequisitionBodySchema,
        response: { 201: InPortalRequisitionEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const ctx = request.ctx;
      if (ctx === null) {
        throw new ApiError('UNAUTHENTICATED', 'Missing request context.');
      }
      const { clientId, ...submission } = request.body;
      const data = await opts.intakeSubmissionService.submitInPortal(
        submission,
        {
          userId: ctx.userId,
          role: ctx.primaryRole,
          // Membership-derived scope; body clientId is ignored for scoped
          // callers and honoured only for admins (03 §3.5).
          ownClientId: ctx.clientIds[0] ?? null,
        },
        clientId,
      );
      return reply.code(201).send({ data });
    },
  );
}
