/**
 * Shared unit-test helpers: controlled env, a locally-generated JWKS keypair
 * (no network), fixed request contexts, and a stubbed Supabase Admin port.
 * DB-dependent integration tests are out of scope here; every repository takes
 * the db handle as a parameter so a later harness can wire a real Postgres.
 */
import { randomUUID } from 'node:crypto';
import {
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  generateKeyPair,
  type JWTVerifyGetKey,
} from 'jose';
import type { AuthUser, PermissionKey, UserRoleKey } from '@sdb/contracts';
import { loadEnv, type Env } from '../src/lib/env.js';
import type { SupabaseAdminPort } from '../src/lib/supabase-admin.js';
import type { RequestContext } from '../src/middleware/load-context.js';

export const TEST_ENV_VARS: Record<string, string> = {
  NODE_ENV: 'test',
  LOG_LEVEL: 'fatal',
  // Port 1 refuses connections immediately — nothing in unit tests may reach it.
  DATABASE_URL: 'postgres://sdb:sdb@127.0.0.1:1/sdb_test',
  SUPABASE_URL: 'https://example.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'service-role-key-for-tests-only',
  SUPABASE_JWT_JWKS_URL:
    'https://example.supabase.co/auth/v1/.well-known/jwks.json',
  SUPABASE_STORAGE_BUCKET_CANDIDATES: 'candidates',
  WEBHOOK_INBOUND_TOKEN: 'webhook-inbound-token',
  GHL_API_BASE_URL: 'https://services.leadconnectorhq.com',
  GHL_PRIVATE_INTEGRATION_TOKEN: 'ghl-private-token',
  GHL_LOCATION_ID: 'loc_test',
  PUBLIC_APP_URL: 'https://portal.example.com',
  CORS_ALLOWED_ORIGINS: 'https://portal.example.com',
};

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({ ...TEST_ENV_VARS, ...overrides }, {});
}

export interface TestAuth {
  jwks: JWTVerifyGetKey;
  signToken(
    sub: string,
    opts?: {
      audience?: string;
      /** Absolute expiry in epoch seconds; defaults to now + 5 minutes. */
      exp?: number;
    },
  ): Promise<string>;
}

/** Local RS256 keypair served as an in-process JWKS — injectable key source. */
export async function createTestAuth(): Promise<TestAuth> {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const jwks = createLocalJWKSet({
    keys: [{ ...jwk, alg: 'RS256', use: 'sig', kid: 'test-key' }],
  });
  return {
    jwks,
    async signToken(sub, opts = {}) {
      const nowSeconds = Math.floor(Date.now() / 1000);
      return new SignJWT({})
        .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
        .setSubject(sub)
        .setAudience(opts.audience ?? 'authenticated')
        .setIssuedAt(nowSeconds - 60)
        .setExpirationTime(opts.exp ?? nowSeconds + 300)
        .sign(privateKey);
    },
  };
}

export function makeUser(id: string): AuthUser {
  return {
    id,
    email: 'user@example.com',
    fullName: 'Test User',
    phone: null,
    avatarPath: null,
    timezone: 'UTC',
    isActive: true,
    lastLoginAt: null,
  };
}

export function makeCtx(
  userId: string,
  overrides: {
    roles?: UserRoleKey[];
    permissions?: PermissionKey[];
    clientIds?: string[];
  } = {},
): RequestContext {
  const roles = overrides.roles ?? ['admin'];
  return {
    userId,
    user: makeUser(userId),
    roles,
    primaryRole: roles[0] ?? null,
    permissions: new Set(overrides.permissions ?? ['question.view']),
    clientIds: overrides.clientIds ?? [],
  };
}

export function stubSupabaseAdmin(): SupabaseAdminPort & {
  calls: { updateUserPassword: [string, string][]; signOutUser: string[] };
} {
  const calls = {
    updateUserPassword: [] as [string, string][],
    signOutUser: [] as string[],
  };
  return {
    calls,
    async updateUserPassword(userId, password) {
      calls.updateUserPassword.push([userId, password]);
    },
    async signOutUser(accessToken) {
      calls.signOutUser.push(accessToken);
    },
  };
}

export function freshUserId(): string {
  return randomUUID();
}
