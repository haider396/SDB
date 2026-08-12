/**
 * Thin integration point over the Supabase Admin API (service role key).
 *
 * Kept behind the `SupabaseAdminPort` interface so services depend on the port
 * and tests stub it — no network in unit tests. The service role key exists
 * only in the API's environment (06 §3) and never appears in responses/logs.
 *
 * `@supabase/supabase-js` is otherwise reserved for Storage signed URLs in P3.
 */
import { createClient } from '@supabase/supabase-js';
import type { Env } from './env.js';
import { ApiError } from './errors.js';

export interface SupabaseAdminPort {
  /**
   * Create an auth user (grant-access / member-invite flows). The returned id
   * becomes the `users.id` mirror row. The user is created without a password;
   * accept-invitation sets one.
   */
  createUser(input: { email: string; fullName: string }): Promise<{ id: string }>;
  /** Set a user's password via the Admin API (accept-invitation flow). */
  updateUserPassword(userId: string, password: string): Promise<void>;
  /** Revoke the refresh tokens behind an access token (logout). */
  signOutUser(accessToken: string): Promise<void>;
  /**
   * Revoke every session/refresh token of a user by id (revoke-access flow).
   * Idempotent: a user with no sessions is a success.
   */
  revokeUserSessions(userId: string): Promise<void>;
}

export function createSupabaseAdmin(
  env: Pick<Env, 'SUPABASE_URL' | 'SUPABASE_SERVICE_ROLE_KEY'>,
): SupabaseAdminPort {
  const client = createClient(
    env.SUPABASE_URL,
    env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  return {
    async createUser({ email, fullName }) {
      const { data, error } = await client.auth.admin.createUser({
        email,
        // Invited users authenticate only after accept-invitation sets a
        // password; the address is treated as confirmed so that flow works.
        email_confirm: true,
        user_metadata: { full_name: fullName },
      });
      if (error) {
        if (typeof error.status === 'number' && error.status < 500) {
          throw new ApiError('VALIDATION_FAILED', 'Could not create the user.', {
            reason: error.message,
          });
        }
        throw new ApiError('INTERNAL_ERROR', 'Could not create the user.');
      }
      const id = data.user?.id;
      if (id === undefined) {
        throw new ApiError('INTERNAL_ERROR', 'Could not create the user.');
      }
      return { id };
    },

    async updateUserPassword(userId, password) {
      const { error } = await client.auth.admin.updateUserById(userId, {
        password,
      });
      if (error) {
        // 4xx from GoTrue (weak password, unknown user) is a caller problem;
        // anything else is ours. Never surface provider internals verbatim.
        if (typeof error.status === 'number' && error.status < 500) {
          throw new ApiError('VALIDATION_FAILED', 'Could not set password.', {
            reason: error.message,
          });
        }
        throw new ApiError('INTERNAL_ERROR', 'Could not set password.');
      }
    },

    async signOutUser(accessToken) {
      const { error } = await client.auth.admin.signOut(accessToken);
      if (error && !(typeof error.status === 'number' && error.status < 500)) {
        throw new ApiError('INTERNAL_ERROR', 'Could not revoke session.');
      }
      // A 4xx here means the token was already invalid — logout is idempotent.
    },

    async revokeUserSessions(userId) {
      // supabase-js exposes admin.signOut(jwt) only; per-user revocation is a
      // GoTrue admin endpoint, called directly with the service role key.
      const response = await fetch(
        `${env.SUPABASE_URL}/auth/v1/admin/users/${userId}/logout`,
        {
          method: 'POST',
          headers: {
            apikey: env.SUPABASE_SERVICE_ROLE_KEY,
            authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
          },
        },
      );
      // 404 = unknown user / no sessions — revocation is idempotent.
      if (!response.ok && response.status !== 404) {
        throw new ApiError('INTERNAL_ERROR', 'Could not revoke sessions.');
      }
    },
  };
}
