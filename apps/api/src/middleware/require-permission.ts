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

export function requirePermission(key: PermissionKey): Guard {
  return async function permissionGuard(request: FastifyRequest): Promise<void> {
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
