/**
 * loadContext middleware (docs/06-BACKEND.md §3, step 4).
 *
 * Loads the user row, roles, resolved permission keys, and client memberships,
 * cached in-process for 60 seconds keyed by user id. `invalidate(userId)` is
 * the hook role-write code paths must call (and accept-invitation does).
 */
import type { FastifyRequest } from 'fastify';
import type { AuthUser, PermissionKey, UserRoleKey } from '@sdb/contracts';
import type { Db } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import {
  getClientIdsForUser,
  getPermissionKeysForUser,
  getRoleKeysForUser,
} from '../repositories/auth-context.repo.js';
import { findUserById } from '../repositories/users.repo.js';

export interface RequestContext {
  userId: string;
  user: AuthUser;
  roles: UserRoleKey[];
  primaryRole: UserRoleKey | null;
  permissions: Set<PermissionKey>;
  clientIds: string[];
}

/** Resolves a user id to a context, or null for unknown/inactive users. */
export type ContextLoader = (userId: string) => Promise<RequestContext | null>;

const ROLE_PRECEDENCE: UserRoleKey[] = [
  'super_admin',
  'admin',
  'client_admin',
  'client_user',
];

export function pickPrimaryRole(roles: UserRoleKey[]): UserRoleKey | null {
  for (const role of ROLE_PRECEDENCE) {
    if (roles.includes(role)) return role;
  }
  return null;
}

export function createDbContextLoader(db: Db): ContextLoader {
  return async (userId) => {
    const [user, roles, permissions, clientIds] = await Promise.all([
      findUserById(db, userId),
      getRoleKeysForUser(db, userId),
      getPermissionKeysForUser(db, userId),
      getClientIdsForUser(db, userId),
    ]);
    if (user === null || !user.isActive) return null;
    return {
      userId,
      user,
      roles,
      primaryRole: pickPrimaryRole(roles),
      permissions: new Set(permissions),
      clientIds,
    };
  };
}

export interface CachedContextLoader {
  load: ContextLoader;
  /** Invalidation hook — call on any role/permission/membership write. */
  invalidate: (userId: string) => void;
  clear: () => void;
}

export function createCachedContextLoader(
  loader: ContextLoader,
  ttlMs = 60_000,
  now: () => number = Date.now,
): CachedContextLoader {
  const cache = new Map<string, { ctx: RequestContext; expiresAt: number }>();
  return {
    async load(userId) {
      const hit = cache.get(userId);
      if (hit !== undefined && hit.expiresAt > now()) return hit.ctx;
      const ctx = await loader(userId);
      if (ctx === null) {
        cache.delete(userId);
        return null;
      }
      cache.set(userId, { ctx, expiresAt: now() + ttlMs });
      return ctx;
    },
    invalidate(userId) {
      cache.delete(userId);
    },
    clear() {
      cache.clear();
    },
  };
}

export type LoadContextHook = (request: FastifyRequest) => Promise<void>;

export function createLoadContext(cache: CachedContextLoader): LoadContextHook {
  return async function loadContext(request: FastifyRequest): Promise<void> {
    const userId = request.authUserId;
    if (userId === null) {
      throw new ApiError('UNAUTHENTICATED', 'Missing bearer token.');
    }
    const ctx = await cache.load(userId);
    if (ctx === null) {
      throw new ApiError('UNAUTHENTICATED', 'Unknown or inactive user.');
    }
    request.ctx = ctx;
  };
}
