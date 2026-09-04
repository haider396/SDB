/**
 * Public candidate registration endpoints (T38):
 *   GET  /candidate-registration-form                          — form definition
 *   POST /candidate-registrations/session                      — start a session
 *   POST /candidate-registrations/:sessionId/upload-url        — signed upload
 *   POST /candidate-registrations/:sessionId/files/:fileId/confirm
 *   POST /candidate-registrations                              — submit
 *
 * All are public and covered by the global 60 req/min/IP limiter registered in
 * app.ts (04 §1). None declares `config.permission`, which is deliberate and
 * is what keeps them out of the AC-AUTH-04 permission matrix — they are
 * genuinely anonymous, exactly like /intake-form and /intake-submissions.
 *
 * The audience is pinned server-side to 'candidate'; there is no query
 * parameter that could widen it, so internal questions stay unreachable
 * (AC-IF-02 applies here too).
 */
import { createHash } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { CandidateRegistrationSchema } from '@sdb/contracts';
import {
  CandidateRegistrationEnvelopeSchema,
  CandidateRegistrationFormEnvelopeSchema,
  RegistrationConfirmEnvelopeSchema,
  RegistrationSessionEnvelopeSchema,
  RegistrationUploadUrlBodySchema,
  RegistrationUploadUrlEnvelopeSchema,
  SessionFileParamsSchema,
  SessionParamsSchema,
} from '../schemas/candidate-registration.js';
import type { CandidateRegistrationFormService } from '../services/candidate-registration-form.service.js';
import type { CandidateFormPublicService } from '../services/candidate-form-public.service.js';
import type { CandidateFormSubmissionService } from '../services/candidate-form-submission.service.js';
import type { CandidateRegistrationService } from '../services/candidate-registration.service.js';

export interface CandidateRegistrationRoutesOptions {
  /**
   * /register is now served BY THE BUILDER (migration 0021). These two
   * endpoints keep their exact paths and response schemas — only the source
   * changed — so the existing front-end needs no change at all.
   */
  publicFormService: CandidateFormPublicService;
  submissionService: CandidateFormSubmissionService;
  candidateRegistrationFormService: CandidateRegistrationFormService;
  candidateRegistrationService: CandidateRegistrationService;
}

/**
 * Salted hash of the caller IP, for abuse tracing only. The raw address is
 * never stored — it is personal data we have no product need for, and
 * NFR-12's spirit is that nothing sensitive lands in a column by default.
 */
function hashIp(request: FastifyRequest): string | null {
  const ip = request.ip;
  if (typeof ip !== 'string' || ip === '') return null;
  return createHash('sha256').update(`sdb-registration:${ip}`).digest('hex');
}

export async function candidateRegistrationRoutes(
  fastify: FastifyInstance,
  opts: CandidateRegistrationRoutesOptions,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/candidate-registration-form',
    { schema: { response: { 200: CandidateRegistrationFormEnvelopeSchema } } },
    async () => {
      // Resolved from the seeded default form. The response is narrowed to the
      // legacy shape on purpose: the block/theme payload is served at
      // /candidate-forms/public/:slug, and this endpoint's contract is frozen.
      const payload = await opts.publicFormService.getDefault();
      return {
        data: {
          formVersionHash: payload.formVersionHash,
          generatedAt: payload.generatedAt,
          categories: payload.categories,
        },
      };
    },
  );

  app.post(
    '/candidate-registrations/session',
    { schema: { response: { 201: RegistrationSessionEnvelopeSchema } } },
    async (request, reply) => {
      const userAgent = request.headers['user-agent'];
      const data = await opts.candidateRegistrationService.startSession({
        ipHash: hashIp(request),
        userAgent: typeof userAgent === 'string' ? userAgent.slice(0, 500) : null,
      });
      return reply.code(201).send({ data });
    },
  );

  app.post(
    '/candidate-registrations/:sessionId/upload-url',
    {
      schema: {
        params: SessionParamsSchema,
        body: RegistrationUploadUrlBodySchema,
        response: { 201: RegistrationUploadUrlEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const data = await opts.candidateRegistrationService.createUploadUrl(
        request.params.sessionId,
        request.body,
      );
      return reply.code(201).send({ data });
    },
  );

  app.post(
    '/candidate-registrations/:sessionId/files/:fileId/confirm',
    {
      schema: {
        params: SessionFileParamsSchema,
        response: { 200: RegistrationConfirmEnvelopeSchema },
      },
    },
    async (request) => {
      const data = await opts.candidateRegistrationService.confirmUpload(
        request.params.sessionId,
        request.params.fileId,
      );
      return { data };
    },
  );

  app.post(
    '/candidate-registrations',
    {
      schema: {
        body: CandidateRegistrationSchema,
        response: { 201: CandidateRegistrationEnvelopeSchema },
      },
    },
    async (request, reply) => {
      // slug null = the default form. One submit path, so the identity rule,
      // the newest-wins patch and the per-form step guards apply here too.
      const data = await opts.submissionService.submit(null, request.body, {
        ipHash: hashIp(request),
      });
      return reply.code(201).send({ data });
    },
  );
}
