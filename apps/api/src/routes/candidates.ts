/**
 * Candidate endpoints (docs/04-API.md §8, §8.1, §8.2). Routes parse,
 * authorise, delegate, serialise — pool visibility, completeness, storage
 * flow, and webhook leniency live in the services.
 *
 * Guards attach at preValidation so a denied caller receives 403 before body
 * validation can 400 (04 §1.3). The webhook route authenticates with the
 * static WEBHOOK_INBOUND_TOKEN at onRequest (before body parsing) — it never
 * carries a user JWT and declares no permission.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import {
  CandidateConsentBodySchema,
  CreateCandidateAssessmentBodySchema,
  CreateCandidateBodySchema,
  CreateCandidateCertificationBodySchema,
  CreateCandidateEducationBodySchema,
  CreateCandidateEmploymentBodySchema,
  CreateCandidateLanguageBodySchema,
  CreateCandidateNoteBodySchema,
  CreateCandidateReferenceBodySchema,
  FileUploadUrlBodySchema,
  ListCandidatesQuerySchema,
  PutCandidateSkillsBodySchema,
  PutCandidateToolsBodySchema,
  PutDisqualifierChecksBodySchema,
  UpdateCandidateBodySchema,
  UpdateCandidateCertificationBodySchema,
  UpdateCandidateEducationBodySchema,
  UpdateCandidateEmploymentBodySchema,
  UpdateCandidateFileBodySchema,
  UpdateCandidateLanguageBodySchema,
  UpdateCandidateReferenceBodySchema,
  WebhookResponseSchema,
} from '@sdb/contracts';
import { ApiError } from '../lib/errors.js';
import { requirePermission } from '../middleware/require-permission.js';
import {
  AssessmentCollectionSchema,
  CandidateChildParamsSchema,
  CandidateCollectionSchema,
  CandidateDetailEnvelopeSchema,
  CandidateEnvelopeSchema,
  CandidateFileEnvelopeSchema,
  CandidateFileParamsSchema,
  CandidateIdParamSchema,
  CertificationCollectionSchema,
  DisqualifierCheckCollectionSchema,
  EducationCollectionSchema,
  EmploymentCollectionSchema,
  FileCollectionSchema,
  FileUploadUrlEnvelopeSchema,
  LanguageCollectionSchema,
  NoteCollectionSchema,
  ReferenceCollectionSchema,
  SkillCollectionSchema,
  ToolCollectionSchema,
} from '../schemas/candidates.js';
import type {
  CandidateActor,
  CandidatesService,
} from '../services/candidates.service.js';
import type { CandidateFilesService } from '../services/candidate-files.service.js';
import type { CandidateWebhookService } from '../services/candidate-webhook.service.js';

export interface CandidateRoutesOptions {
  candidatesService: CandidatesService;
  candidateFilesService: CandidateFilesService;
  candidateWebhookService: CandidateWebhookService;
}

export function candidateActorOf(request: FastifyRequest): CandidateActor {
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

const unpaged = <T>(data: T[]) => ({
  data,
  meta: { count: data.length, nextCursor: null },
});

export async function candidateRoutes(
  fastify: FastifyInstance,
  opts: CandidateRoutesOptions,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();
  const { candidatesService, candidateFilesService, candidateWebhookService } =
    opts;

  const guarded = (permission: Parameters<typeof requirePermission>[0]) => ({
    config: { permission },
    onRequest: [app.authenticate],
    preValidation: [app.loadContext, requirePermission(permission)],
  });

  // --- inbound webhook (04 §8.2) — static bearer, NOT a user JWT ------------
  app.post(
    '/candidates/webhook',
    {
      // Token check at onRequest so a bad bearer 401s before body parsing.
      onRequest: [
        async (request) => {
          candidateWebhookService.verifyToken(request.headers.authorization);
        },
      ],
      schema: {
        response: { 200: WebhookResponseSchema },
      },
    },
    async (request) => {
      const idempotencyKey = request.headers['idempotency-key'];
      return candidateWebhookService.ingest(
        request.body,
        typeof idempotencyKey === 'string' && idempotencyKey !== ''
          ? idempotencyKey
          : null,
      );
    },
  );

  // --- core CRUD ------------------------------------------------------------
  app.get(
    '/candidates',
    {
      ...guarded('candidate.view'),
      schema: {
        querystring: ListCandidatesQuerySchema,
        response: { 200: CandidateCollectionSchema },
      },
    },
    async (request) => {
      const { data, nextCursor } = await candidatesService.list(
        request.query,
        candidateActorOf(request),
      );
      return { data, meta: { count: data.length, nextCursor } };
    },
  );

  app.post(
    '/candidates',
    {
      ...guarded('candidate.create'),
      schema: {
        body: CreateCandidateBodySchema,
        response: { 201: CandidateEnvelopeSchema },
      },
    },
    async (request, reply) => {
      const data = await candidatesService.create(
        request.body,
        candidateActorOf(request),
      );
      return reply.code(201).send({ data });
    },
  );

  app.get(
    '/candidates/:id',
    {
      ...guarded('candidate.view'),
      schema: {
        params: CandidateIdParamSchema,
        response: { 200: CandidateDetailEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await candidatesService.get(
        request.params.id,
        candidateActorOf(request),
      ),
    }),
  );

  app.patch(
    '/candidates/:id',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        body: UpdateCandidateBodySchema,
        response: { 200: CandidateEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await candidatesService.update(
        request.params.id,
        request.body,
        candidateActorOf(request),
      ),
    }),
  );

  app.post(
    '/candidates/:id/archive',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        response: { 200: CandidateEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await candidatesService.archive(
        request.params.id,
        candidateActorOf(request),
      ),
    }),
  );

  app.post(
    '/candidates/:id/consent',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        body: CandidateConsentBodySchema,
        response: { 200: CandidateEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await candidatesService.captureConsent(
        request.params.id,
        request.body,
        candidateActorOf(request),
      ),
    }),
  );

  // --- languages -------------------------------------------------------------
  app.get(
    '/candidates/:id/languages',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        response: { 200: LanguageCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await candidatesService.listLanguages(
          request.params.id,
          candidateActorOf(request),
        ),
      ),
  );
  app.post(
    '/candidates/:id/languages',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        body: CreateCandidateLanguageBodySchema,
        response: { 201: LanguageCollectionSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send(
        unpaged(
          await candidatesService.addLanguage(
            request.params.id,
            request.body,
            candidateActorOf(request),
          ),
        ),
      ),
  );
  app.patch(
    '/candidates/:id/languages/:entryId',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateChildParamsSchema,
        body: UpdateCandidateLanguageBodySchema,
        response: { 200: LanguageCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await candidatesService.updateLanguage(
          request.params.id,
          request.params.entryId,
          request.body,
          candidateActorOf(request),
        ),
      ),
  );
  app.delete(
    '/candidates/:id/languages/:entryId',
    {
      ...guarded('candidate.update'),
      schema: { params: CandidateChildParamsSchema },
    },
    async (request, reply) => {
      await candidatesService.removeLanguage(
        request.params.id,
        request.params.entryId,
        candidateActorOf(request),
      );
      return reply.code(204).send();
    },
  );

  // --- tools / skills (GET + replace-set PUT) --------------------------------
  app.get(
    '/candidates/:id/tools',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        response: { 200: ToolCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await candidatesService.listTools(
          request.params.id,
          candidateActorOf(request),
        ),
      ),
  );
  app.put(
    '/candidates/:id/tools',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        body: PutCandidateToolsBodySchema,
        response: { 200: ToolCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await candidatesService.replaceTools(
          request.params.id,
          request.body,
          candidateActorOf(request),
        ),
      ),
  );
  app.get(
    '/candidates/:id/skills',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        response: { 200: SkillCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await candidatesService.listSkills(
          request.params.id,
          candidateActorOf(request),
        ),
      ),
  );
  app.put(
    '/candidates/:id/skills',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        body: PutCandidateSkillsBodySchema,
        response: { 200: SkillCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await candidatesService.replaceSkills(
          request.params.id,
          request.body,
          candidateActorOf(request),
        ),
      ),
  );

  // --- employment history ----------------------------------------------------
  app.get(
    '/candidates/:id/employment-history',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        response: { 200: EmploymentCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await candidatesService.listEmployment(
          request.params.id,
          candidateActorOf(request),
        ),
      ),
  );
  app.post(
    '/candidates/:id/employment-history',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        body: CreateCandidateEmploymentBodySchema,
        response: { 201: EmploymentCollectionSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send(
        unpaged(
          await candidatesService.addEmployment(
            request.params.id,
            request.body,
            candidateActorOf(request),
          ),
        ),
      ),
  );
  app.patch(
    '/candidates/:id/employment-history/:entryId',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateChildParamsSchema,
        body: UpdateCandidateEmploymentBodySchema,
        response: { 200: EmploymentCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await candidatesService.updateEmployment(
          request.params.id,
          request.params.entryId,
          request.body,
          candidateActorOf(request),
        ),
      ),
  );
  app.delete(
    '/candidates/:id/employment-history/:entryId',
    {
      ...guarded('candidate.update'),
      schema: { params: CandidateChildParamsSchema },
    },
    async (request, reply) => {
      await candidatesService.removeEmployment(
        request.params.id,
        request.params.entryId,
        candidateActorOf(request),
      );
      return reply.code(204).send();
    },
  );

  // --- education -------------------------------------------------------------
  app.get(
    '/candidates/:id/education',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        response: { 200: EducationCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await candidatesService.listEducation(
          request.params.id,
          candidateActorOf(request),
        ),
      ),
  );
  app.post(
    '/candidates/:id/education',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        body: CreateCandidateEducationBodySchema,
        response: { 201: EducationCollectionSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send(
        unpaged(
          await candidatesService.addEducation(
            request.params.id,
            request.body,
            candidateActorOf(request),
          ),
        ),
      ),
  );
  app.patch(
    '/candidates/:id/education/:entryId',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateChildParamsSchema,
        body: UpdateCandidateEducationBodySchema,
        response: { 200: EducationCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await candidatesService.updateEducation(
          request.params.id,
          request.params.entryId,
          request.body,
          candidateActorOf(request),
        ),
      ),
  );
  app.delete(
    '/candidates/:id/education/:entryId',
    {
      ...guarded('candidate.update'),
      schema: { params: CandidateChildParamsSchema },
    },
    async (request, reply) => {
      await candidatesService.removeEducation(
        request.params.id,
        request.params.entryId,
        candidateActorOf(request),
      );
      return reply.code(204).send();
    },
  );

  // --- certifications --------------------------------------------------------
  app.get(
    '/candidates/:id/certifications',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        response: { 200: CertificationCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await candidatesService.listCertifications(
          request.params.id,
          candidateActorOf(request),
        ),
      ),
  );
  app.post(
    '/candidates/:id/certifications',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        body: CreateCandidateCertificationBodySchema,
        response: { 201: CertificationCollectionSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send(
        unpaged(
          await candidatesService.addCertification(
            request.params.id,
            request.body,
            candidateActorOf(request),
          ),
        ),
      ),
  );
  app.patch(
    '/candidates/:id/certifications/:entryId',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateChildParamsSchema,
        body: UpdateCandidateCertificationBodySchema,
        response: { 200: CertificationCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await candidatesService.updateCertification(
          request.params.id,
          request.params.entryId,
          request.body,
          candidateActorOf(request),
        ),
      ),
  );
  app.delete(
    '/candidates/:id/certifications/:entryId',
    {
      ...guarded('candidate.update'),
      schema: { params: CandidateChildParamsSchema },
    },
    async (request, reply) => {
      await candidatesService.removeCertification(
        request.params.id,
        request.params.entryId,
        candidateActorOf(request),
      );
      return reply.code(204).send();
    },
  );

  // --- references ------------------------------------------------------------
  app.get(
    '/candidates/:id/references',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        response: { 200: ReferenceCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await candidatesService.listReferences(
          request.params.id,
          candidateActorOf(request),
        ),
      ),
  );
  app.post(
    '/candidates/:id/references',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        body: CreateCandidateReferenceBodySchema,
        response: { 201: ReferenceCollectionSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send(
        unpaged(
          await candidatesService.addReference(
            request.params.id,
            request.body,
            candidateActorOf(request),
          ),
        ),
      ),
  );
  app.patch(
    '/candidates/:id/references/:entryId',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateChildParamsSchema,
        body: UpdateCandidateReferenceBodySchema,
        response: { 200: ReferenceCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await candidatesService.updateReference(
          request.params.id,
          request.params.entryId,
          request.body,
          candidateActorOf(request),
        ),
      ),
  );
  app.delete(
    '/candidates/:id/references/:entryId',
    {
      ...guarded('candidate.update'),
      schema: { params: CandidateChildParamsSchema },
    },
    async (request, reply) => {
      await candidatesService.removeReference(
        request.params.id,
        request.params.entryId,
        candidateActorOf(request),
      );
      return reply.code(204).send();
    },
  );

  // --- notes (candidate.view per 04 §8) --------------------------------------
  app.get(
    '/candidates/:id/notes',
    {
      ...guarded('candidate.view'),
      schema: {
        params: CandidateIdParamSchema,
        response: { 200: NoteCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await candidatesService.listNotes(
          request.params.id,
          candidateActorOf(request),
        ),
      ),
  );
  app.post(
    '/candidates/:id/notes',
    {
      ...guarded('candidate.view'),
      schema: {
        params: CandidateIdParamSchema,
        body: CreateCandidateNoteBodySchema,
        response: { 201: NoteCollectionSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send(
        unpaged(
          await candidatesService.addNote(
            request.params.id,
            request.body,
            candidateActorOf(request),
          ),
        ),
      ),
  );

  // --- disqualifier checks ---------------------------------------------------
  app.get(
    '/candidates/:id/disqualifier-checks',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        response: { 200: DisqualifierCheckCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await candidatesService.listDisqualifierChecks(
          request.params.id,
          candidateActorOf(request),
        ),
      ),
  );
  app.put(
    '/candidates/:id/disqualifier-checks',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        body: PutDisqualifierChecksBodySchema,
        response: { 200: DisqualifierCheckCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await candidatesService.putDisqualifierChecks(
          request.params.id,
          request.body,
          candidateActorOf(request),
        ),
      ),
  );

  // --- assessments (storage only) --------------------------------------------
  app.get(
    '/candidates/:id/assessments',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        response: { 200: AssessmentCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await candidatesService.listAssessments(
          request.params.id,
          candidateActorOf(request),
        ),
      ),
  );
  app.post(
    '/candidates/:id/assessments',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        body: CreateCandidateAssessmentBodySchema,
        response: { 201: AssessmentCollectionSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send(
        unpaged(
          await candidatesService.addAssessment(
            request.params.id,
            request.body,
            candidateActorOf(request),
          ),
        ),
      ),
  );

  // --- files (04 §8.1) -------------------------------------------------------
  app.post(
    '/candidates/:id/files/upload-url',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateIdParamSchema,
        body: FileUploadUrlBodySchema,
        response: { 201: FileUploadUrlEnvelopeSchema },
      },
    },
    async (request, reply) =>
      reply.code(201).send({
        data: await candidateFilesService.createUploadUrl(
          request.params.id,
          request.body,
          candidateActorOf(request),
        ),
      }),
  );
  app.post(
    '/candidates/:id/files/:fileId/confirm',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateFileParamsSchema,
        response: { 200: CandidateFileEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await candidateFilesService.confirmUpload(
        request.params.id,
        request.params.fileId,
        candidateActorOf(request),
      ),
    }),
  );
  app.get(
    '/candidates/:id/files',
    {
      ...guarded('candidate.view'),
      schema: {
        params: CandidateIdParamSchema,
        response: { 200: FileCollectionSchema },
      },
    },
    async (request) =>
      unpaged(
        await candidateFilesService.list(
          request.params.id,
          candidateActorOf(request),
        ),
      ),
  );
  app.patch(
    '/candidates/:id/files/:fileId',
    {
      ...guarded('candidate.update'),
      schema: {
        params: CandidateFileParamsSchema,
        body: UpdateCandidateFileBodySchema,
        response: { 200: CandidateFileEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await candidateFilesService.update(
        request.params.id,
        request.params.fileId,
        request.body,
        candidateActorOf(request),
      ),
    }),
  );
  app.delete(
    '/candidates/:id/files/:fileId',
    {
      ...guarded('candidate.update'),
      schema: { params: CandidateFileParamsSchema },
    },
    async (request, reply) => {
      await candidateFilesService.remove(
        request.params.id,
        request.params.fileId,
        candidateActorOf(request),
      );
      return reply.code(204).send();
    },
  );
}
