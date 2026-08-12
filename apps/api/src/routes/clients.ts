/**
 * Client-management endpoints (docs/04-API.md §6). Routes parse, authorise,
 * delegate, serialise — the payment gate, tenancy rules, transactions, and
 * the last-client_admin guard live in services/clients.service.ts.
 *
 * Guards attach at preValidation so a denied caller receives 403 before body
 * validation can 400 (04 §1.3). Tenancy is enforced in the service from the
 * caller's membership — a clientId is never trusted from the request body.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  ConfirmPaymentBodySchema,
  CreateClientBodySchema,
  GrantAccessBodySchema,
  InviteMemberBodySchema,
  ListClientsQuerySchema,
  UpdateClientBodySchema,
  UpdateMemberBodySchema,
} from '@sdb/contracts';
import { ApiError } from '../lib/errors.js';
import { requirePermission } from '../middleware/require-permission.js';
import {
  ClientCollectionSchema,
  ClientEnvelopeSchema,
  ClientIdParamSchema,
  MemberCollectionSchema,
  MemberEnvelopeSchema,
  MemberParamsSchema,
  RevokeAccessEnvelopeSchema,
} from '../schemas/clients.js';
import type { ClientActor, ClientsService } from '../services/clients.service.js';

export interface ClientRoutesOptions {
  clientsService: ClientsService;
}

function actorOf(request: FastifyRequest): ClientActor {
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

export async function clientRoutes(
  fastify: FastifyInstance,
  opts: ClientRoutesOptions,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { clientsService } = opts;

  const guarded = (permission: Parameters<typeof requirePermission>[0]) => ({
    config: { permission },
    onRequest: [app.authenticate],
    preValidation: [app.loadContext, requirePermission(permission)],
  });

  app.get(
    '/clients',
    {
      ...guarded('client.view'),
      schema: {
        querystring: ListClientsQuerySchema,
        response: { 200: ClientCollectionSchema },
      },
    },
    async (request) => {
      // 04 §6: the collection is an admin surface. A client-scoped caller
      // holds client.view for their OWN client only, so their "list" is
      // exactly that one client — never an enumeration of the tenant base.
      const actor = actorOf(request);
      if (actor.ownClientId !== null) {
        const own = await clientsService.get(actor.ownClientId, actor);
        return { data: [own], meta: { count: 1, nextCursor: null } };
      }
      const { data, nextCursor } = await clientsService.list(request.query);
      return { data, meta: { count: data.length, nextCursor } };
    },
  );

  app.post(
    '/clients',
    {
      ...guarded('client.create'),
      schema: {
        body: CreateClientBodySchema,
        response: { 201: ClientEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const data = await clientsService.create(request.body, actorOf(request));
      return reply.code(201).send({ data });
    },
  );

  app.get(
    '/clients/:id',
    {
      ...guarded('client.view'),
      schema: {
        params: ClientIdParamSchema,
        response: { 200: ClientEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await clientsService.get(request.params.id, actorOf(request));
      return { data };
    },
  );

  app.patch(
    '/clients/:id',
    {
      ...guarded('client.update'),
      schema: {
        params: ClientIdParamSchema,
        body: UpdateClientBodySchema,
        response: { 200: ClientEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await clientsService.update(
        request.params.id,
        request.body,
        actorOf(request),
      );
      return { data };
    },
  );

  app.post(
    '/clients/:id/confirm-payment',
    {
      ...guarded('client.grant_access'),
      schema: {
        params: ClientIdParamSchema,
        body: ConfirmPaymentBodySchema,
        response: { 200: ClientEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await clientsService.confirmPayment(
        request.params.id,
        request.body,
        actorOf(request),
      );
      return { data };
    },
  );

  app.post(
    '/clients/:id/grant-access',
    {
      ...guarded('client.grant_access'),
      schema: {
        params: ClientIdParamSchema,
        body: GrantAccessBodySchema,
        response: { 200: ClientEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await clientsService.grantAccess(
        request.params.id,
        request.body,
        actorOf(request),
      );
      return { data };
    },
  );

  app.post(
    '/clients/:id/revoke-access',
    {
      ...guarded('client.grant_access'),
      schema: {
        params: ClientIdParamSchema,
        response: { 200: RevokeAccessEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await clientsService.revokeAccess(
        request.params.id,
        actorOf(request),
      );
      return { data };
    },
  );

  app.get(
    '/clients/:id/members',
    {
      ...guarded('client.view'),
      schema: {
        params: ClientIdParamSchema,
        response: { 200: MemberCollectionSchema },
      },
    },
    async (request) => {
      const data = await clientsService.listMembers(
        request.params.id,
        actorOf(request),
      );
      return { data, meta: { count: data.length, nextCursor: null } };
    },
  );

  app.post(
    '/clients/:id/members/invite',
    {
      ...guarded('client.invite_user'),
      schema: {
        params: ClientIdParamSchema,
        body: InviteMemberBodySchema,
        response: { 201: MemberEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const data = await clientsService.inviteMember(
        request.params.id,
        request.body,
        actorOf(request),
      );
      return reply.code(201).send({ data });
    },
  );

  app.delete(
    '/clients/:id/members/:userId',
    {
      ...guarded('client.invite_user'),
      schema: { params: MemberParamsSchema },
    },
    async (request, reply) => {
      await clientsService.removeMember(
        request.params.id,
        request.params.userId,
        actorOf(request),
      );
      return reply.code(204).send();
    },
  );

  app.patch(
    '/clients/:id/members/:userId',
    {
      ...guarded('client.invite_user'),
      schema: {
        params: MemberParamsSchema,
        body: UpdateMemberBodySchema,
        response: { 200: MemberEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await clientsService.updateMember(
        request.params.id,
        request.params.userId,
        request.body,
        actorOf(request),
      );
      return { data };
    },
  );
}
