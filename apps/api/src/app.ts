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
import { createDb, type Db } from './lib/db.js';
import type { Env } from './lib/env.js';
import { ApiError, registerErrorHandling } from './lib/errors.js';
import { createLogger, type Logger } from './lib/logger.js';
import { buildOpenApiDocument } from './lib/openapi.js';
import {
  createSupabaseAdmin,
  type SupabaseAdminPort,
} from './lib/supabase-admin.js';
import {
  createSupabaseStorage,
  type SupabaseStoragePort,
} from './lib/supabase-storage.js';
import { createAuthenticate } from './middleware/authenticate.js';
import {
  createCachedContextLoader,
  createDbContextLoader,
  createLoadContext,
  type ContextLoader,
} from './middleware/load-context.js';
import { authRoutes } from './routes/auth.js';
import { candidateRoutes } from './routes/candidates.js';
import { clientRoutes } from './routes/clients.js';
import { fileRoutes } from './routes/files.js';
import { healthRoutes } from './routes/health.js';
import { intakeRoutes } from './routes/intake.js';
import { questionRoutes } from './routes/questions.js';
import { requisitionRoutes } from './routes/requisitions.js';
import { createAuthService } from './services/auth.service.js';
import { createCandidateFilesService } from './services/candidate-files.service.js';
import {
  createCandidateWebhookService,
  type CvFetcher,
} from './services/candidate-webhook.service.js';
import { createCandidatesService } from './services/candidates.service.js';
import { createClientsService } from './services/clients.service.js';
import { createIntakeFormService } from './services/intake-form.service.js';
import { createIntakeSubmissionService } from './services/intake-submission.service.js';
import { createQuestionsService } from './services/questions.service.js';
import { createRequisitionsService } from './services/requisitions.service.js';

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
  /**
   * preValidation + preHandler guards as registered, for cross-checking
   * declared permissions. Authorization guards attach at preValidation so a
   * denied caller receives 403 before body validation can 400 (04 §1.3).
   */
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
  /** Storage port override; tests inject an in-memory stub (P3 files). */
  storage?: SupabaseStoragePort;
  /** Webhook CV fetcher override; tests inject a canned/local fetcher. */
  cvFetcher?: CvFetcher;
  logger?: Logger;
  /**
   * Injectable clock (epoch ms) for the intake-form cache TTL — integration
   * tests control it directly instead of mocking global timers (AC-Q-01).
   */
  now?: () => number;
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const { env } = options;
  const logger = options.logger ?? createLogger(env);
  const ownsDb = options.db === undefined;
  const db = options.db ?? createDb(env.DATABASE_URL);
  const supabaseAdmin = options.supabaseAdmin ?? createSupabaseAdmin(env);
  const storage = options.storage ?? createSupabaseStorage(env);

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
    const collect = (hooks: unknown): unknown[] =>
      hooks === undefined ? [] : Array.isArray(hooks) ? [...hooks] : [hooks];
    const preHandlers = [
      ...collect(route.preValidation),
      ...collect(route.preHandler),
    ];
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
    // The builder's return value is THROWN by the plugin, so it must be an
    // Error carrying a statusCode — ApiError(429) flows through the global
    // error handler into the standard envelope with Retry-After intact.
    errorResponseBuilder: (_request, context) =>
      new ApiError(
        'RATE_LIMITED',
        `Rate limit exceeded. Retry in ${context.after}.`,
      ),
  });

  // --- services --------------------------------------------------------------
  const authService = createAuthService({
    db,
    supabaseAdmin,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    invalidateUserContext: cachedLoader.invalidate,
  });

  const intakeFormService = createIntakeFormService({
    db,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  const questionsService = createQuestionsService({
    db,
    invalidateFormCache: () => intakeFormService.clearCache(),
  });
  const intakeSubmissionService = createIntakeSubmissionService({
    db,
    formService: intakeFormService,
    logger,
    ...(options.now !== undefined ? { now: options.now } : {}),
  });
  app.decorate('clearIntakeFormCache', () => intakeFormService.clearCache());

  const clientsService = createClientsService({
    db,
    supabaseAdmin,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    publicAppUrl: env.PUBLIC_APP_URL,
    invalidateUserContext: cachedLoader.invalidate,
    logger,
  });
  const requisitionsService = createRequisitionsService({ db, logger });
  const candidatesService = createCandidatesService({ db });
  const candidateFilesService = createCandidateFilesService({ db, storage });
  const candidateWebhookService = createCandidateWebhookService({
    db,
    storage,
    webhookToken: env.WEBHOOK_INBOUND_TOKEN,
    logger,
    ...(options.cvFetcher !== undefined ? { cvFetcher: options.cvFetcher } : {}),
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

  await app.register(intakeRoutes, {
    prefix: '/api/v1',
    intakeFormService,
    intakeSubmissionService,
  });
  await app.register(questionRoutes, {
    prefix: '/api/v1',
    questionsService,
    intakeFormService,
  });
  await app.register(requisitionRoutes, {
    prefix: '/api/v1',
    intakeSubmissionService,
    requisitionsService,
  });
  await app.register(clientRoutes, {
    prefix: '/api/v1',
    clientsService,
  });
  await app.register(candidateRoutes, {
    prefix: '/api/v1',
    candidatesService,
    candidateFilesService,
    candidateWebhookService,
  });
  await app.register(fileRoutes, {
    prefix: '/api/v1',
    candidateFilesService,
  });

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
