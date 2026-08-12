/**
 * buildApp() — composition root. Everything injectable so tests can supply a
 * controlled env, a local JWKS, a stub context loader, and a stub Supabase
 * Admin port without touching the network or a database.
 */
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import fastify, {
  type FastifyBaseLogger,
  type FastifyInstance,
} from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import fastifySwagger from '@fastify/swagger';
import fastifySwaggerUi from '@fastify/swagger-ui';
import {
  serializerCompiler,
  validatorCompiler,
} from 'fastify-type-provider-zod';
import { createRemoteJWKSet, type JWTVerifyGetKey } from 'jose';
import type { OpenAPIV3 } from 'openapi-types';
import { makeApiError } from '@sdb/contracts';
import { createDb, type Db } from './lib/db.js';
import type { Env } from './lib/env.js';
import { registerErrorHandling } from './lib/errors.js';
import { createLogger, type Logger } from './lib/logger.js';
import { buildOpenApiDocument } from './lib/openapi.js';
import {
  createSupabaseAdmin,
  type SupabaseAdminPort,
} from './lib/supabase-admin.js';
import { createAuthenticate } from './middleware/authenticate.js';
import {
  createCachedContextLoader,
  createDbContextLoader,
  createLoadContext,
  type ContextLoader,
} from './middleware/load-context.js';
import { authRoutes } from './routes/auth.js';
import { healthRoutes } from './routes/health.js';
import { createAuthService } from './services/auth.service.js';

const pkg = createRequire(import.meta.url)('../package.json') as {
  version: string;
};

/**
 * One entry per registered route+method, collected via the onRoute hook.
 * Exists for testability: the route-table-driven auth tests (AC-AUTH-01) and
 * the generated permission matrix (AC-AUTH-04) iterate this instead of
 * parsing printRoutes(), and later phases get OpenAPI route-coverage
 * assertions (AC-NFR-07) from the same table for free.
 */
export interface RegisteredRoute {
  method: string;
  url: string;
  /** Route-level config, e.g. `{ permission: 'question.manage' }`. */
  config: Record<string, unknown>;
  /** preHandler guards as registered, for cross-checking declared permissions. */
  preHandlers: readonly unknown[];
}

export interface BuildAppOptions {
  env: Env;
  /** Injected pool; buildApp creates (and owns closing) one when omitted. */
  db?: Db;
  /** JWT key source; tests inject `createLocalJWKSet(...)`. */
  jwtKeySource?: JWTVerifyGetKey;
  /** Context loader override; tests return fixed contexts, no DB. */
  contextLoader?: ContextLoader;
  supabaseAdmin?: SupabaseAdminPort;
  logger?: Logger;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { env } = options;
  const logger = options.logger ?? createLogger(env);
  const ownsDb = options.db === undefined;
  const db = options.db ?? createDb(env.DATABASE_URL);
  const supabaseAdmin = options.supabaseAdmin ?? createSupabaseAdmin(env);

  const app = fastify({
    // pino's Logger structurally satisfies FastifyBaseLogger; the upcast keeps
    // the instance on Fastify's default generics so plugins type-check.
    logger: logger as FastifyBaseLogger,
    genReqId: () => randomUUID(),
    requestIdLogLabel: 'requestId',
  });

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);
  registerErrorHandling(app);

  // Route inventory (see RegisteredRoute). Added before any route registration
  // so every route — including plugin-registered ones — is captured.
  const routeTable: RegisteredRoute[] = [];
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    const preHandler = route.preHandler;
    const preHandlers =
      preHandler === undefined
        ? []
        : Array.isArray(preHandler)
          ? [...preHandler]
          : [preHandler];
    for (const method of methods) {
      routeTable.push({
        method,
        url: route.url,
        config: (route.config ?? {}) as Record<string, unknown>,
        preHandlers,
      });
    }
  });
  app.decorate('routeTable', routeTable as readonly RegisteredRoute[]);

  if (ownsDb) {
    app.addHook('onClose', async () => {
      await db.end({ timeout: 5 });
    });
  }

  // Request bodies at debug only (06 §7); sensitive fields redacted by the
  // logger's `*.field` paths (body.email, body.password, body.token, ...).
  app.addHook('preHandler', async (request) => {
    if (request.body !== undefined) {
      request.log.debug({ body: request.body }, 'request body');
    }
  });

  await app.register(cors, {
    origin: env.CORS_ALLOWED_ORIGINS,
    credentials: true,
  });

  // --- auth middleware chain -------------------------------------------------
  const jwtKeySource =
    options.jwtKeySource ??
    createRemoteJWKSet(new URL(env.SUPABASE_JWT_JWKS_URL));
  const authenticate = createAuthenticate(jwtKeySource);
  const contextLoader = options.contextLoader ?? createDbContextLoader(db);
  const cachedLoader = createCachedContextLoader(contextLoader, 60_000);
  const loadContext = createLoadContext(cachedLoader);

  app.decorateRequest('authUserId', null);
  app.decorateRequest('accessToken', null);
  app.decorateRequest('ctx', null);
  app.decorateRequest('clientId', null);
  app.decorate('authenticate', authenticate);
  app.decorate('loadContext', loadContext);
  app.decorate('invalidateUserContext', cachedLoader.invalidate);

  // --- rate limiting (04 §1): 60/min per IP public, 600/min per user authed --
  // hook: 'preHandler' so it runs after `authenticate` (an onRequest hook) and
  // can key authenticated traffic by userId instead of IP.
  await app.register(rateLimit, {
    global: true,
    hook: 'preHandler',
    timeWindow: 60_000,
    max: (request) => (request.authUserId !== null ? 600 : 60),
    keyGenerator: (request) => request.authUserId ?? request.ip,
    errorResponseBuilder: (request, context) =>
      makeApiError(
        'RATE_LIMITED',
        `Rate limit exceeded. Retry in ${context.after}.`,
        request.id,
      ),
  });

  // --- services --------------------------------------------------------------
  const authService = createAuthService({
    db,
    supabaseAdmin,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    invalidateUserContext: cachedLoader.invalidate,
  });

  // --- routes ----------------------------------------------------------------
  await app.register(healthRoutes, {
    prefix: '/api/v1',
    db,
    version: pkg.version,
  });
  // Unprefixed alias so infrastructure probes can hit /health directly.
  await app.register(healthRoutes, { db, version: pkg.version });

  await app.register(authRoutes, { prefix: '/api/v1', authService });

  // --- OpenAPI (04 §15) ------------------------------------------------------
  const openApiDocument = buildOpenApiDocument(pkg.version);

  app.get('/api/v1/openapi.json', async () => openApiDocument);

  if (env.NODE_ENV !== 'production') {
    await app.register(fastifySwagger, {
      mode: 'static',
      specification: {
        // @fastify/swagger v8's static-mode types stop at OpenAPI 3.0, but it
        // serves any document verbatim; the generated 3.1 document is passed
        // through unchanged.
        document: openApiDocument as unknown as OpenAPIV3.Document,
      },
    });
    await app.register(fastifySwaggerUi, { routePrefix: '/api/v1/docs' });
  }

  return app;
}
