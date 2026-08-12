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
  /** Set a user's password via the Admin API (accept-invitation flow). */
  updateUserPassword(userId: string, password: string): Promise<void>;
  /** Revoke the refresh tokens behind an access token (logout). */
  signOutUser(accessToken: string): Promise<void>;
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
  };
}
