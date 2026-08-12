/**
 * SQL for clients and client_members (docs/02-DATABASE.md §4, docs/04-API.md
 * §6). No business logic — payment gates, tenancy rules, and the
 * last-client_admin guard live in services/clients.service.ts.
 */
import type { ClientMemberRole, ClientStatus, ServiceTier } from '@sdb/contracts';
import type { Queryable } from '../lib/db.js';

// ---------------------------------------------------------------------------
// Row shapes and mapping
// ---------------------------------------------------------------------------

export interface ClientRecord {
  id: string;
  companyName: string;
  website: string | null;
  industry: string | null;
  teamSizeBand: string | null;
  companyTimezone: string | null;
  status: ClientStatus;
  serviceTier: ServiceTier | null;
  paymentConfirmedAt: string | null;
  invoiceReference: string | null;
  portalAccessEnabledAt: string | null;
  portalAccessEnabledBy: string | null;
  onboardingReadinessNote: string | null;
  internalNotes: string | null;
  createdAt: string;
  updatedAt: string;
  archivedAt: string | null;
}

interface ClientRow {
  id: string;
  company_name: string;
  website: string | null;
  industry: string | null;
  team_size_band: string | null;
  company_timezone: string | null;
  status: ClientStatus;
  service_tier: ServiceTier | null;
  payment_confirmed_at: Date | null;
  invoice_reference: string | null;
  portal_access_enabled_at: Date | null;
  portal_access_enabled_by: string | null;
  onboarding_readiness_note: string | null;
  internal_notes: string | null;
  created_at: Date;
  updated_at: Date;
  archived_at: Date | null;
}

const iso = (value: Date | null): string | null =>
  value === null ? null : value.toISOString();

function mapClient(row: ClientRow): ClientRecord {
  return {
    id: row.id,
    companyName: row.company_name,
    website: row.website,
    industry: row.industry,
    teamSizeBand: row.team_size_band,
    companyTimezone: row.company_timezone,
    status: row.status,
    serviceTier: row.service_tier,
    paymentConfirmedAt: iso(row.payment_confirmed_at),
    invoiceReference: row.invoice_reference,
    portalAccessEnabledAt: iso(row.portal_access_enabled_at),
    portalAccessEnabledBy: row.portal_access_enabled_by,
    onboardingReadinessNote: row.onboarding_readiness_note,
    internalNotes: row.internal_notes,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    archivedAt: iso(row.archived_at),
  };
}

const CLIENT_COLUMNS = `
  id, company_name, website, industry, team_size_band, company_timezone,
  status, service_tier, payment_confirmed_at, invoice_reference,
  portal_access_enabled_at, portal_access_enabled_by,
  onboarding_readiness_note, internal_notes,
  created_at, updated_at, archived_at
`;

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export interface ListClientsFilters {
  status?: ClientStatus;
  search?: string;
  hasPendingAccess?: boolean;
  limit: number;
  /** Keyset cursor: rows strictly after this (created_at desc, id desc). */
  cursor?: { createdAt: string; id: string };
}

export async function listClients(
  sql: Queryable,
  filters: ListClientsFilters,
): Promise<ClientRecord[]> {
  const rows = await sql<ClientRow[]>`
    select ${sql.unsafe(CLIENT_COLUMNS)}
    from clients
    where archived_at is null
      ${filters.status === undefined ? sql`` : sql`and status = ${filters.status}`}
      ${
        filters.search === undefined
          ? sql``
          : sql`and company_name ilike ${'%' + filters.search + '%'}`
      }
      ${
        filters.hasPendingAccess === undefined
          ? sql``
          : filters.hasPendingAccess
            ? sql`and payment_confirmed_at is not null and portal_access_enabled_at is null`
            : sql`and not (payment_confirmed_at is not null and portal_access_enabled_at is null)`
      }
      ${
        filters.cursor === undefined
          ? sql``
          : sql`and (created_at, id) < (${filters.cursor.createdAt}::timestamptz, ${filters.cursor.id}::uuid)`
      }
    order by created_at desc, id desc
    limit ${filters.limit}
  `;
  return rows.map(mapClient);
}

export async function findClientById(
  sql: Queryable,
  clientId: string,
): Promise<ClientRecord | null> {
  const rows = await sql<ClientRow[]>`
    select ${sql.unsafe(CLIENT_COLUMNS)}
    from clients
    where id = ${clientId}
      and archived_at is null
  `;
  const row = rows[0];
  return row === undefined ? null : mapClient(row);
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface InsertClientInput {
  companyName: string;
  website: string | null;
  industry: string | null;
  teamSizeBand: string | null;
  companyTimezone: string | null;
  onboardingReadinessNote: string | null;
  internalNotes: string | null;
}

export async function insertClient(
  sql: Queryable,
  input: InsertClientInput,
): Promise<ClientRecord> {
  const rows = await sql<ClientRow[]>`
    insert into clients (
      company_name, website, industry, team_size_band, company_timezone,
      onboarding_readiness_note, internal_notes, status
    ) values (
      ${input.companyName}, ${input.website}, ${input.industry},
      ${input.teamSizeBand}, ${input.companyTimezone},
      ${input.onboardingReadinessNote}, ${input.internalNotes}, 'prospect'
    )
    returning ${sql.unsafe(CLIENT_COLUMNS)}
  `;
  const row = rows[0];
  if (row === undefined) throw new Error('client insert returned no row');
  return mapClient(row);
}

export interface UpdateClientPatch {
  companyName?: string;
  website?: string | null;
  industry?: string | null;
  teamSizeBand?: string | null;
  companyTimezone?: string | null;
  status?: ClientStatus;
  serviceTier?: ServiceTier | null;
  onboardingReadinessNote?: string | null;
  internalNotes?: string | null;
}

export async function updateClient(
  sql: Queryable,
  clientId: string,
  patch: UpdateClientPatch,
): Promise<ClientRecord | null> {
  const assignments: Record<string, unknown> = {};
  if (patch.companyName !== undefined) assignments['company_name'] = patch.companyName;
  if (patch.website !== undefined) assignments['website'] = patch.website;
  if (patch.industry !== undefined) assignments['industry'] = patch.industry;
  if (patch.teamSizeBand !== undefined) assignments['team_size_band'] = patch.teamSizeBand;
  if (patch.companyTimezone !== undefined) {
    assignments['company_timezone'] = patch.companyTimezone;
  }
  if (patch.status !== undefined) assignments['status'] = patch.status;
  if (patch.serviceTier !== undefined) assignments['service_tier'] = patch.serviceTier;
  if (patch.onboardingReadinessNote !== undefined) {
    assignments['onboarding_readiness_note'] = patch.onboardingReadinessNote;
  }
  if (patch.internalNotes !== undefined) {
    assignments['internal_notes'] = patch.internalNotes;
  }
  if (Object.keys(assignments).length === 0) {
    return findClientById(sql, clientId);
  }
  const rows = await sql<ClientRow[]>`
    update clients
    set ${sql(assignments)}, updated_at = now()
    where id = ${clientId}
      and archived_at is null
    returning ${sql.unsafe(CLIENT_COLUMNS)}
  `;
  const row = rows[0];
  return row === undefined ? null : mapClient(row);
}

export async function confirmClientPayment(
  sql: Queryable,
  clientId: string,
  input: {
    paymentConfirmedAt: string;
    invoiceReference: string | null;
    serviceTier: ServiceTier;
  },
): Promise<ClientRecord | null> {
  const rows = await sql<ClientRow[]>`
    update clients
    set payment_confirmed_at = ${input.paymentConfirmedAt}::timestamptz,
        invoice_reference = coalesce(${input.invoiceReference}, invoice_reference),
        service_tier = ${input.serviceTier},
        status = case when status = 'prospect' then 'active'::client_status else status end,
        updated_at = now()
    where id = ${clientId}
      and archived_at is null
    returning ${sql.unsafe(CLIENT_COLUMNS)}
  `;
  const row = rows[0];
  return row === undefined ? null : mapClient(row);
}

export async function setPortalAccess(
  sql: Queryable,
  clientId: string,
  enabledBy: string | null,
): Promise<ClientRecord | null> {
  const rows = await sql<ClientRow[]>`
    update clients
    set portal_access_enabled_at = ${enabledBy === null ? null : sql`now()`},
        portal_access_enabled_by = ${enabledBy},
        updated_at = now()
    where id = ${clientId}
      and archived_at is null
    returning ${sql.unsafe(CLIENT_COLUMNS)}
  `;
  const row = rows[0];
  return row === undefined ? null : mapClient(row);
}

// ---------------------------------------------------------------------------
// Users (grant-access / invite flows)
// ---------------------------------------------------------------------------

export async function findUserIdByEmail(
  sql: Queryable,
  email: string,
): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    select id from users where email = ${email} and archived_at is null
  `;
  return rows[0]?.id ?? null;
}

export async function insertUserRow(
  sql: Queryable,
  input: { id: string; email: string; fullName: string },
): Promise<void> {
  await sql`
    insert into users (id, email, full_name)
    values (${input.id}, ${input.email}, ${input.fullName})
  `;
}

export async function setUserActive(
  sql: Queryable,
  userId: string,
  isActive: boolean,
): Promise<void> {
  await sql`
    update users set is_active = ${isActive}, updated_at = now()
    where id = ${userId}
  `;
}

/** Assign a client-scoped role, ignoring an already-present identical row. */
export async function assignClientRole(
  sql: Queryable,
  userId: string,
  roleKey: ClientMemberRole,
  clientId: string,
): Promise<void> {
  await sql`
    insert into user_roles (user_id, role_id, scope_type, scope_id)
    values (${userId}, (select id from roles where key = ${roleKey}), 'client', ${clientId})
    on conflict (user_id, role_id, scope_type, scope_id) do nothing
  `;
}

/** Remove the caller's client-scoped roles for this client (both keys). */
export async function removeClientRoles(
  sql: Queryable,
  userId: string,
  clientId: string,
): Promise<void> {
  await sql`
    delete from user_roles
    where user_id = ${userId}
      and scope_type = 'client'
      and scope_id = ${clientId}
      and role_id in (select id from roles where key in ('client_admin', 'client_user'))
  `;
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export interface ClientMemberRecord {
  id: string;
  clientId: string;
  userId: string;
  email: string;
  fullName: string;
  jobTitle: string | null;
  role: ClientMemberRole | null;
  isPrimaryContact: boolean;
  isPrincipal: boolean;
  isActive: boolean;
  invitedAt: string | null;
  acceptedAt: string | null;
  createdAt: string;
}

interface MemberRow {
  id: string;
  client_id: string;
  user_id: string;
  email: string;
  full_name: string;
  job_title: string | null;
  role: ClientMemberRole | null;
  is_primary_contact: boolean;
  is_principal: boolean;
  is_active: boolean;
  invited_at: Date | null;
  accepted_at: Date | null;
  created_at: Date;
}

function mapMember(row: MemberRow): ClientMemberRecord {
  return {
    id: row.id,
    clientId: row.client_id,
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
    jobTitle: row.job_title,
    role: row.role,
    isPrimaryContact: row.is_primary_contact,
    isPrincipal: row.is_principal,
    isActive: row.is_active,
    invitedAt: iso(row.invited_at),
    acceptedAt: iso(row.accepted_at),
    createdAt: row.created_at.toISOString(),
  };
}

const MEMBER_SELECT = `
  select cm.id, cm.client_id, cm.user_id, u.email, u.full_name, cm.job_title,
         (select r.key from user_roles ur
            join roles r on r.id = ur.role_id
           where ur.user_id = cm.user_id
             and ur.scope_type = 'client'
             and ur.scope_id = cm.client_id
             and r.key in ('client_admin', 'client_user')
           order by case r.key when 'client_admin' then 0 else 1 end
           limit 1) as role,
         cm.is_primary_contact, cm.is_principal, u.is_active,
         cm.invited_at, cm.accepted_at, cm.created_at
  from client_members cm
  join users u on u.id = cm.user_id
`;

export async function listMembers(
  sql: Queryable,
  clientId: string,
): Promise<ClientMemberRecord[]> {
  const rows = await sql<MemberRow[]>`
    ${sql.unsafe(MEMBER_SELECT)}
    where cm.client_id = ${clientId}
      and cm.archived_at is null
    order by cm.created_at asc, cm.id asc
  `;
  return rows.map(mapMember);
}

export async function findMember(
  sql: Queryable,
  clientId: string,
  userId: string,
): Promise<ClientMemberRecord | null> {
  const rows = await sql<MemberRow[]>`
    ${sql.unsafe(MEMBER_SELECT)}
    where cm.client_id = ${clientId}
      and cm.user_id = ${userId}
      and cm.archived_at is null
  `;
  const row = rows[0];
  return row === undefined ? null : mapMember(row);
}

/**
 * Insert an invited membership, reviving an archived (removed or expired)
 * row for the same (client, user) instead of violating the unique constraint.
 * Returns null when the user is already an active member.
 */
export async function upsertInvitedMember(
  sql: Queryable,
  input: {
    clientId: string;
    userId: string;
    jobTitle: string | null;
    isPrimaryContact: boolean;
    isPrincipal: boolean;
    invitedBy: string;
  },
): Promise<string | null> {
  const existing = await sql<{ id: string; archived_at: Date | null }[]>`
    select id, archived_at from client_members
    where client_id = ${input.clientId} and user_id = ${input.userId}
  `;
  const row = existing[0];
  if (row === undefined) {
    const inserted = await sql<{ id: string }[]>`
      insert into client_members (
        client_id, user_id, job_title, is_primary_contact, is_principal,
        invited_by, invited_at
      ) values (
        ${input.clientId}, ${input.userId}, ${input.jobTitle},
        ${input.isPrimaryContact}, ${input.isPrincipal},
        ${input.invitedBy}, now()
      )
      returning id
    `;
    const insertedRow = inserted[0];
    if (insertedRow === undefined) {
      throw new Error('client_members insert returned no row');
    }
    return insertedRow.id;
  }
  if (row.archived_at === null) return null; // already an active member
  const revived = await sql<{ id: string }[]>`
    update client_members
    set archived_at = null,
        accepted_at = null,
        job_title = ${input.jobTitle},
        is_primary_contact = ${input.isPrimaryContact},
        is_principal = ${input.isPrincipal},
        invited_by = ${input.invitedBy},
        invited_at = now()
    where id = ${row.id}
    returning id
  `;
  const revivedRow = revived[0];
  if (revivedRow === undefined) {
    throw new Error('client_members revive returned no row');
  }
  return revivedRow.id;
}

/**
 * Soft removal (04 §6): archives the membership and clears the exclusive
 * flags so the 0003 partial unique indexes never block a replacement.
 */
export async function archiveMember(
  sql: Queryable,
  clientId: string,
  userId: string,
): Promise<string | null> {
  const rows = await sql<{ id: string }[]>`
    update client_members
    set archived_at = now(),
        is_primary_contact = false,
        is_principal = false
    where client_id = ${clientId}
      and user_id = ${userId}
      and archived_at is null
    returning id
  `;
  return rows[0]?.id ?? null;
}

export async function setMemberPrincipal(
  sql: Queryable,
  clientId: string,
  userId: string,
  isPrincipal: boolean,
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    update client_members
    set is_principal = ${isPrincipal}
    where client_id = ${clientId}
      and user_id = ${userId}
      and archived_at is null
    returning id
  `;
  return rows.length > 0;
}

/**
 * Active client_admin count for the last-client_admin guard (AC-AUTH-07):
 * unarchived memberships whose user holds the client-scoped client_admin role
 * and is active.
 */
export async function countActiveClientAdmins(
  sql: Queryable,
  clientId: string,
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    select count(*)::text as count
    from client_members cm
    join users u on u.id = cm.user_id
    join user_roles ur on ur.user_id = cm.user_id
      and ur.scope_type = 'client'
      and ur.scope_id = cm.client_id
    join roles r on r.id = ur.role_id
    where cm.client_id = ${clientId}
      and cm.archived_at is null
      and u.is_active
      and r.key = 'client_admin'
  `;
  return Number(rows[0]?.count ?? '0');
}

/** Active member users of a client — notification recipients (06 §4.4). */
export interface ClientUserRecipient {
  userId: string;
  email: string;
  fullName: string;
}

export async function getActiveClientUsers(
  sql: Queryable,
  clientId: string,
): Promise<ClientUserRecipient[]> {
  const rows = await sql<{ user_id: string; email: string; full_name: string }[]>`
    select cm.user_id, u.email, u.full_name
    from client_members cm
    join users u on u.id = cm.user_id
    where cm.client_id = ${clientId}
      and cm.archived_at is null
      and u.is_active
      and u.archived_at is null
    order by u.email
  `;
  return rows.map((row) => ({
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
  }));
}

// ---------------------------------------------------------------------------
// Stale-invitation expiry (06 §5, AC-CL-05)
// ---------------------------------------------------------------------------

export interface ExpiredInvitationRecord {
  memberId: string;
  clientId: string;
  userId: string;
}

/**
 * Archive unaccepted invitations issued before `cutoff`, clearing the
 * exclusive flags (same shape as archiveMember). Once archived, the token's
 * acceptance UPDATE (`archived_at is null`) matches zero rows.
 */
export async function expireInvitationsBefore(
  sql: Queryable,
  cutoff: string,
): Promise<ExpiredInvitationRecord[]> {
  const rows = await sql<{ id: string; client_id: string; user_id: string }[]>`
    update client_members
    set archived_at = now(),
        is_primary_contact = false,
        is_principal = false
    where accepted_at is null
      and archived_at is null
      and invited_at is not null
      and invited_at < ${cutoff}::timestamptz
    returning id, client_id, user_id
  `;
  return rows.map((row) => ({
    memberId: row.id,
    clientId: row.client_id,
    userId: row.user_id,
  }));
}
