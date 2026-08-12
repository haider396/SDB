/**
 * API error model. Source: docs/04-API.md §1.1 (error envelope) and §1.2
 * (exhaustive error code table). ERROR_CODES maps each code to its HTTP status.
 */
import { z } from 'zod';

export const ERROR_CODES = {
  MALFORMED_REQUEST: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  WRONG_TENANT: 403,
  NOT_FOUND: 404,
  INVALID_TRANSITION: 409,
  QUESTION_TYPE_LOCKED: 409,
  MAPPED_QUESTION_PROTECTED: 409,
  DUPLICATE_ASSIGNMENT: 409,
  FILE_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PAYMENT_NOT_CONFIRMED: 422,
  CONSENT_MISSING: 422,
  REQUIRED_ANSWER_MISSING: 422,
  VALUE_TYPE_MISMATCH: 422,
  VALIDATION_FAILED: 422,
  INVALID_OPTION: 422,
  CONDITION_NOT_MET: 422,
  UNKNOWN_QUESTION: 422,
  CIRCULAR_CONDITION: 422,
  INVALID_VALIDATION_RULE: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

const errorCodeKeys = Object.keys(ERROR_CODES) as [ErrorCode, ...ErrorCode[]];

export const ErrorCodeSchema = z.enum(errorCodeKeys);

export const ApiErrorSchema = z.object({
  error: z.object({
    code: ErrorCodeSchema,
    message: z.string(),
    details: z.record(z.unknown()).optional(),
    requestId: z.string(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

/** HTTP status for a given error code. */
export function httpStatusForErrorCode(code: ErrorCode): number {
  return ERROR_CODES[code];
}

/** Build a spec-shaped error envelope. */
export function makeApiError(
  code: ErrorCode,
  message: string,
  requestId: string,
  details?: Record<string, unknown>,
): ApiError {
  return {
    error: {
      code,
      message,
      requestId,
      ...(details !== undefined ? { details } : {}),
    },
  };
}

/** Type guard for unknown payloads (e.g. fetch responses on the web app). */
export function isApiError(value: unknown): value is ApiError {
  return ApiErrorSchema.safeParse(value).success;
}
