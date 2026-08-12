/**
 * pino JSON logger (docs/06-BACKEND.md §7, AC-NFR-06).
 *
 * - Every request-scoped line carries `requestId` (Fastify child-logger binding,
 *   `requestIdLogLabel: 'requestId'` set in app.ts).
 * - `email`, `phone`, `password`, `token` and the Authorization header are
 *   redacted at every level.
 * - Request bodies are logged at `debug` only (hook in app.ts), inside a `body`
 *   key covered by the `*.field` redaction paths below.
 */
import { pino, stdTimeFunctions, type Logger } from 'pino';
import type { Env } from './env.js';

export type { Logger };

const SENSITIVE_FIELDS = [
  'email',
  'phone',
  'whatsapp',
  'password',
  'token',
  'accessToken',
  'refreshToken',
] as const;

export function createLogger(env: Pick<Env, 'LOG_LEVEL'>): Logger {
  return pino({
    level: env.LOG_LEVEL,
    timestamp: stdTimeFunctions.isoTime,
    redact: {
      paths: [
        ...SENSITIVE_FIELDS,
        ...SENSITIVE_FIELDS.map((field) => `*.${field}`),
        'req.headers.authorization',
        'headers.authorization',
      ],
      censor: '[REDACTED]',
    },
  });
}
