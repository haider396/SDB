/**
 * Supabase JWT verification (docs/06-BACKEND.md §3, step 3).
 *
 * Verifies the token signature against the (cached) Supabase JWKS via `jose`,
 * checks `exp` and `aud === 'authenticated'`, and extracts `sub`. Verification
 * is local — no call to Supabase per request. The key source is injected so
 * tests can supply `createLocalJWKSet` with a generated keypair.
 */
import type { FastifyRequest } from 'fastify';
import { jwtVerify, type JWTVerifyGetKey } from 'jose';
import { ApiError } from '../lib/errors.js';

export type AuthenticateHook = (request: FastifyRequest) => Promise<void>;

export function createAuthenticate(getKey: JWTVerifyGetKey): AuthenticateHook {
  return async function authenticate(request: FastifyRequest): Promise<void> {
    const header = request.headers.authorization;
    if (header === undefined || !header.startsWith('Bearer ')) {
      throw new ApiError('UNAUTHENTICATED', 'Missing bearer token.');
    }
    const token = header.slice('Bearer '.length);

    let sub: string | undefined;
    try {
      // jose rejects expired (`exp`) and not-yet-valid (`nbf`) tokens itself.
      const { payload } = await jwtVerify(token, getKey, {
        audience: 'authenticated',
      });
      sub = payload.sub;
    } catch {
      throw new ApiError('UNAUTHENTICATED', 'Invalid or expired token.');
    }
    if (sub === undefined || sub.length === 0) {
      throw new ApiError('UNAUTHENTICATED', 'Token has no subject.');
    }

    request.authUserId = sub;
    request.accessToken = token;
  };
}
