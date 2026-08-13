/**
 * Requisition endpoints (docs/04-API.md §7). Routes parse, authorise,
 * delegate, serialise — the state machine, principal identity rule, and
 * commercials gating live in services/requisitions.service.ts.
 *
 * POST /requisitions is the authenticated in-portal entry point of the intake
 * form engine (docs/03-INTAKE-FORM-ENGINE.md §3.5): same engine and
 * validation pipeline as the public submission; client-scoped callers attach
 * to their own client (clientId never accepted from the request, 04 §1.3);
 * admins must pass `clientId`.
 *
 * The requisition-nested assignment endpoints (POST/GET
 * /requisitions/:id/assignments) live in routes/assignments.ts with the rest
 * of the pipeline surface (04 §9).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  InPortalRequisitionBodySchema,
  ListRequisitionsQuerySchema,
  PrincipalRequestChangesBodySchema,
  TransitionRequisitionBodySchema,
  UpdateRequisitionAnswersBodySchema,
  UpdateRequisitionBodySchema,
} from '@sdb/contracts';
import { ApiError } from '../lib/errors.js';
import { requirePermission } from '../middleware/require-permission.js';
import { InPortalRequisitionEnvelopeSchema } from '../schemas/intake.js';
import {
  EventCollectionSchema,
  RequisitionCollectionSchema,
  RequisitionDetailEnvelopeSchema,
  RequisitionEnvelopeSchema,
  RequisitionIdParamSchema,
} from '../schemas/requisitions.js';
import type { IntakeSubmissionService } from '../services/intake-submission.service.js';
import type {
  RequisitionActor,
  RequisitionsService,
} from '../services/requisitions.service.js';

export interface RequisitionRoutesOptions {
  intakeSubmissionService: IntakeSubmissionService;
  requisitionsService: RequisitionsService;
}

function actorOf(request: FastifyRequest): RequisitionActor {
  const ctx = request.ctx;
  if (ctx === null) {
    throw new ApiError('UNAUTHENTICATED', 'Missing request context.');
  }
  return {
    userId: ctx.userId,
    role: ctx.primaryRole,
    // Membership-derived scope (04 §1.3): the tenant filter for client
    // callers comes from here, never from the request.
    ownClientId: ctx.clientIds[0] ?? null,
    canViewCommercials: ctx.permissions.has('requisition.view_commercials'),
  };
}

export async function requisitionRoutes(
  fastify: FastifyInstance,
  opts: RequisitionRoutesOptions,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { requisitionsService } = opts;

  const guarded = (permission: Parameters<typeof requirePermission>[0]) => ({
    config: { permission },
    onRequest: [app.authenticate],
    preValidation: [app.loadContext, requirePermission(permission)],
  });

  app.get(
    '/requisitions',
    {
      ...guarded('requisition.view'),
      schema: {
        querystring: ListRequisitionsQuerySchema,
        response: { 200: RequisitionCollectionSchema },
      },
    },
    async (request) => {
      const { data, nextCursor, total } = await requisitionsService.list(
        request.query,
        actorOf(request),
      );
      return {
        data,
        meta: {
          count: data.length,
          nextCursor,
          ...(total !== undefined ? { total } : {}),
        },
      };
    },
  );

  app.post(
    '/requisitions',
    {
      ...guarded('requisition.create'),
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

  app.get(
    '/requisitions/:id',
    {
      ...guarded('requisition.view'),
      schema: {
        params: RequisitionIdParamSchema,
        response: { 200: RequisitionDetailEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await requisitionsService.get(
        request.params.id,
        actorOf(request),
      );
      return { data };
    },
  );

  app.patch(
    '/requisitions/:id',
    {
      ...guarded('requisition.update'),
      schema: {
        params: RequisitionIdParamSchema,
        body: UpdateRequisitionBodySchema,
        response: { 200: RequisitionDetailEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await requisitionsService.update(
        request.params.id,
        request.body,
        actorOf(request),
      );
      return { data };
    },
  );

  app.patch(
    '/requisitions/:id/answers',
    {
      ...guarded('requisition.update'),
      schema: {
        params: RequisitionIdParamSchema,
        body: UpdateRequisitionAnswersBodySchema,
        response: { 200: RequisitionDetailEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await requisitionsService.updateAnswers(
        request.params.id,
        request.body.answers,
        actorOf(request),
      );
      return { data };
    },
  );

  app.post(
    '/requisitions/:id/transition',
    {
      ...guarded('requisition.transition'),
      schema: {
        params: RequisitionIdParamSchema,
        body: TransitionRequisitionBodySchema,
        response: { 200: RequisitionEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await requisitionsService.transition(
        request.params.id,
        request.body,
        actorOf(request),
      );
      return { data };
    },
  );

  app.post(
    '/requisitions/:id/request-principal-approval',
    {
      ...guarded('requisition.transition'),
      schema: {
        params: RequisitionIdParamSchema,
        response: { 200: RequisitionEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await requisitionsService.requestPrincipalApproval(
        request.params.id,
        actorOf(request),
      );
      return { data };
    },
  );

  app.post(
    '/requisitions/:id/principal-approve',
    {
      ...guarded('requisition.approve_as_principal'),
      schema: {
        params: RequisitionIdParamSchema,
        response: { 200: RequisitionEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await requisitionsService.principalApprove(
        request.params.id,
        actorOf(request),
      );
      return { data };
    },
  );

  app.post(
    '/requisitions/:id/principal-request-changes',
    {
      ...guarded('requisition.approve_as_principal'),
      schema: {
        params: RequisitionIdParamSchema,
        body: PrincipalRequestChangesBodySchema,
        response: { 200: RequisitionEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await requisitionsService.principalRequestChanges(
        request.params.id,
        request.body.comment,
        actorOf(request),
      );
      return { data };
    },
  );

  app.get(
    '/requisitions/:id/events',
    {
      ...guarded('event.view'),
      schema: {
        params: RequisitionIdParamSchema,
        response: { 200: EventCollectionSchema },
      },
    },
    async (request) => {
      const data = await requisitionsService.listEvents(
        request.params.id,
        actorOf(request),
      );
      return { data, meta: { count: data.length, nextCursor: null } };
    },
  );
}
