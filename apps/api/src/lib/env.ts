/**
 * Zod-parsed environment. Source: docs/06-BACKEND.md §3.1.
 *
 * Fails fast at boot: a missing variable must crash on startup, not at first
 * request (AC-NFR-05). `loadEnv(overrides, base)` exists so tests can inject a
 * fully controlled environment without touching `process.env`.
 */
import { z } from 'zod';

const EnvSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'staging', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  DATABASE_URL: z.string().min(1),

  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
  SUPABASE_JWT_JWKS_URL: z.string().url(),
  SUPABASE_STORAGE_BUCKET_CANDIDATES: z.string().min(1),

  WEBHOOK_INBOUND_TOKEN: z.string().min(1),

  GHL_API_BASE_URL: z.string().url(),
  GHL_PRIVATE_INTEGRATION_TOKEN: z.string().min(1),
  GHL_LOCATION_ID: z.string().min(1),

  // One inbound-webhook URL per notification_event (06 §4.1). Optional until
  // the GoHighLevel integration lands in P7; the P7 dispatcher must verify the
  // URL for an event exists before sending.
  GHL_WEBHOOK_URL_INTAKE_SUBMITTED: z.string().url().optional(),
  GHL_WEBHOOK_URL_PORTAL_INVITATION: z.string().url().optional(),
  GHL_WEBHOOK_URL_PRINCIPAL_APPROVAL_REQUESTED: z.string().url().optional(),
  GHL_WEBHOOK_URL_CANDIDATES_PRESENTED: z.string().url().optional(),
  GHL_WEBHOOK_URL_CLIENT_DECISION_RECORDED: z.string().url().optional(),
  GHL_WEBHOOK_URL_INTERVIEW_SCHEDULED: z.string().url().optional(),
  GHL_WEBHOOK_URL_REQUISITION_STATUS_CHANGED: z.string().url().optional(),

  // Candidate-facing email, "if enabled" per 06 §3.1 — optional.
  TRANSACTIONAL_EMAIL_PROVIDER_KEY: z.string().min(1).optional(),

  PUBLIC_APP_URL: z.string().url(),

  /** Comma-separated allowlist, parsed to an array. No wildcard in production. */
  CORS_ALLOWED_ORIGINS: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin.length > 0),
    )
    .pipe(z.array(z.string().min(1)).min(1)),
});

export type Env = z.infer<typeof EnvSchema>;

export class EnvValidationError extends Error {
  constructor(
    /** Variable names that are missing or empty. */
    public readonly missing: string[],
    /** Variable names present but failing validation (bad URL, bad enum, ...). */
    public readonly invalid: string[],
  ) {
    const parts: string[] = ['Environment validation failed.'];
    if (missing.length > 0) {
      parts.push(`Missing required variables: ${missing.join(', ')}.`);
    }
    if (invalid.length > 0) {
      parts.push(`Invalid values for: ${invalid.join(', ')}.`);
    }
    parts.push('See .env.example and docs/06-BACKEND.md §3.1.');
    super(parts.join(' '));
    this.name = 'EnvValidationError';
  }
}

/**
 * Parse and validate the environment.
 *
 * @param overrides highest-precedence values (tests inject here)
 * @param base      defaults to `process.env`; tests pass `{}` for isolation
 * @throws EnvValidationError listing every missing/invalid key
 */
export function loadEnv(
  overrides: Record<string, string | undefined> = {},
  base: Record<string, string | undefined> = process.env,
): Env {
  const merged: Record<string, string | undefined> = { ...base, ...overrides };
  // Treat empty strings as absent so an untouched .env.example fails loudly.
  const cleaned = Object.fromEntries(
    Object.entries(merged).filter(
      ([, value]) => value !== undefined && value !== '',
    ),
  );

  const result = EnvSchema.safeParse(cleaned);
  if (!result.success) {
    const missing: string[] = [];
    const invalid: string[] = [];
    for (const issue of result.error.issues) {
      const key = String(issue.path[0] ?? '(root)');
      if (issue.code === 'invalid_type' && issue.received === 'undefined') {
        if (!missing.includes(key)) missing.push(key);
      } else if (!invalid.includes(key)) {
        invalid.push(key);
      }
    }
    throw new EnvValidationError(missing, invalid);
  }
  return result.data;
}
