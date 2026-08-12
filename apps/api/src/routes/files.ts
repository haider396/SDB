/**
 * `GET /files/:fileId/download-url` (docs/04-API.md §8.1).
 *
 * Permission: candidate.view — held by admins AND client roles. The service
 * branches on scope: a client-scoped caller gets a URL only when the file is
 * client-visible and the candidate has a client-visible assignment to their
 * client (AC-CA-06); every refusal is a 404, never a data leak. URLs expire
 * in 300 seconds (AC-CA-05).
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { requirePermission } from '../middleware/require-permission.js';
import {
  FileDownloadUrlEnvelopeSchema,
  FileIdParamSchema,
} from '../schemas/candidates.js';
import type { CandidateFilesService } from '../services/candidate-files.service.js';
import { candidateActorOf } from './candidates.js';

export interface FileRoutesOptions {
  candidateFilesService: CandidateFilesService;
}

export async function fileRoutes(
  fastify: FastifyInstance,
  opts: FileRoutesOptions,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    '/files/:fileId/download-url',
    {
      config: { permission: 'candidate.view' },
      onRequest: [app.authenticate],
      preValidation: [app.loadContext, requirePermission('candidate.view')],
      schema: {
        params: FileIdParamSchema,
        response: { 200: FileDownloadUrlEnvelopeSchema },
      },
    },
    async (request) => ({
      data: await opts.candidateFilesService.createDownloadUrl(
        request.params.fileId,
        candidateActorOf(request),
      ),
    }),
  );
}
