/**
 * Client management business rules (docs/04-API.md §6, docs/01 §3 J2,
 * docs/06-BACKEND.md §2.1). No HTTP types, no SQL strings.
 *
 * Rules enforced here:
 * - portal access requires confirmed payment → 422 PAYMENT_NOT_CONFIRMED
 *   (AC-CL-01); the DB check constraint backs this up
 * - grant-access runs in ONE transaction: user create + users row +
 *   client_members + user_roles + clients update + event + queued
 *   portal_invitation notification (AC-CL-02); the notification enqueue is a
 *   savepoint sub-step whose failure never rolls back the grant (AC-CL-03)
 * - client-scoped callers only ever address their own client: reads 404,
 *   writes 403 WRONG_TENANT when the foreign client exists (04 §1.3)
 * - a client_admin invites only into their own client (AC-AUTH-06)
 * - the one-principal / one-primary-contact partial indexes surface as 422
 * - the last client_admin cannot be removed or demoted (AC-AUTH-07)
 * - every state change writes an events row
 */
import type {
  Client,
  ClientMember,
  ConfirmPaymentBody,
  CreateClientBody,
  GrantAccessBody,
  InviteMemberBody,
  ListClientsQuery,
  UpdateClientBody,
  UpdateMemberBody,
  UserRoleKey,
} from '@sdb/contracts';
import { decodeCursor, encodeCursor } from '../lib/cursor.js';
import { withTransaction, type Db, type Queryable } from '../lib/db.js';
import { ApiError } from '../lib/errors.js';
import type { SupabaseAdminPort } from '../lib/supabase-admin.js';
import {
  archiveMember,
  assignClientRole,
  confirmClientPayment,
  countActiveClientAdmins,
  findClientById,
  findMember,
  findUserIdByEmail,
  insertClient,
  insertUserRow,
  listClients,
  listMembers,
  removeClientRoles,
  setMemberPrincipal,
  setPortalAccess,
  setUserActive,
  updateClient,
  upsertInvitedMember,
  type ClientMemberRecord,
  type ClientRecord,
} from '../repositories/clients.repo.js';
import { resolvePublicId } from '../repositories/public-ids.repo.js';
import { emitEvent } from './events.js';
import { issueInvitationToken } from './invitations.js';
import { safeEnqueue, type EnqueueLogger } from './notifications.js';

export interface ClientActor {
  userId: string;
  role: UserRoleKey | null;
  /** Resolved membership scope — null for admin callers (04 §1.3). */
  ownClientId: string | null;
}

export interface ClientsServiceDeps {
  db: Db;
  supabaseAdmin: SupabaseAdminPort;
  /** Invitation-token signing secret source (services/invitations.ts). */
  serviceRoleKey: string;
  /** Base for invitation actionUrls in notification payloads (06 §4.1). */
  publicAppUrl: string;
  /** loadContext cache invalidation (06 §3 step 4). */
  invalidateUserContext: (userId: string) => void;
  logger?: EnqueueLogger;
}

export interface ClientsService {
  list(
    query: ListClientsQuery,
  ): Promise<{ data: Client[]; nextCursor: string | null; total?: number }>;
  create(body: CreateClientBody, actor: ClientActor): Promise<Client>;
  get(clientId: string, actor: ClientActor): Promise<Client>;
  update(
    clientId: string,
    body: UpdateClientBody,
    actor: ClientActor,
  ): Promise<Client>;
  confirmPayment(
    clientId: string,
    body: ConfirmPaymentBody,
    actor: ClientActor,
  ): Promise<Client>;
  grantAccess(
    clientId: string,
    body: GrantAccessBody,
    actor: ClientActor,
  ): Promise<Client>;
  revokeAccess(
    clientId: string,
    actor: ClientActor,
  ): Promise<{ revoked: true; deactivatedUserIds: string[] }>;
  listMembers(clientId: string, actor: ClientActor): Promise<ClientMember[]>;
  inviteMember(
    clientId: string,
    body: InviteMemberBody,
    actor: ClientActor,
  ): Promise<ClientMember>;
  removeMember(
    clientId: string,
    userId: string,
    actor: ClientActor,
  ): Promise<void>;
  updateMember(
    clientId: string,
    userId: string,
    body: UpdateMemberBody,
    actor: ClientActor,
  ): Promise<ClientMember>;
}

/** Postgres unique_violation. */
const PG_UNIQUE_VIOLATION = '23505';

function pgError(error: unknown): { code?: string; constraint?: string } {
  if (typeof error !== 'object' || error === null) return {};
  const err = error as { code?: unknown; constraint_name?: unknown };
  return {
    ...(typeof err.code === 'string' ? { code: err.code } : {}),
    ...(typeof err.constraint_name === 'string'
      ? { constraint: err.constraint_name }
      : {}),
  };
}

/** Map the 0003 partial unique indexes to clean 422s (04 §6 invite/patch). */
function mapMembershipUniqueViolation(error: unknown): never {
  const { code, constraint } = pgError(error);
  if (code === PG_UNIQUE_VIOLATION) {
    if (constraint === 'idx_one_principal_per_client') {
      throw new ApiError(
        'VALIDATION_FAILED',
        'This client already has a principal. Clear the existing principal first.',
        { fields: { isPrincipal: 'A client can have only one principal.' } },
      );
    }
    if (constraint === 'idx_one_primary_contact_per_client') {
      throw new ApiError(
        'VALIDATION_FAILED',
        'This client already has a primary contact.',
        { fields: { isPrimaryContact: 'A client can have only one primary contact.' } },
      );
    }
  }
  throw error;
}

function toClientPayload(record: ClientRecord, includeAdminFields: boolean): Client {
  const { onboardingReadinessNote, internalNotes, ...visible } = record;
  return includeAdminFields
    ? { ...visible, onboardingReadinessNote, internalNotes }
    : visible;
}

export function createClientsService(deps: ClientsServiceDeps): ClientsService {
  const isAdmin = (actor: ClientActor): boolean => actor.ownClientId === null;

  /**
   * Map a uuid-or-public-id client reference (0015) to the internal uuid
   * BEFORE any tenancy comparison, so both address forms behave identically.
   * Identity for uuids (no query); 404 for an unknown public_id.
   */
  async function resolveClientRef(clientRef: string): Promise<string> {
    const clientId = await resolvePublicId(deps.db, 'clients', clientRef);
    if (clientId === null) throw new ApiError('NOT_FOUND', 'Client not found.');
    return clientId;
  }

  /**
   * Read addressing (04 §6): client users may only read their own client;
   * anything else — existing or not — is a 404. Callers reassign their
   * `clientId` parameter to the returned record's `.id` (the uuid).
   */
  async function loadForRead(
    clientRef: string,
    actor: ClientActor,
  ): Promise<ClientRecord> {
    const clientId = await resolveClientRef(clientRef);
    if (!isAdmin(actor) && actor.ownClientId !== clientId) {
      throw new ApiError('NOT_FOUND', 'Client not found.');
    }
    const client = await findClientById(deps.db, clientId);
    if (client === null) throw new ApiError('NOT_FOUND', 'Client not found.');
    return client;
  }

  /**
   * Write addressing (04 §1.3, AC-AUTH-06): a scoped caller writing to a
   * foreign client gets 403 WRONG_TENANT when that client is known to exist,
   * 404 otherwise. Callers reassign their `clientId` parameter to the
   * returned record's `.id` (the uuid).
   */
  async function loadForWrite(
    clientRef: string,
    actor: ClientActor,
  ): Promise<ClientRecord> {
    const clientId = await resolveClientRef(clientRef);
    if (!isAdmin(actor) && actor.ownClientId !== clientId) {
      const exists = await findClientById(deps.db, clientId);
      if (exists !== null) {
        throw new ApiError('WRONG_TENANT', 'This resource belongs to another client.');
      }
      throw new ApiError('NOT_FOUND', 'Client not found.');
    }
    const client = await findClientById(deps.db, clientId);
    if (client === null) throw new ApiError('NOT_FOUND', 'Client not found.');
    return client;
  }

  /** Find-or-create the auth user + users mirror row for an invitation. */
  async function ensureUser(
    tx: Queryable,
    email: string,
    fullName: string,
  ): Promise<string> {
    const existing = await findUserIdByEmail(tx, email);
    if (existing !== null) {
      await setUserActive(tx, existing, true);
      return existing;
    }
    const created = await deps.supabaseAdmin.createUser({ email, fullName });
    await insertUserRow(tx, { id: created.id, email, fullName });
    return created.id;
  }

  function invitationContext(
    client: ClientRecord,
    userId: string,
  ): Record<string, unknown> {
    const token = issueInvitationToken(deps.serviceRoleKey, {
      userId,
      clientId: client.id,
    });
    return {
      clientName: client.companyName,
      actionUrl: `${deps.publicAppUrl}/accept-invitation?token=${token}`,
    };
  }

  return {
    async list(query) {
      const { data: rows, total } = await listClients(deps.db, {
        ...(query.status !== undefined ? { status: query.status } : {}),
        ...(query.search !== undefined ? { search: query.search } : {}),
        ...(query.hasPendingAccess !== undefined
          ? { hasPendingAccess: query.hasPendingAccess }
          : {}),
        limit: query.limit,
        ...(query.cursor !== undefined
          ? { cursor: decodeCursor(query.cursor) }
          : {}),
      });
      const last = rows[rows.length - 1];
      return {
        data: rows.map((row) => toClientPayload(row, true)),
        nextCursor:
          rows.length === query.limit && last !== undefined
            ? encodeCursor({ createdAt: last.createdAt, id: last.id })
            : null,
        // UX 2.9: full filtered count — first (un-cursored) pages only.
        ...(query.cursor === undefined ? { total } : {}),
      };
    },

    async create(body, actor) {
      const client = await withTransaction(deps.db, async (tx) => {
        const created = await insertClient(tx, {
          companyName: body.companyName,
          website: body.website ?? null,
          industry: body.industry ?? null,
          teamSizeBand: body.teamSizeBand ?? null,
          companyTimezone: body.companyTimezone ?? null,
          onboardingReadinessNote: body.onboardingReadinessNote ?? null,
          internalNotes: body.internalNotes ?? null,
        });
        await emitEvent(tx, {
          entityType: 'client',
          entityId: created.id,
          eventType: 'client_created',
          actorId: actor.userId,
          actorRole: actor.role,
          toValue: 'prospect',
          metadata: { companyName: created.companyName },
        });
        return created;
      });
      return toClientPayload(client, true);
    },

    async get(clientId, actor) {
      const client = await loadForRead(clientId, actor);
      return toClientPayload(client, isAdmin(actor));
    },

    async update(clientId, body, actor) {
      const before = await loadForWrite(clientId, actor);
      clientId = before.id;
      const client = await withTransaction(deps.db, async (tx) => {
        const updated = await updateClient(tx, clientId, body);
        if (updated === null) throw new ApiError('NOT_FOUND', 'Client not found.');
        await emitEvent(tx, {
          entityType: 'client',
          entityId: clientId,
          eventType: 'client_updated',
          actorId: actor.userId,
          actorRole: actor.role,
          fromValue: before.status,
          toValue: updated.status,
          metadata: { changedFields: Object.keys(body) },
        });
        return updated;
      });
      return toClientPayload(client, isAdmin(actor));
    },

    async confirmPayment(clientId, body, actor) {
      const before = await loadForWrite(clientId, actor);
      clientId = before.id;
      const client = await withTransaction(deps.db, async (tx) => {
        const updated = await confirmClientPayment(tx, clientId, {
          paymentConfirmedAt: body.paymentConfirmedAt,
          invoiceReference: body.invoiceReference ?? null,
          serviceTier: body.serviceTier,
        });
        if (updated === null) throw new ApiError('NOT_FOUND', 'Client not found.');
        await emitEvent(tx, {
          entityType: 'client',
          entityId: clientId,
          eventType: 'payment_confirmed',
          actorId: actor.userId,
          actorRole: actor.role,
          fromValue: before.status,
          toValue: updated.status,
          metadata: {
            paymentConfirmedAt: body.paymentConfirmedAt,
            invoiceReference: body.invoiceReference ?? null,
            serviceTier: body.serviceTier,
          },
        });
        return updated;
      });
      return toClientPayload(client, true);
    },

    async grantAccess(clientId, body, actor) {
      const client = await loadForWrite(clientId, actor);
      clientId = client.id;
      // J2 rule: no portal access while payment is unconfirmed (AC-CL-01).
      // The chk_access_requires_payment constraint backs this up in SQL.
      if (client.paymentConfirmedAt === null) {
        throw new ApiError(
          'PAYMENT_NOT_CONFIRMED',
          'Portal access cannot be granted before payment is confirmed.',
        );
      }

      let invitedUserId = '';
      let updated: ClientRecord;
      try {
        // One transaction (06 §2.1): user create + users row + client_members
        // + user_roles + clients update + event + queued notification.
        updated = await withTransaction(deps.db, async (tx) => {
          const userId = await ensureUser(
            tx,
            body.primaryContactEmail,
            body.primaryContactName,
          );
          invitedUserId = userId;

          const memberId = await upsertInvitedMember(tx, {
            clientId,
            userId,
            jobTitle: null,
            isPrimaryContact: true,
            isPrincipal: body.isPrincipal,
            invitedBy: actor.userId,
          });
          await assignClientRole(tx, userId, 'client_admin', clientId);

          const enabled = await setPortalAccess(tx, clientId, actor.userId);
          if (enabled === null) throw new ApiError('NOT_FOUND', 'Client not found.');

          await emitEvent(tx, {
            entityType: 'client',
            entityId: clientId,
            eventType: 'access_granted',
            actorId: actor.userId,
            actorRole: actor.role,
            fromValue: null,
            toValue: 'enabled',
            metadata: {
              userId,
              clientMemberId: memberId,
              primaryContactEmail: body.primaryContactEmail,
              isPrincipal: body.isPrincipal,
            },
          });

          // Sub-step: a failed enqueue must NOT roll back the grant (AC-CL-03).
          await safeEnqueue(tx, deps.logger, {
            event: 'portal_invitation',
            recipient: {
              userId,
              email: body.primaryContactEmail,
              fullName: body.primaryContactName,
            },
            entityType: 'client',
            entityId: clientId,
            context: invitationContext(client, userId),
          });

          return enabled;
        });
      } catch (error) {
        mapMembershipUniqueViolation(error);
      }

      deps.invalidateUserContext(invitedUserId);
      return toClientPayload(updated, true);
    },

    async revokeAccess(clientId, actor) {
      clientId = (await loadForWrite(clientId, actor)).id;
      const members = await listMembers(deps.db, clientId);
      const deactivatedUserIds = await withTransaction(deps.db, async (tx) => {
        const cleared = await setPortalAccess(tx, clientId, null);
        if (cleared === null) throw new ApiError('NOT_FOUND', 'Client not found.');
        const userIds: string[] = [];
        for (const member of members) {
          await setUserActive(tx, member.userId, false);
          await deps.supabaseAdmin.revokeUserSessions(member.userId);
          userIds.push(member.userId);
        }
        await emitEvent(tx, {
          entityType: 'client',
          entityId: clientId,
          eventType: 'access_revoked',
          actorId: actor.userId,
          actorRole: actor.role,
          fromValue: 'enabled',
          toValue: null,
          metadata: { deactivatedUserIds: userIds },
        });
        return userIds;
      });
      for (const userId of deactivatedUserIds) {
        deps.invalidateUserContext(userId);
      }
      return { revoked: true, deactivatedUserIds };
    },

    async listMembers(clientId, actor) {
      clientId = (await loadForRead(clientId, actor)).id;
      return listMembers(deps.db, clientId);
    },

    async inviteMember(clientId, body, actor) {
      // AC-AUTH-06: a client_admin invites ONLY into their own client — a
      // foreign existing client is 403 WRONG_TENANT.
      const client = await loadForWrite(clientId, actor);
      clientId = client.id;

      let invitedUserId = '';
      let memberId: string | null = null;
      try {
        await withTransaction(deps.db, async (tx) => {
          const userId = await ensureUser(tx, body.email, body.fullName);
          invitedUserId = userId;
          memberId = await upsertInvitedMember(tx, {
            clientId,
            userId,
            jobTitle: body.jobTitle ?? null,
            isPrimaryContact: false,
            isPrincipal: body.isPrincipal ?? false,
            invitedBy: actor.userId,
          });
          if (memberId === null) {
            throw new ApiError(
              'VALIDATION_FAILED',
              'This user is already a member of the client.',
              { fields: { email: 'Already a member.' } },
            );
          }
          await assignClientRole(tx, userId, body.role, clientId);
          await emitEvent(tx, {
            entityType: 'client',
            entityId: clientId,
            eventType: 'member_invited',
            actorId: actor.userId,
            actorRole: actor.role,
            toValue: body.role,
            metadata: {
              userId,
              clientMemberId: memberId,
              email: body.email,
              role: body.role,
              isPrincipal: body.isPrincipal ?? false,
            },
          });
          await safeEnqueue(tx, deps.logger, {
            event: 'portal_invitation',
            recipient: { userId, email: body.email, fullName: body.fullName },
            entityType: 'client',
            entityId: clientId,
            context: invitationContext(client, userId),
          });
        });
      } catch (error) {
        mapMembershipUniqueViolation(error);
      }

      deps.invalidateUserContext(invitedUserId);
      const member = await findMember(deps.db, clientId, invitedUserId);
      if (member === null) {
        throw new ApiError('INTERNAL_ERROR', 'Invited member not found after insert.');
      }
      return member;
    },

    async removeMember(clientId, userId, actor) {
      clientId = (await loadForWrite(clientId, actor)).id;
      const member = await findMember(deps.db, clientId, userId);
      if (member === null) throw new ApiError('NOT_FOUND', 'Member not found.');

      // AC-AUTH-07: the last client_admin cannot be removed.
      if (member.role === 'client_admin') {
        const admins = await countActiveClientAdmins(deps.db, clientId);
        if (admins <= 1) {
          throw new ApiError(
            'VALIDATION_FAILED',
            'The last client admin of a client cannot be removed.',
            { fields: { userId: 'This user is the last client admin.' } },
          );
        }
      }

      await withTransaction(deps.db, async (tx) => {
        const archived = await archiveMember(tx, clientId, userId);
        if (archived === null) throw new ApiError('NOT_FOUND', 'Member not found.');
        await removeClientRoles(tx, userId, clientId);
        await emitEvent(tx, {
          entityType: 'client',
          entityId: clientId,
          eventType: 'member_removed',
          actorId: actor.userId,
          actorRole: actor.role,
          fromValue: member.role,
          toValue: null,
          metadata: { userId, clientMemberId: member.id },
        });
      });
      deps.invalidateUserContext(userId);
    },

    async updateMember(clientId, userId, body, actor) {
      clientId = (await loadForWrite(clientId, actor)).id;
      const member = await findMember(deps.db, clientId, userId);
      if (member === null) throw new ApiError('NOT_FOUND', 'Member not found.');

      // Demoting the last client_admin is removal in disguise (AC-AUTH-07).
      if (
        body.role === 'client_user' &&
        member.role === 'client_admin'
      ) {
        const admins = await countActiveClientAdmins(deps.db, clientId);
        if (admins <= 1) {
          throw new ApiError(
            'VALIDATION_FAILED',
            'The last client admin of a client cannot be demoted.',
            { fields: { role: 'This user is the last client admin.' } },
          );
        }
      }

      try {
        await withTransaction(deps.db, async (tx) => {
          if (body.role !== undefined && body.role !== member.role) {
            await removeClientRoles(tx, userId, clientId);
            await assignClientRole(tx, userId, body.role, clientId);
          }
          if (body.isPrincipal !== undefined) {
            const set = await setMemberPrincipal(tx, clientId, userId, body.isPrincipal);
            if (!set) throw new ApiError('NOT_FOUND', 'Member not found.');
          }
          await emitEvent(tx, {
            entityType: 'client',
            entityId: clientId,
            eventType: 'member_updated',
            actorId: actor.userId,
            actorRole: actor.role,
            fromValue: member.role,
            toValue: body.role ?? member.role,
            metadata: {
              userId,
              clientMemberId: member.id,
              changedFields: Object.keys(body),
              ...(body.isPrincipal !== undefined
                ? { isPrincipal: body.isPrincipal }
                : {}),
            },
          });
        });
      } catch (error) {
        mapMembershipUniqueViolation(error);
      }

      deps.invalidateUserContext(userId);
      const updated = await findMember(deps.db, clientId, userId);
      if (updated === null) {
        throw new ApiError('INTERNAL_ERROR', 'Member not found after update.');
      }
      return updated;
    },
  };
}

export type { ClientMemberRecord };
