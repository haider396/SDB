/**
 * Taxonomy-management endpoints (docs/04-API.md §5). Routes parse, authorise,
 * delegate, serialise — guard rails (fixed engine set, key immutability,
 * auto-slugging, cache invalidation) live in
 * services/taxonomy-admin.service.ts.
 *
 * Permissions: `settings.manage` for writes, `requisition.view` for reads.
 *
 * Engines cannot be created or deleted — the five are fixed, so no POST or
 * DELETE route exists (a request 404s at the router). The PATCH body is
 * strict: only label/isStaffed/sortOrder pass validation.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  CreateDepartmentBodySchema,
  CreateDisqualifierBodySchema,
  CreateIndustryBodySchema,
  CreateRejectionReasonBodySchema,
  CreateRoleCategoryBodySchema,
  CreateSkillBodySchema,
  CreateToolBodySchema,
  ListDepartmentsQuerySchema,
  ListDisqualifiersQuerySchema,
  ListReferenceDataQuerySchema,
  ListRejectionReasonsQuerySchema,
  ListRoleCategoriesQuerySchema,
  UpdateDepartmentBodySchema,
  UpdateDisqualifierBodySchema,
  UpdateEngineBodySchema,
  UpdateRejectionReasonBodySchema,
  UpdateRoleCategoryBodySchema,
} from '@sdb/contracts';
import { ApiError } from '../lib/errors.js';
import { requirePermission } from '../middleware/require-permission.js';
import { UuidParamSchema } from '../schemas/questions.js';
import {
  DepartmentCollectionSchema,
  DepartmentEnvelopeSchema,
  DisqualifierCollectionSchema,
  DisqualifierEnvelopeSchema,
  EngineCollectionSchema,
  EngineEnvelopeSchema,
  IndustryCollectionSchema,
  IndustryEnvelopeSchema,
  RejectionReasonCollectionSchema,
  RejectionReasonEnvelopeSchema,
  RoleCategoryCollectionSchema,
  RoleCategoryEnvelopeSchema,
  TaxonomySkillCollectionSchema,
  TaxonomySkillEnvelopeSchema,
  TaxonomyToolCollectionSchema,
  TaxonomyToolEnvelopeSchema,
} from '../schemas/taxonomy-admin.js';
import type { Actor } from '../services/questions.service.js';
import type { TaxonomyAdminService } from '../services/taxonomy-admin.service.js';

export interface TaxonomyRoutesOptions {
  taxonomyAdminService: TaxonomyAdminService;
}

function actorOf(request: FastifyRequest): Actor {
  const ctx = request.ctx;
  if (ctx === null) {
    throw new ApiError('UNAUTHENTICATED', 'Missing request context.');
  }
  return { userId: ctx.userId, role: ctx.primaryRole };
}

export async function taxonomyRoutes(
  fastify: FastifyInstance,
  opts: TaxonomyRoutesOptions,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const service = opts.taxonomyAdminService;

  const view = {
    config: { permission: 'requisition.view' as const },
    onRequest: [app.authenticate],
    preValidation: [app.loadContext, requirePermission('requisition.view')],
  };
  const manage = {
    config: { permission: 'settings.manage' as const },
    onRequest: [app.authenticate],
    preValidation: [app.loadContext, requirePermission('settings.manage')],
  };

  // --- engines (fixed set: GET + PATCH only) ---------------------------------

  app.get(
    '/engines',
    {
      ...view,
      schema: {
        querystring: ListReferenceDataQuerySchema,
        response: { 200: EngineCollectionSchema },
      },
    },
    async (request) => {
      const data = await service.listEngines(
        request.query.isActive === undefined
          ? {}
          : { isActive: request.query.isActive },
      );
      return { data, meta: { count: data.length, nextCursor: null } };
    },
  );

  app.patch(
    '/engines/:id',
    {
      ...manage,
      schema: {
        params: UuidParamSchema,
        body: UpdateEngineBodySchema,
        response: { 200: EngineEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await service.updateEngine(
        request.params.id,
        request.body,
        actorOf(request),
      );
      return { data };
    },
  );

  // --- departments -----------------------------------------------------------

  app.get(
    '/departments',
    {
      ...view,
      schema: {
        querystring: ListDepartmentsQuerySchema,
        response: { 200: DepartmentCollectionSchema },
      },
    },
    async (request) => {
      const data = await service.listDepartments(request.query);
      return { data, meta: { count: data.length, nextCursor: null } };
    },
  );

  app.post(
    '/departments',
    {
      ...manage,
      schema: {
        body: CreateDepartmentBodySchema,
        response: { 201: DepartmentEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const data = await service.createDepartment(request.body, actorOf(request));
      return reply.code(201).send({ data });
    },
  );

  app.patch(
    '/departments/:id',
    {
      ...manage,
      schema: {
        params: UuidParamSchema,
        body: UpdateDepartmentBodySchema,
        response: { 200: DepartmentEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await service.updateDepartment(
        request.params.id,
        request.body,
        actorOf(request),
      );
      return { data };
    },
  );

  app.post(
    '/departments/:id/deactivate',
    {
      ...manage,
      schema: {
        params: UuidParamSchema,
        response: { 200: DepartmentEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await service.deactivateDepartment(
        request.params.id,
        actorOf(request),
      );
      return { data };
    },
  );

  // --- role categories -------------------------------------------------------

  app.get(
    '/role-categories',
    {
      ...view,
      schema: {
        querystring: ListRoleCategoriesQuerySchema,
        response: { 200: RoleCategoryCollectionSchema },
      },
    },
    async (request) => {
      const data = await service.listRoleCategories(request.query);
      return { data, meta: { count: data.length, nextCursor: null } };
    },
  );

  app.post(
    '/role-categories',
    {
      ...manage,
      schema: {
        body: CreateRoleCategoryBodySchema,
        response: { 201: RoleCategoryEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const data = await service.createRoleCategory(
        request.body,
        actorOf(request),
      );
      return reply.code(201).send({ data });
    },
  );

  app.patch(
    '/role-categories/:id',
    {
      ...manage,
      schema: {
        params: UuidParamSchema,
        body: UpdateRoleCategoryBodySchema,
        response: { 200: RoleCategoryEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await service.updateRoleCategory(
        request.params.id,
        request.body,
        actorOf(request),
      );
      return { data };
    },
  );

  app.post(
    '/role-categories/:id/deactivate',
    {
      ...manage,
      schema: {
        params: UuidParamSchema,
        response: { 200: RoleCategoryEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await service.deactivateRoleCategory(
        request.params.id,
        actorOf(request),
      );
      return { data };
    },
  );

  // --- reference data: tools, skills, industries (GET/POST per 04 §5) --------

  app.get(
    '/tools',
    {
      ...view,
      schema: {
        querystring: ListReferenceDataQuerySchema,
        response: { 200: TaxonomyToolCollectionSchema },
      },
    },
    async (request) => {
      const data = await service.listTools(request.query);
      return { data, meta: { count: data.length, nextCursor: null } };
    },
  );

  app.post(
    '/tools',
    {
      ...manage,
      schema: {
        body: CreateToolBodySchema,
        response: { 201: TaxonomyToolEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const data = await service.createTool(request.body, actorOf(request));
      return reply.code(201).send({ data });
    },
  );

  app.get(
    '/skills',
    {
      ...view,
      schema: {
        querystring: ListReferenceDataQuerySchema,
        response: { 200: TaxonomySkillCollectionSchema },
      },
    },
    async (request) => {
      const data = await service.listSkills(request.query);
      return { data, meta: { count: data.length, nextCursor: null } };
    },
  );

  app.post(
    '/skills',
    {
      ...manage,
      schema: {
        body: CreateSkillBodySchema,
        response: { 201: TaxonomySkillEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const data = await service.createSkill(request.body, actorOf(request));
      return reply.code(201).send({ data });
    },
  );

  app.get(
    '/industries',
    {
      ...view,
      schema: {
        querystring: ListReferenceDataQuerySchema,
        response: { 200: IndustryCollectionSchema },
      },
    },
    async (request) => {
      const data = await service.listIndustries(request.query);
      return { data, meta: { count: data.length, nextCursor: null } };
    },
  );

  app.post(
    '/industries',
    {
      ...manage,
      schema: {
        body: CreateIndustryBodySchema,
        response: { 201: IndustryEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const data = await service.createIndustry(request.body, actorOf(request));
      return reply.code(201).send({ data });
    },
  );

  // --- disqualifiers ---------------------------------------------------------

  app.get(
    '/disqualifiers',
    {
      ...view,
      schema: {
        querystring: ListDisqualifiersQuerySchema,
        response: { 200: DisqualifierCollectionSchema },
      },
    },
    async (request) => {
      const data = await service.listDisqualifiers(request.query);
      return { data, meta: { count: data.length, nextCursor: null } };
    },
  );

  app.post(
    '/disqualifiers',
    {
      ...manage,
      schema: {
        body: CreateDisqualifierBodySchema,
        response: { 201: DisqualifierEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const data = await service.createDisqualifier(
        request.body,
        actorOf(request),
      );
      return reply.code(201).send({ data });
    },
  );

  app.patch(
    '/disqualifiers/:id',
    {
      ...manage,
      schema: {
        params: UuidParamSchema,
        body: UpdateDisqualifierBodySchema,
        response: { 200: DisqualifierEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await service.updateDisqualifier(
        request.params.id,
        request.body,
        actorOf(request),
      );
      return { data };
    },
  );

  // --- rejection reasons -----------------------------------------------------

  app.get(
    '/rejection-reasons',
    {
      ...view,
      schema: {
        querystring: ListRejectionReasonsQuerySchema,
        response: { 200: RejectionReasonCollectionSchema },
      },
    },
    async (request) => {
      const data = await service.listRejectionReasons(request.query);
      return { data, meta: { count: data.length, nextCursor: null } };
    },
  );

  app.post(
    '/rejection-reasons',
    {
      ...manage,
      schema: {
        body: CreateRejectionReasonBodySchema,
        response: { 201: RejectionReasonEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const data = await service.createRejectionReason(
        request.body,
        actorOf(request),
      );
      return reply.code(201).send({ data });
    },
  );

  app.patch(
    '/rejection-reasons/:id',
    {
      ...manage,
      schema: {
        params: UuidParamSchema,
        body: UpdateRejectionReasonBodySchema,
        response: { 200: RejectionReasonEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await service.updateRejectionReason(
        request.params.id,
        request.body,
        actorOf(request),
      );
      return { data };
    },
  );
}
