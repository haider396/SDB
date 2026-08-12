/**
 * Admin notification log (docs/06-BACKEND.md §4.3: "Admin UI exposes a
 * notification log view with a manual resend action").
 *
 * Permission choice, documented: 04 §13 has no notification endpoints, so
 * the closest analogues govern —
 * - GET is an operational log read, the same audit surface as `GET /events`,
 *   so it requires `event.view` (admin + super_admin).
 * - POST :id/resend mutates operational state and re-triggers an outbound
 *   send, an operational-settings-grade action, so it requires
 *   `settings.manage` (super_admin only per migration 0011).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { ListNotificationsQuerySchema } from '@sdb/contracts';
import { ApiError } from '../lib/errors.js';
import { requirePermission } from '../middleware/require-permission.js';
import {
  NotificationCollectionSchema,
  ResendEnvelopeSchema,
} from '../schemas/notifications.js';
import type {
  DispatchActor,
  NotificationDispatchService,
} from '../services/notification-dispatch.service.js';

export interface NotificationRoutesOptions {
  notificationDispatch: NotificationDispatchService;
}

const NotificationIdParamSchema = z.object({ id: z.string().uuid() });

function actorOf(request: FastifyRequest): DispatchActor {
  const ctx = request.ctx;
  if (ctx === null) {
    throw new ApiError('UNAUTHENTICATED', 'Missing request context.');
  }
  return { userId: ctx.userId, role: ctx.primaryRole };
}

export async function notificationRoutes(
  fastify: FastifyInstance,
  opts: NotificationRoutesOptions,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { notificationDispatch } = opts;

  const guarded = (permission: Parameters<typeof requirePermission>[0]) => ({
    config: { permission },
    onRequest: [app.authenticate],
    preValidation: [app.loadContext, requirePermission(permission)],
  });

  app.get(
    '/admin/notifications',
    {
      ...guarded('event.view'),
      schema: {
        querystring: ListNotificationsQuerySchema,
        response: { 200: NotificationCollectionSchema },
      },
    },
    async (request) => {
      const { data, nextCursor } = await notificationDispatch.list(request.query);
      return { data, meta: { count: data.length, nextCursor } };
    },
  );

  app.post(
    '/admin/notifications/:id/resend',
    {
      ...guarded('settings.manage'),
      schema: {
        params: NotificationIdParamSchema,
        response: { 200: ResendEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await notificationDispatch.resend(request.params.id, actorOf(request)),
    }),
  );
}
