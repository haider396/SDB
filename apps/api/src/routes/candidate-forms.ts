/**
 * Candidate Form Builder endpoints (admin only).
 *
 * Routes parse, authorise, delegate, serialise — every guard rail, and the
 * whole activation gate, lives in services/candidate-forms.service.ts.
 *
 * Permissions reuse `question.manage` / `question.view`: a form builder is
 * question configuration with a layout layer on top, and PERMISSION_KEYS is
 * documented as exhaustive for the MVP.
 *
 * That reuse is why `admin` now holds `question.manage`. 0011 seeded it to
 * super_admin only, which meant an admin-role user could open /admin/forms
 * (gated on `question.manage`'s read sibling) and then 403 on every save,
 * publish and block edit. Migration 0027 grants it to `admin` as well. It stays
 * out of reach of both client roles.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  CreateCandidateFormBodySchema,
  CreateFormBlockBodySchema,
  ListCandidateFormsQuerySchema,
  SaveFormDocumentBodySchema,
  UpdateCandidateFormBodySchema,
  UpdateFormBlockBodySchema,
} from '@sdb/contracts';
import { ApiError } from '../lib/errors.js';
import { requirePermission } from '../middleware/require-permission.js';
import {
  ActivateFormEnvelopeSchema,
  CandidateFormCollectionSchema,
  CandidateFormEnvelopeSchema,
  DeletedEnvelopeSchema,
  FormBlockEnvelopeSchema,
  FormBlockParamsSchema,
  FormIdParamSchema,
  FormStatusEnvelopeSchema,
  FormVersionEnvelopeSchema,
  FormVersionParamsSchema,
} from '../schemas/candidate-forms.js';
import type { Actor, CandidateFormsService } from '../services/candidate-forms.service.js';

export interface CandidateFormRoutesOptions {
  candidateFormsService: CandidateFormsService;
}

function actorOf(request: FastifyRequest): Actor {
  const ctx = request.ctx;
  if (ctx === null) {
    throw new ApiError('UNAUTHENTICATED', 'Missing request context.');
  }
  return { userId: ctx.userId, role: ctx.primaryRole };
}

export async function candidateFormRoutes(
  fastify: FastifyInstance,
  opts: CandidateFormRoutesOptions,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { candidateFormsService: service } = opts;

  const view = {
    config: { permission: 'question.view' as const },
    onRequest: [app.authenticate],
    preValidation: [app.loadContext, requirePermission('question.view')],
  };
  const manage = {
    config: { permission: 'question.manage' as const },
    onRequest: [app.authenticate],
    preValidation: [app.loadContext, requirePermission('question.manage')],
  };

  // --- forms ---------------------------------------------------------------

  app.get(
    '/candidate-forms',
    {
      ...view,
      schema: {
        querystring: ListCandidateFormsQuerySchema,
        response: { 200: CandidateFormCollectionSchema },
      },
    },
    async (request) => {
      const data = await service.list(request.query);
      return { data, meta: { count: data.length, nextCursor: null } };
    },
  );

  app.post(
    '/candidate-forms',
    {
      ...manage,
      schema: {
        body: CreateCandidateFormBodySchema,
        response: { 201: CandidateFormEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const data = await service.create(request.body, actorOf(request));
      return reply.code(201).send({ data });
    },
  );

  app.get(
    '/candidate-forms/:id',
    {
      ...view,
      schema: {
        params: FormIdParamSchema,
        response: { 200: CandidateFormEnvelopeSchema },
      },
    },
    async (request) => ({ data: await service.get(request.params.id) }),
  );

  app.patch(
    '/candidate-forms/:id',
    {
      ...manage,
      schema: {
        params: FormIdParamSchema,
        body: UpdateCandidateFormBodySchema,
        response: { 200: CandidateFormEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await service.update(request.params.id, request.body, actorOf(request)),
    }),
  );

  app.delete(
    '/candidate-forms/:id',
    {
      ...manage,
      schema: {
        params: FormIdParamSchema,
        response: { 200: DeletedEnvelopeSchema },
      },
    },
    async (request) => {
      await service.archive(request.params.id, actorOf(request));
      return { data: { deleted: true as const } };
    },
  );

  // --- status --------------------------------------------------------------

  app.post(
    '/candidate-forms/:id/activate',
    {
      ...manage,
      schema: {
        params: FormIdParamSchema,
        response: { 200: ActivateFormEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await service.activate(request.params.id, actorOf(request)),
    }),
  );

  app.post(
    '/candidate-forms/:id/deactivate',
    {
      ...manage,
      schema: {
        params: FormIdParamSchema,
        response: { 200: FormStatusEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await service.deactivate(request.params.id, actorOf(request)),
    }),
  );

  // --- versions ------------------------------------------------------------

  app.post(
    '/candidate-forms/:id/versions',
    {
      ...manage,
      schema: {
        params: FormIdParamSchema,
        response: { 201: FormVersionEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const data = await service.createDraft(request.params.id, actorOf(request));
      return reply.code(201).send({ data });
    },
  );

  /** Whole-document save — the builder's Save button. */
  app.put(
    '/candidate-forms/:id/versions/:versionId',
    {
      ...manage,
      schema: {
        params: FormVersionParamsSchema,
        body: SaveFormDocumentBodySchema,
        response: { 200: FormVersionEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await service.saveDocument(
        request.params.id,
        request.params.versionId,
        request.body,
        actorOf(request),
      ),
    }),
  );

  // --- blocks --------------------------------------------------------------

  app.post(
    '/candidate-forms/:id/versions/:versionId/blocks',
    {
      ...manage,
      schema: {
        params: FormVersionParamsSchema,
        body: CreateFormBlockBodySchema,
        response: { 201: FormBlockEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const data = await service.addBlock(
        request.params.id,
        request.params.versionId,
        request.body,
        actorOf(request),
      );
      return reply.code(201).send({ data });
    },
  );

  /**
   * Single-block patch — the drag/resize endpoint. One row updated, so two
   * admins arranging the same canvas cannot overwrite each other's work.
   */
  app.patch(
    '/candidate-forms/:id/versions/:versionId/blocks/:blockId',
    {
      ...manage,
      schema: {
        params: FormBlockParamsSchema,
        body: UpdateFormBlockBodySchema,
        response: { 200: FormBlockEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await service.patchBlock(
        request.params.id,
        request.params.versionId,
        request.params.blockId,
        request.body,
        actorOf(request),
      ),
    }),
  );

  app.delete(
    '/candidate-forms/:id/versions/:versionId/blocks/:blockId',
    {
      ...manage,
      schema: {
        params: FormBlockParamsSchema,
        response: { 200: DeletedEnvelopeSchema },
      },
    },
    async (request) => {
      await service.removeBlock(
        request.params.id,
        request.params.versionId,
        request.params.blockId,
        actorOf(request),
      );
      return { data: { deleted: true as const } };
    },
  );
}
