/**
 * Fastify augmentation for the request context set by the auth middleware
 * chain (authenticate → loadContext → requirePermission/requireClientScope)
 * and the app-level decorators wired in app.ts.
 */
import type { PermissionKey } from '@sdb/contracts';
import type { RegisteredRoute } from '../app.js';
import type { AuthenticateHook } from '../middleware/authenticate.js';
import type { LoadContextHook, RequestContext } from '../middleware/load-context.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    /**
     * The permission this route requires, declared alongside the
     * requirePermission guard. The generated permission-matrix test
     * (AC-AUTH-04) reads this and fails when a permission-guarded route
     * omits it or declares a different key than the guard enforces.
     */
    permission?: PermissionKey;
  }
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
    /** Inventory of every registered route+method (see RegisteredRoute). */
    routeTable: readonly RegisteredRoute[];
  }
}
