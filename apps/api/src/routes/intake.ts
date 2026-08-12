/**
 * Public intake endpoints (docs/04-API.md §3):
 *   GET  /intake-form         — form definition (03 §3.2 rules 1–7)
 *   GET  /taxonomy/public     — cascading engine → department → role selects
 *   POST /intake-submissions  — the 6-step validated public submission
 *
 * All three are public and covered by the global 60 req/min/IP limiter
 * (registered in app.ts per 04 §1).
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { IntakeSubmissionSchema } from '@sdb/contracts';
import {
  IntakeFormEnvelopeSchema,
  IntakeFormQuerySchema,
  IntakeSubmissionEnvelopeSchema,
  TaxonomyEnvelopeSchema,
} from '../schemas/intake.js';
import type { IntakeFormService } from '../services/intake-form.service.js';
import type { IntakeSubmissionService } from '../services/intake-submission.service.js';

export interface IntakeRoutesOptions {
  intakeFormService: IntakeFormService;
  intakeSubmissionService: IntakeSubmissionService;
}

export async function intakeRoutes(
  fastify: FastifyInstance,
  opts: IntakeRoutesOptions,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/intake-form',
    {
      schema: {
        querystring: IntakeFormQuerySchema,
        response: { 200: IntakeFormEnvelopeSchema },
      },
    },
    async (request) => {
      // `audience` is ignored: the public endpoint serves audience 'client'
      // only; internal questions are never exposed (AC-IF-02).
      const data = await opts.intakeFormService.getForm(
        request.query.roleCategoryId ?? null,
      );
      return { data };
    },
  );

  app.get(
    '/taxonomy/public',
    { schema: { response: { 200: TaxonomyEnvelopeSchema } } },
    async () => {
      const data = await opts.intakeFormService.getTaxonomy();
      return { data };
    },
  );

  app.post(
    '/intake-submissions',
    {
      schema: {
        body: IntakeSubmissionSchema,
        response: { 201: IntakeSubmissionEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const data = await opts.intakeSubmissionService.submitPublic(request.body);
      return reply.code(201).send({ data });
    },
  );
}
