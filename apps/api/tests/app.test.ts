/**
 * Error envelope shape (04 §1.1), health endpoints (04 §14), the OpenAPI
 * document (04 §15, AC-NFR-07), and the accept-invitation validation path.
 */
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import {
  createTestAuth,
  stubSupabaseAdmin,
  testEnv,
  type TestAuth,
} from './helpers.js';

describe('app', () => {
  let app: FastifyInstance;
  let auth: TestAuth;

  beforeAll(async () => {
    auth = await createTestAuth();
    app = await buildApp({
      env: testEnv(),
      jwtKeySource: auth.jwks,
      supabaseAdmin: stubSupabaseAdmin(),
    });
    app.get('/api/v1/_test/boom', async () => {
      throw new Error('secret-internals-do-not-leak');
    });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('error envelope (04 §1.1)', () => {
    it('unknown route → 404 NOT_FOUND envelope with requestId', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/nope' });
      expect(res.statusCode).toBe(404);
      const body = res.json();
      expect(body).toEqual({
        error: {
          code: 'NOT_FOUND',
          message: expect.any(String),
          requestId: expect.any(String),
        },
      });
    });

    it('Zod validation failure → 400 MALFORMED_REQUEST', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/accept-invitation',
        payload: { token: 't', password: 'short', fullName: '', timezone: '' },
      });
      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.error.code).toBe('MALFORMED_REQUEST');
      expect(body.error.requestId).toBeTruthy();
      const paths = body.error.details.issues.map(
        (issue: { path: string }) => issue.path,
      );
      expect(paths).toContain('password');
    });

    it('invalid JSON body → 400 MALFORMED_REQUEST', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/accept-invitation',
        headers: { 'content-type': 'application/json' },
        payload: '{not json',
      });
      expect(res.statusCode).toBe(400);
      expect(res.json().error.code).toBe('MALFORMED_REQUEST');
    });

    it('unhandled error → 500 INTERNAL_ERROR, no internals leaked', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/_test/boom' });
      expect(res.statusCode).toBe(500);
      const body = res.json();
      expect(body.error.code).toBe('INTERNAL_ERROR');
      expect(body.error.requestId).toBeTruthy();
      expect(res.body).not.toContain('secret-internals');
      expect(res.body).not.toContain('stack');
    });

    it('a syntactically valid but unknown invitation token → 422 VALIDATION_FAILED', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/accept-invitation',
        payload: {
          token: 'AAAA.BBBB',
          password: 'long-enough-password',
          fullName: 'Jane Doe',
          timezone: 'Europe/London',
        },
      });
      expect(res.statusCode).toBe(422);
      expect(res.json().error.code).toBe('VALIDATION_FAILED');
    });
  });

  describe('health (04 §14)', () => {
    it('GET /api/v1/health returns status, version, uptimeSeconds', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/health' });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe('ok');
      expect(body.version).toMatch(/^\d+\.\d+\.\d+$/);
      expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
    });

    it('serves the unprefixed /health alias for infra probes', async () => {
      const res = await app.inject({ method: 'GET', url: '/health' });
      expect(res.statusCode).toBe(200);
      expect(res.json().status).toBe('ok');
    });

    it('GET /health/ready reports 503 not_ready when the DB is unreachable', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/health/ready' });
      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.status).toBe('not_ready');
      expect(body.checks.database).toBe(false);
      // Storage check is stubbed ok until P3.
      expect(body.checks.storage).toBe(true);
    }, 15_000);
  });

  describe('OpenAPI (04 §15, AC-NFR-07)', () => {
    it('serves a 3.1 document covering every registered v1 route', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
      expect(res.statusCode).toBe(200);
      const doc = res.json();
      expect(doc.openapi).toBe('3.1.0');
      for (const path of [
        '/api/v1/auth/accept-invitation',
        '/api/v1/auth/me',
        '/api/v1/auth/logout',
        '/api/v1/health',
        '/api/v1/health/ready',
        '/api/v1/intake-form',
        '/api/v1/taxonomy/public',
        '/api/v1/intake-submissions',
        '/api/v1/requisitions',
        '/api/v1/questions',
        '/api/v1/questions/preview',
        '/api/v1/questions/reorder',
        '/api/v1/questions/{id}',
        '/api/v1/questions/{id}/activate',
        '/api/v1/questions/{id}/deactivate',
        '/api/v1/questions/{id}/duplicate',
        '/api/v1/questions/{id}/options',
        '/api/v1/questions/{id}/options/{optionId}',
        '/api/v1/questions/{id}/options/{optionId}/deactivate',
        '/api/v1/question-categories',
        '/api/v1/question-categories/reorder',
        '/api/v1/question-categories/{id}',
        '/api/v1/question-categories/{id}/activate',
        '/api/v1/question-categories/{id}/deactivate',
      ]) {
        expect(doc.paths[path], `missing ${path}`).toBeDefined();
      }
    });

    it('route-coverage: every registered API route appears in the document (AC-NFR-07)', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' });
      const doc = res.json();
      const documented = new Set(
        Object.entries(doc.paths as Record<string, Record<string, unknown>>)
          .flatMap(([path, methods]) =>
            Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
          ),
      );
      // Infrastructure endpoints excluded from the contract document.
      const EXCLUDED = new Set(['GET /health', 'GET /health/ready']);
      const undocumented = app.routeTable
        .filter(
          (route) =>
            route.method !== 'HEAD' &&
            route.method !== 'OPTIONS' &&
            !route.url.startsWith('/api/v1/docs') &&
            route.url !== '/api/v1/openapi.json' &&
            route.url !== '*' &&
            !route.url.startsWith('/api/v1/_test') &&
            !EXCLUDED.has(`${route.method} ${route.url}`),
        )
        .map(
          (route) =>
            `${route.method} ${route.url.replaceAll(/:([^/]+)/g, '{$1}')}`,
        )
        .filter((key) => !documented.has(key));
      expect(undocumented, 'routes missing from openapi.json').toEqual([]);
    });

    it('serves Swagger UI at /api/v1/docs outside production', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/docs' });
      expect([200, 302]).toContain(res.statusCode);
    });

    it('does not serve Swagger UI in production', async () => {
      const prodApp = await buildApp({
        env: testEnv({ NODE_ENV: 'production' }),
        jwtKeySource: auth.jwks,
        supabaseAdmin: stubSupabaseAdmin(),
      });
      await prodApp.ready();
      const docs = await prodApp.inject({ method: 'GET', url: '/api/v1/docs' });
      expect(docs.statusCode).toBe(404);
      // The machine-readable document stays available.
      const doc = await prodApp.inject({
        method: 'GET',
        url: '/api/v1/openapi.json',
      });
      expect(doc.statusCode).toBe(200);
      await prodApp.close();
    });
  });
});
