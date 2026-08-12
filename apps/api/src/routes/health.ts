/**
 * Health endpoints (docs/04-API.md §14). Public, no envelope — shapes are as
 * documented: `{ status, version, uptimeSeconds }`.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import type { Db } from '../lib/db.js';
import type { SupabaseStoragePort } from '../lib/supabase-storage.js';
import {
  HealthResponseSchema,
  ReadyResponseSchema,
} from '../schemas/health.js';

export interface HealthRoutesOptions {
  db: Db;
  storage: SupabaseStoragePort;
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

      // Storage reachability: stat a probe path. A null result (object absent)
      // still proves the bucket API answered; only a thrown error is a failure.
      let storage = false;
      try {
        await opts.storage.statObject('.readiness-probe');
        storage = true;
      } catch {
        storage = false;
      }

      const ready = database && storage;
      return reply.code(ready ? 200 : 503).send({
        status: ready ? ('ready' as const) : ('not_ready' as const),
        checks: { database, storage },
      });
    },
  );
}
