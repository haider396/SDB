/**
 * ApiError + global Fastify error handling producing the exact envelope from
 * docs/04-API.md §1.1:
 *
 *   { "error": { "code", "message", "details"?, "requestId" } }
 *
 * - Zod validation failures → 400 MALFORMED_REQUEST
 * - Unhandled errors → 500 INTERNAL_ERROR, requestId only, no internals leaked
 */
import type { FastifyError, FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import {
  httpStatusForErrorCode,
  makeApiError,
  type ErrorCode,
} from '@sdb/contracts';

export class ApiError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  get statusCode(): number {
    return httpStatusForErrorCode(this.code);
  }
}

function zodIssueSummary(error: ZodError): Record<string, unknown> {
  return {
    issues: error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

export function registerErrorHandling(app: FastifyInstance): void {
  app.setNotFoundHandler((request, reply) => {
    void reply
      .code(404)
      .send(makeApiError('NOT_FOUND', 'Resource not found.', request.id));
  });

  app.setErrorHandler((error: FastifyError | Error, request, reply) => {
    const requestId = request.id;

    if (error instanceof ApiError) {
      void reply
        .code(error.statusCode)
        .send(makeApiError(error.code, error.message, requestId, error.details));
      return;
    }

    // fastify-type-provider-zod throws the ZodError from the validator.
    if (error instanceof ZodError) {
      void reply
        .code(400)
        .send(
          makeApiError(
            'MALFORMED_REQUEST',
            'Request failed validation.',
            requestId,
            zodIssueSummary(error),
          ),
        );
      return;
    }

    const statusCode =
      'statusCode' in error && typeof error.statusCode === 'number'
        ? error.statusCode
        : 500;

    // Fastify-generated client errors (bad JSON, unsupported media type, ...).
    if (statusCode === 400) {
      void reply
        .code(400)
        .send(
          makeApiError('MALFORMED_REQUEST', 'Malformed request.', requestId),
        );
      return;
    }
    if (statusCode === 415) {
      void reply
        .code(415)
        .send(
          makeApiError(
            'UNSUPPORTED_MEDIA_TYPE',
            'Unsupported media type.',
            requestId,
          ),
        );
      return;
    }
    if (statusCode === 413) {
      void reply
        .code(413)
        .send(makeApiError('FILE_TOO_LARGE', 'Payload too large.', requestId));
      return;
    }
    if (statusCode === 429) {
      void reply
        .code(429)
        .send(makeApiError('RATE_LIMITED', 'Rate limit exceeded.', requestId));
      return;
    }

    // Everything else: log with requestId, leak nothing (06 §7).
    request.log.error({ err: error }, 'unhandled error');
    void reply
      .code(500)
      .send(
        makeApiError('INTERNAL_ERROR', 'An internal error occurred.', requestId),
      );
  });
}
