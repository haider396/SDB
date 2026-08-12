/**
 * Interview endpoints (docs/04-API.md §10). Routes parse, authorise,
 * delegate, serialise — the stage rules, round assignment, outcome/cancel
 * rules, and the interview_scheduled notification fan-out live in
 * services/interviews.service.ts.
 *
 * Guards attach at preValidation so a denied caller receives 403 before body
 * validation can 400 (04 §1.3).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  CreateInterviewBodySchema,
  OutcomeBodySchema,
  UpdateInterviewBodySchema,
} from '@sdb/contracts';
import { ApiError } from '../lib/errors.js';
import { requirePermission } from '../middleware/require-permission.js';
import {
  InterviewCollectionSchema,
  InterviewEnvelopeSchema,
  InterviewIdParamSchema,
} from '../schemas/interviews.js';
import type {
  InterviewActor,
  InterviewsService,
} from '../services/interviews.service.js';

export interface InterviewRoutesOptions {
  interviewsService: InterviewsService;
}

function actorOf(request: FastifyRequest): InterviewActor {
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

export async function interviewRoutes(
  fastify: FastifyInstance,
  opts: InterviewRoutesOptions,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { interviewsService } = opts;

  const guarded = (permission: Parameters<typeof requirePermission>[0]) => ({
    config: { permission },
    onRequest: [app.authenticate],
    preValidation: [app.loadContext, requirePermission(permission)],
  });

  app.post(
    '/assignments/:id/interviews',
    {
      ...guarded('interview.create'),
      schema: {
        params: InterviewIdParamSchema,
        body: CreateInterviewBodySchema,
        response: { 201: InterviewEnvelopeSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send({
        data: await interviewsService.create(
          request.params.id,
          request.body,
          actorOf(request),
        ),
      }),
  );

  app.get(
    '/assignments/:id/interviews',
    {
      ...guarded('interview.view'),
      schema: {
        params: InterviewIdParamSchema,
        response: { 200: InterviewCollectionSchema },
      },
    },
    async (request) => {
      const data = await interviewsService.listForAssignment(
        request.params.id,
        actorOf(request),
      );
      return { data, meta: { count: data.length, nextCursor: null } };
    },
  );

  app.patch(
    '/interviews/:id',
    {
      ...guarded('interview.update'),
      schema: {
        params: InterviewIdParamSchema,
        body: UpdateInterviewBodySchema,
        response: { 200: InterviewEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await interviewsService.update(
        request.params.id,
        request.body,
        actorOf(request),
      ),
    }),
  );

  app.post(
    '/interviews/:id/outcome',
    {
      ...guarded('interview.update'),
      schema: {
        params: InterviewIdParamSchema,
        body: OutcomeBodySchema,
        response: { 200: InterviewEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await interviewsService.recordOutcome(
        request.params.id,
        request.body,
        actorOf(request),
      ),
    }),
  );

  app.post(
    '/interviews/:id/cancel',
    {
      ...guarded('interview.update'),
      schema: {
        params: InterviewIdParamSchema,
        response: { 200: InterviewEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await interviewsService.cancel(request.params.id, actorOf(request)),
    }),
  );
}
