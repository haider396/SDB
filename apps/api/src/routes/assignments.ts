/**
 * Assignment and pipeline endpoints (docs/04-API.md §9). Routes parse,
 * authorise, delegate, serialise — the stage machine, consent gate, actor
 * derivation, tenant scoping, and the present/place transactions live in
 * services/assignments.service.ts.
 *
 * Guards attach at preValidation so a denied caller receives 403 before body
 * validation can 400 (04 §1.3). Client-scoped callers are identified by their
 * membership-resolved clientId in the actor — never by anything in the
 * request.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  AdvanceBodySchema,
  CreateAssignmentsBodySchema,
  PlaceBodySchema,
  PresentBodySchema,
  RejectBodySchema,
  UpdateAssignmentBodySchema,
} from '@sdb/contracts';
import { ApiError } from '../lib/errors.js';
import { requirePermission } from '../middleware/require-permission.js';
import {
  AdminAssignmentCollectionSchema,
  AdminAssignmentEnvelopeSchema,
  AssignmentCollectionSchema,
  AssignmentEnvelopeSchema,
  AssignmentEventCollectionSchema,
  AssignmentIdParamSchema,
  ClientVisibleAssignmentEnvelopeSchema,
  PlacementEnvelopeSchema,
} from '../schemas/assignments.js';
import type {
  AssignmentActor,
  AssignmentsService,
} from '../services/assignments.service.js';

export interface AssignmentRoutesOptions {
  assignmentsService: AssignmentsService;
}

function actorOf(request: FastifyRequest): AssignmentActor {
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

export async function assignmentRoutes(
  fastify: FastifyInstance,
  opts: AssignmentRoutesOptions,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { assignmentsService } = opts;

  const guarded = (permission: Parameters<typeof requirePermission>[0]) => ({
    config: { permission },
    onRequest: [app.authenticate],
    preValidation: [app.loadContext, requirePermission(permission)],
  });

  const unpaged = <T>(data: T[]) => ({
    data,
    meta: { count: data.length, nextCursor: null },
  });

  // --- requisition-nested (04 §9 rows 1–2) ----------------------------------
  app.post(
    '/requisitions/:id/assignments',
    {
      ...guarded('candidate.assign'),
      schema: {
        params: AssignmentIdParamSchema,
        body: CreateAssignmentsBodySchema,
        response: { 201: AdminAssignmentCollectionSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send(
        unpaged(
          await assignmentsService.assign(
            request.params.id,
            request.body,
            actorOf(request),
          ),
        ),
      ),
  );

  app.get(
    '/requisitions/:id/assignments',
    {
      ...guarded('assignment.view'),
      schema: {
        params: AssignmentIdParamSchema,
        response: { 200: AssignmentCollectionSchema },
      },
    },
    async (request) => {
      // A[] | C[] — not expressible through the generic unpaged helper.
      const data = await assignmentsService.listForRequisition(
        request.params.id,
        actorOf(request),
      );
      return { data, meta: { count: data.length, nextCursor: null } };
    },
  );

  // --- bulk present (04 §9, J5) — static segment before :id routes ----------
  app.post(
    '/assignments/present',
    {
      ...guarded('candidate.present'),
      schema: {
        body: PresentBodySchema,
        response: { 200: AdminAssignmentCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await assignmentsService.present(request.body, actorOf(request)),
      ),
  );

  // --- single assignment ----------------------------------------------------
  app.get(
    '/assignments/:id',
    {
      ...guarded('assignment.view'),
      schema: {
        params: AssignmentIdParamSchema,
        response: { 200: AssignmentEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await assignmentsService.get(request.params.id, actorOf(request)),
    }),
  );

  app.patch(
    '/assignments/:id',
    {
      ...guarded('assignment.advance'),
      schema: {
        params: AssignmentIdParamSchema,
        body: UpdateAssignmentBodySchema,
        response: { 200: AdminAssignmentEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await assignmentsService.update(
        request.params.id,
        request.body,
        actorOf(request),
      ),
    }),
  );

  app.post(
    '/assignments/:id/advance',
    {
      ...guarded('assignment.advance'),
      schema: {
        params: AssignmentIdParamSchema,
        body: AdvanceBodySchema,
        response: { 200: AdminAssignmentEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await assignmentsService.advance(
        request.params.id,
        request.body.toStage,
        request.body.note ?? null,
        actorOf(request),
      ),
    }),
  );

  app.post(
    '/assignments/:id/approve-for-interview',
    {
      ...guarded('assignment.view'),
      schema: {
        params: AssignmentIdParamSchema,
        response: { 200: ClientVisibleAssignmentEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await assignmentsService.approveForInterview(
        request.params.id,
        actorOf(request),
      ),
    }),
  );

  app.post(
    '/assignments/:id/reject',
    {
      ...guarded('assignment.reject'),
      schema: {
        params: AssignmentIdParamSchema,
        body: RejectBodySchema,
        response: { 200: AssignmentEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await assignmentsService.reject(
        request.params.id,
        request.body,
        actorOf(request),
      ),
    }),
  );

  app.post(
    '/assignments/:id/request-interview',
    {
      ...guarded('assignment.view'),
      schema: {
        params: AssignmentIdParamSchema,
        response: { 200: ClientVisibleAssignmentEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await assignmentsService.requestInterview(
        request.params.id,
        actorOf(request),
      ),
    }),
  );

  app.post(
    '/assignments/:id/place',
    {
      ...guarded('assignment.advance'),
      schema: {
        params: AssignmentIdParamSchema,
        body: PlaceBodySchema,
        response: { 201: PlacementEnvelopeSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send({
        data: await assignmentsService.place(
          request.params.id,
          request.body,
          actorOf(request),
        ),
      }),
  );

  app.get(
    '/assignments/:id/events',
    {
      ...guarded('event.view'),
      schema: {
        params: AssignmentIdParamSchema,
        response: { 200: AssignmentEventCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await assignmentsService.listEvents(request.params.id, actorOf(request)),
      ),
  );
}
