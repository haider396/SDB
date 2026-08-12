/**
 * Question-management endpoints (docs/04-API.md §4). Routes parse, authorise,
 * delegate, serialise — the guard rails from 03 §1.5/§2 live in
 * services/questions.service.ts.
 *
 * Permissions: `question.manage` for writes, `question.view` for reads.
 * Static paths (/questions/preview, /questions/reorder) are registered as
 * literals — find-my-way matches them before /questions/:id.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  CreateQuestionBodySchema,
  CreateQuestionCategoryBodySchema,
  CreateQuestionOptionBodySchema,
  ListQuestionCategoriesQuerySchema,
  ListQuestionsQuerySchema,
  ReorderQuestionCategoriesBodySchema,
  ReorderQuestionsBodySchema,
  UpdateQuestionBodySchema,
  UpdateQuestionCategoryBodySchema,
  UpdateQuestionOptionBodySchema,
} from '@sdb/contracts';
import { ApiError } from '../lib/errors.js';
import { requirePermission } from '../middleware/require-permission.js';
import { IntakeFormEnvelopeSchema, IntakeFormQuerySchema } from '../schemas/intake.js';
import {
  CategoryCollectionSchema,
  CategoryEnvelopeSchema,
  OptionParamsSchema,
  QuestionCollectionSchema,
  QuestionDeactivateEnvelopeSchema,
  QuestionEnvelopeSchema,
  ReorderResponseSchema,
  UuidParamSchema,
} from '../schemas/questions.js';
import type { IntakeFormService } from '../services/intake-form.service.js';
import type { Actor, QuestionsService } from '../services/questions.service.js';

export interface QuestionRoutesOptions {
  questionsService: QuestionsService;
  intakeFormService: IntakeFormService;
}

function actorOf(request: FastifyRequest): Actor {
  const ctx = request.ctx;
  if (ctx === null) {
    throw new ApiError('UNAUTHENTICATED', 'Missing request context.');
  }
  return { userId: ctx.userId, role: ctx.primaryRole };
}

export async function questionRoutes(
  fastify: FastifyInstance,
  opts: QuestionRoutesOptions,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { questionsService } = opts;

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

  // --- questions -------------------------------------------------------------

  app.get(
    '/questions',
    {
      ...view,
      schema: {
        querystring: ListQuestionsQuerySchema,
        response: { 200: QuestionCollectionSchema },
      },
    },
    async (request) => {
      const data = await questionsService.listQuestions(request.query);
      return { data, meta: { count: data.length, nextCursor: null } };
    },
  );

  // Static route, registered before /questions/:id semantics apply.
  // Returns the EXACT public payload for admin preview (04 §4, 03 §2.2).
  app.get(
    '/questions/preview',
    {
      ...view,
      schema: {
        querystring: IntakeFormQuerySchema,
        response: { 200: IntakeFormEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await opts.intakeFormService.getForm(
        request.query.roleCategoryId ?? null,
      );
      return { data };
    },
  );

  app.post(
    '/questions',
    {
      ...manage,
      schema: {
        body: CreateQuestionBodySchema,
        response: { 201: QuestionEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const data = await questionsService.createQuestion(
        request.body,
        actorOf(request),
      );
      return reply.code(201).send({ data });
    },
  );

  app.patch(
    '/questions/reorder',
    {
      ...manage,
      schema: {
        body: ReorderQuestionsBodySchema,
        response: { 200: ReorderResponseSchema },
      },
    },
    async (request) => {
      await questionsService.reorderQuestions(request.body, actorOf(request));
      return { data: { reordered: true as const } };
    },
  );

  app.get(
    '/questions/:id',
    {
      ...view,
      schema: {
        params: UuidParamSchema,
        response: { 200: QuestionEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await questionsService.getQuestion(request.params.id);
      return { data };
    },
  );

  app.patch(
    '/questions/:id',
    {
      ...manage,
      schema: {
        params: UuidParamSchema,
        body: UpdateQuestionBodySchema,
        response: { 200: QuestionEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await questionsService.updateQuestion(
        request.params.id,
        request.body,
        actorOf(request),
      );
      return { data };
    },
  );

  // Soft delete only (03 §1.5): archives the question; answers stay intact.
  // Mapped questions are protected → 409 MAPPED_QUESTION_PROTECTED (AC-Q-07).
  app.delete(
    '/questions/:id',
    {
      ...manage,
      schema: { params: UuidParamSchema },
    },
    async (request, reply) => {
      await questionsService.archiveQuestion(request.params.id, actorOf(request));
      return reply.code(204).send();
    },
  );

  app.post(
    '/questions/:id/activate',
    {
      ...manage,
      schema: {
        params: UuidParamSchema,
        response: { 200: QuestionEnvelopeSchema },
      },
    },
    async (request) => {
      const { question } = await questionsService.setQuestionActive(
        request.params.id,
        true,
        actorOf(request),
      );
      return { data: question };
    },
  );

  app.post(
    '/questions/:id/deactivate',
    {
      ...manage,
      schema: {
        params: UuidParamSchema,
        response: { 200: QuestionDeactivateEnvelopeSchema },
      },
    },
    async (request) => {
      const { question, warnings } = await questionsService.setQuestionActive(
        request.params.id,
        false,
        actorOf(request),
      );
      return { data: question, warnings };
    },
  );

  app.post(
    '/questions/:id/duplicate',
    {
      ...manage,
      schema: {
        params: UuidParamSchema,
        response: { 201: QuestionEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const data = await questionsService.duplicateQuestion(
        request.params.id,
        actorOf(request),
      );
      return reply.code(201).send({ data });
    },
  );

  // --- options ---------------------------------------------------------------

  app.post(
    '/questions/:id/options',
    {
      ...manage,
      schema: {
        params: UuidParamSchema,
        body: CreateQuestionOptionBodySchema,
        response: { 201: QuestionEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const data = await questionsService.addOption(
        request.params.id,
        request.body,
        actorOf(request),
      );
      return reply.code(201).send({ data });
    },
  );

  app.patch(
    '/questions/:id/options/:optionId',
    {
      ...manage,
      schema: {
        params: OptionParamsSchema,
        body: UpdateQuestionOptionBodySchema,
        response: { 200: QuestionEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await questionsService.updateOption(
        request.params.id,
        request.params.optionId,
        request.body,
        actorOf(request),
      );
      return { data };
    },
  );

  app.post(
    '/questions/:id/options/:optionId/deactivate',
    {
      ...manage,
      schema: {
        params: OptionParamsSchema,
        response: { 200: QuestionEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await questionsService.deactivateOption(
        request.params.id,
        request.params.optionId,
        actorOf(request),
      );
      return { data };
    },
  );

  // --- categories ------------------------------------------------------------

  app.get(
    '/question-categories',
    {
      ...view,
      schema: {
        querystring: ListQuestionCategoriesQuerySchema,
        response: { 200: CategoryCollectionSchema },
      },
    },
    async (request) => {
      const data = await questionsService.listCategories(
        request.query.isActive === undefined
          ? {}
          : { isActive: request.query.isActive },
      );
      return { data, meta: { count: data.length, nextCursor: null } };
    },
  );

  app.post(
    '/question-categories',
    {
      ...manage,
      schema: {
        body: CreateQuestionCategoryBodySchema,
        response: { 201: CategoryEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const data = await questionsService.createCategory(
        request.body,
        actorOf(request),
      );
      return reply.code(201).send({ data });
    },
  );

  app.patch(
    '/question-categories/reorder',
    {
      ...manage,
      schema: {
        body: ReorderQuestionCategoriesBodySchema,
        response: { 200: ReorderResponseSchema },
      },
    },
    async (request) => {
      await questionsService.reorderCategories(request.body, actorOf(request));
      return { data: { reordered: true as const } };
    },
  );

  app.patch(
    '/question-categories/:id',
    {
      ...manage,
      schema: {
        params: UuidParamSchema,
        body: UpdateQuestionCategoryBodySchema,
        response: { 200: CategoryEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await questionsService.updateCategory(
        request.params.id,
        request.body,
        actorOf(request),
      );
      return { data };
    },
  );

  app.post(
    '/question-categories/:id/activate',
    {
      ...manage,
      schema: {
        params: UuidParamSchema,
        response: { 200: CategoryEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await questionsService.setCategoryActive(
        request.params.id,
        true,
        actorOf(request),
      );
      return { data };
    },
  );

  app.post(
    '/question-categories/:id/deactivate',
    {
      ...manage,
      schema: {
        params: UuidParamSchema,
        response: { 200: CategoryEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await questionsService.setCategoryActive(
        request.params.id,
        false,
        actorOf(request),
      );
      return { data };
    },
  );
}
