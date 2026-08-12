/**
 * Auth business logic (docs/04-API.md §2). No HTTP types in this file.
 */
import type { AcceptInvitationBody } from '@sdb/contracts';
import { withTransaction, type Db } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import type { SupabaseAdminPort } from '../lib/supabase-admin.js';
import { markInvitationAccepted } from '../repositories/auth-context.repo.js';
import { updateUserProfile } from '../repositories/users.repo.js';
import { emitEvent } from './events.js';
import { verifyInvitationToken } from './invitations.js';

export interface AuthServiceDeps {
  db: Db;
  supabaseAdmin: SupabaseAdminPort;
  /** SUPABASE_SERVICE_ROLE_KEY — the invitation-token signing secret source. */
  serviceRoleKey: string;
  /** loadContext cache invalidation hook (06 §3 step 4). */
  invalidateUserContext: (userId: string) => void;
}

export interface AuthService {
  acceptInvitation(body: AcceptInvitationBody): Promise<{ accepted: true }>;
  logout(accessToken: string): Promise<void>;
}

export function createAuthService(deps: AuthServiceDeps): AuthService {
  return {
    /**
     * Verifies the signed single-use invitation token, marks the membership
     * accepted, updates the profile, sets the password via the Supabase Admin
     * API, and emits the event — all within one transaction, so a failure at
     * any step (including the Admin API call) rolls everything back and the
     * token stays usable.
     */
    async acceptInvitation(body) {
      const payload = verifyInvitationToken(deps.serviceRoleKey, body.token);

      await withTransaction(deps.db, async (tx) => {
        const memberId = await markInvitationAccepted(
          tx,
          payload.clientId,
          payload.userId,
        );
        if (memberId === null) {
          throw new ApiError(
            'VALIDATION_FAILED',
            'Invitation is invalid or has already been accepted.',
          );
        }

        const updated = await updateUserProfile(tx, payload.userId, {
          fullName: body.fullName,
          timezone: body.timezone,
        });
        if (!updated) {
          throw new ApiError('VALIDATION_FAILED', 'Invitation user not found.');
        }

        await deps.supabaseAdmin.updateUserPassword(payload.userId, body.password);

        await emitEvent(tx, {
          entityType: 'client',
          entityId: payload.clientId,
          eventType: 'invitation_accepted',
          actorId: payload.userId,
          actorRole: null,
          metadata: { userId: payload.userId, clientMemberId: memberId },
        });
      });

      deps.invalidateUserContext(payload.userId);
      return { accepted: true };
    },

    async logout(accessToken) {
      await deps.supabaseAdmin.signOutUser(accessToken);
    },
  };
}
