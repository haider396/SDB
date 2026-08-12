/**
 * Auth endpoint contracts. Source: docs/04-API.md §2.
 */
import { z } from 'zod';
import { UserRoleKeySchema } from './enums.js';
import { PermissionKeySchema } from './permissions.js';

export const AuthUserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  phone: z.string().nullable(),
  avatarPath: z.string().nullable(),
  timezone: z.string(),
  isActive: z.boolean(),
  lastLoginAt: z.string().datetime({ offset: true }).nullable(),
});
export type AuthUser = z.infer<typeof AuthUserSchema>;

/**
 * Response of `GET /api/v1/auth/me` — user, roles, resolved permission keys,
 * and `clientId` (null for admin users with no client scope).
 */
export const AuthMeResponseSchema = z.object({
  user: AuthUserSchema,
  roles: z.array(UserRoleKeySchema),
  permissions: z.array(PermissionKeySchema),
  clientId: z.string().uuid().nullable(),
});
export type AuthMeResponse = z.infer<typeof AuthMeResponseSchema>;

/** Body of `POST /api/v1/auth/accept-invitation` (public). */
export const AcceptInvitationBodySchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8),
  fullName: z.string().min(1),
  timezone: z.string().min(1),
});
export type AcceptInvitationBody = z.infer<typeof AcceptInvitationBodySchema>;
