/**
 * Public endpoints for built candidate forms.
 *
 * No `config.permission`, no `authenticate`, no `loadContext` — that absence
 * is what keeps these out of the permission matrix. Abuse is bounded by the
 * global 60 req/min/IP limiter; captcha and virus scanning are deferred by
 * explicit decision, so treat a shared link as spammable by design. The email
 * identity rule bounds the damage to one candidate row per address.
 *
 * A draft, deactivated, archived or unknown slug all 404 identically: a closed
 * form must not leak that it was ever open, and that decision belongs on the
 * server, never in a client-side filter.
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { CandidateFormSubmissionSchema } from '@sdb/contracts';
import { PublicFormEnvelopeSchema } from '../schemas/candidate-forms.js';
import type { CandidateFormPublicService } from '../services/candidate-form-public.service.js';
import type { CandidateFormSubmissionService } from '../services/candidate-form-submission.service.js';

export interface CandidateFormPublicRoutesOptions {
  publicFormService: CandidateFormPublicService;
  submissionService: CandidateFormSubmissionService;
}

const SlugParamSchema = z.object({
  slug: z.string().min(3).max(64),
});

const ReceivedEnvelopeSchema = z.object({
  data: z.object({ received: z.literal(true) }),
});

/** Salted hash — the raw IP is never stored (NFR-12). */
function hashIp(request: FastifyRequest): string | null {
  const ip = request.ip;
  if (typeof ip !== 'string' || ip === '') return null;
  return createHash('sha256').update(`sdb-registration:${ip}`).digest('hex');
}

export async function candidateFormPublicRoutes(
  fastify: FastifyInstance,
  opts: CandidateFormPublicRoutesOptions,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { publicFormService, submissionService } = opts;

  app.get(
    '/candidate-forms/public/:slug',
    {
      schema: {
        params: SlugParamSchema,
        response: { 200: PublicFormEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await publicFormService.getBySlug(request.params.slug),
    }),
  );

  app.post(
    '/candidate-forms/public/:slug/submissions',
    {
      schema: {
        params: SlugParamSchema,
        body: CandidateFormSubmissionSchema,
        response: { 201: ReceivedEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const data = await submissionService.submit(
        request.params.slug,
        request.body,
        { ipHash: hashIp(request) },
      );
      return reply.code(201).send({ data });
    },
  );
}
