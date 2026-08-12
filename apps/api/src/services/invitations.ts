/**
 * Invitation tokens: signed, single-use, expiring.
 *
 * Model: an HMAC-SHA256-signed token over `{ userId, clientId, exp }`.
 * - The signing secret is derived (HKDF-SHA256) from SUPABASE_SERVICE_ROLE_KEY,
 *   so no extra secret needs provisioning; the derivation info string
 *   namespaces it away from every other use of the key.
 * - Single-use is enforced in the database, not the token: acceptance sets
 *   `client_members.accepted_at`, and the update only matches rows where it is
 *   still null — replaying a token matches zero rows and is rejected.
 * - `exp` (epoch seconds) bounds token life; the P0 default matches the 14-day
 *   invitation window in docs/06-BACKEND.md §5.
 *
 * Token wire format: base64url(payload JSON) + '.' + base64url(hmac).
 */
import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { ApiError } from '../lib/errors.js';

export const INVITATION_TTL_SECONDS = 14 * 24 * 60 * 60; // 14 days (06 §5)

const InvitationTokenPayloadSchema = z.object({
  userId: z.string().uuid(),
  clientId: z.string().uuid(),
  /** Expiry, epoch seconds. */
  exp: z.number().int().positive(),
});
export type InvitationTokenPayload = z.infer<typeof InvitationTokenPayloadSchema>;

function deriveSecret(serviceRoleKey: string): Buffer {
  return Buffer.from(
    hkdfSync(
      'sha256',
      serviceRoleKey,
      'sdb-portal',
      'sdb-portal invitation token v1',
      32,
    ),
  );
}

function sign(secret: Buffer, body: string): Buffer {
  return createHmac('sha256', secret).update(body).digest();
}

export function issueInvitationToken(
  serviceRoleKey: string,
  params: { userId: string; clientId: string; ttlSeconds?: number },
  now: () => number = Date.now,
): string {
  const payload: InvitationTokenPayload = {
    userId: params.userId,
    clientId: params.clientId,
    exp: Math.floor(now() / 1000) + (params.ttlSeconds ?? INVITATION_TTL_SECONDS),
  };
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
  const signature = sign(deriveSecret(serviceRoleKey), body).toString('base64url');
  return `${body}.${signature}`;
}

const invalidToken = (): ApiError =>
  new ApiError('VALIDATION_FAILED', 'Invitation token is invalid.');

export function verifyInvitationToken(
  serviceRoleKey: string,
  token: string,
  now: () => number = Date.now,
): InvitationTokenPayload {
  const parts = token.split('.');
  if (parts.length !== 2 || parts[0] === undefined || parts[1] === undefined) {
    throw invalidToken();
  }
  const [body, signaturePart] = parts;

  const expected = sign(deriveSecret(serviceRoleKey), body);
  let provided: Buffer;
  try {
    provided = Buffer.from(signaturePart, 'base64url');
  } catch {
    throw invalidToken();
  }
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) {
    throw invalidToken();
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw invalidToken();
  }
  const parsed = InvitationTokenPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    throw invalidToken();
  }
  if (parsed.data.exp * 1000 <= now()) {
    throw new ApiError('VALIDATION_FAILED', 'Invitation token has expired.');
  }
  return parsed.data;
}
