/**
 * Route-level authorization (docs/06-BACKEND.md §3 steps 5–6, 04 §1.3).
 *
 * - `requirePermission('key')` rejects with 403 FORBIDDEN before the handler.
 * - `requireClientScope()` resolves the caller's clientId from their
 *   memberships and injects it into the request context. Client-scoped
 *   handlers never accept a clientId from the request.
 */
import type { FastifyRequest } from 'fastify';
import type { PermissionKey } from '@sdb/contracts';
import { ApiError } from '../lib/errors.js';

type Guard = (request: FastifyRequest) => Promise<void>;

/** A permission guard carries its key so route-table tests can discover it. */
export interface PermissionGuard extends Guard {
  readonly requiredPermission: PermissionKey;
}

export function requirePermission(key: PermissionKey): PermissionGuard {
  const guard = async function permissionGuard(
    request: FastifyRequest,
  ): Promise<void> {
    const ctx = request.ctx;
    if (ctx === null) {
      // loadContext must run first; treat its absence as unauthenticated.
      throw new ApiError('UNAUTHENTICATED', 'Missing request context.');
    }
    if (!ctx.permissions.has(key)) {
      throw new ApiError('FORBIDDEN', 'You do not have permission to do this.', {
        requiredPermission: key,
      });
    }
  };
  // Metadata for the generated permission-matrix test (AC-AUTH-04): the matrix
  // cross-checks each route's declared `config.permission` against the guard
  // actually attached, so a mismatch between the two is a test failure.
  return Object.assign(guard, { requiredPermission: key });
}

/** Extract the permission key from a route preHandler, if it is one of ours. */
export function getRequiredPermission(handler: unknown): PermissionKey | null {
  if (
    typeof handler === 'function' &&
    'requiredPermission' in handler &&
    typeof (handler as PermissionGuard).requiredPermission === 'string'
  ) {
    return (handler as PermissionGuard).requiredPermission;
  }
  return null;
}

export function requireClientScope(): Guard {
  return async function clientScopeGuard(request: FastifyRequest): Promise<void> {
    const ctx = request.ctx;
    if (ctx === null) {
      throw new ApiError('UNAUTHENTICATED', 'Missing request context.');
    }
    const clientId = ctx.clientIds[0];
    if (clientId === undefined) {
      throw new ApiError('FORBIDDEN', 'No client scope for this user.');
    }
    request.clientId = clientId;
  };
}
