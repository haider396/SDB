/**
 * Health endpoints (docs/04-API.md §14). Public, no envelope — shapes are as
 * documented: `{ status, version, uptimeSeconds }`.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Db } from '../lib/db.js';
import {
  HealthResponseSchema,
  ReadyResponseSchema,
} from '../schemas/health.js';

export interface HealthRoutesOptions {
  db: Db;
  version: string;
}

 
export async function healthRoutes(
  fastify: FastifyInstance,
  opts: HealthRoutesOptions,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/health',
    { schema: { response: { 200: HealthResponseSchema } } },
    async () => ({
      status: 'ok' as const,
      version: opts.version,
      uptimeSeconds: Math.floor(process.uptime()),
    }),
  );

  app.get(
    '/health/ready',
    {
      schema: {
        response: { 200: ReadyResponseSchema, 503: ReadyResponseSchema },
      },
    },
    async (_request, reply) => {
      let database = false;
      try {
        await opts.db`select 1`;
        database = true;
      } catch {
        database = false;
      }

      // TODO(P3): replace the stub with a real Storage reachability check when
      // the Supabase Storage integration (file uploads, 06 §6) lands in P3.
      const storage = true;

      const ready = database && storage;
      return reply.code(ready ? 200 : 503).send({
        status: ready ? ('ready' as const) : ('not_ready' as const),
        checks: { database, storage },
      });
    },
  );
}
