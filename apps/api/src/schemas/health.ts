/**
 * Health endpoint shapes (docs/04-API.md §14). Shared by route validation and
 * the OpenAPI generator.
 */
import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  version: z.string(),
  uptimeSeconds: z.number().int().nonnegative(),
});

export const ReadyResponseSchema = z.object({
  status: z.enum(['ready', 'not_ready']),
  checks: z.object({
    database: z.boolean(),
    storage: z.boolean(),
  }),
});
