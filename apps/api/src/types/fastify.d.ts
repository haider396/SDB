/**
 * Fastify augmentation for the request context set by the auth middleware
 * chain (authenticate → loadContext → requirePermission/requireClientScope)
 * and the app-level decorators wired in app.ts.
 */
import type { AuthenticateHook } from '../middleware/authenticate.js';
import type { LoadContextHook, RequestContext } from '../middleware/load-context.js';

declare module 'fastify' {
  interface FastifyRequest {
    /** JWT `sub` set by authenticate; null before it runs. */
    authUserId: string | null;
    /** Raw bearer token set by authenticate (needed for logout revocation). */
    accessToken: string | null;
    /** Full request context set by loadContext; null before it runs. */
    ctx: RequestContext | null;
    /** Caller's client id injected by requireClientScope, never from input. */
    clientId: string | null;
  }

  interface FastifyInstance {
    authenticate: AuthenticateHook;
    loadContext: LoadContextHook;
    /** loadContext cache invalidation hook, keyed by user id. */
    invalidateUserContext: (userId: string) => void;
  }
}
