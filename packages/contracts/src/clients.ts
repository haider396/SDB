/**
 * Client management contracts (admin surface + client self-view).
 * Source: docs/04-API.md §6 (endpoint table), docs/02-DATABASE.md §4
 * (clients / client_members), docs/01-PRODUCT-OVERVIEW.md §3 J2.
 *
 * Shared by API validation, the OpenAPI generator, and the admin front end.
 */
import { z } from 'zod';
import { ClientStatusSchema, ServiceTierSchema } from './enums.js';

// ---------------------------------------------------------------------------
// Client resource
// ---------------------------------------------------------------------------

/**
 * A client as returned to admins. `onboardingReadinessNote` and
 * `internalNotes` are admin-only: for client-scoped callers the keys are
 * ABSENT (not null) — same omission pattern as requisition commercials.
 */
export const ClientSchema = z.object({
  id: z.string().uuid(),
  companyName: z.string(),
  website: z.string().nullable(),
  industry: z.string().nullable(),
  teamSizeBand: z.string().nullable(),
  companyTimezone: z.string().nullable(),
  status: ClientStatusSchema,
  serviceTier: ServiceTierSchema.nullable(),
  paymentConfirmedAt: z.string().datetime({ offset: true }).nullable(),
  invoiceReference: z.string().nullable(),
  portalAccessEnabledAt: z.string().datetime({ offset: true }).nullable(),
  portalAccessEnabledBy: z.string().uuid().nullable(),
  /** Admin-only; key absent for client-scoped callers. */
  onboardingReadinessNote: z.string().nullable().optional(),
  /** Admin-only; key absent for client-scoped callers. */
  internalNotes: z.string().nullable().optional(),
  createdAt: z.string().datetime({ offset: true }),
  updatedAt: z.string().datetime({ offset: true }),
  archivedAt: z.string().datetime({ offset: true }).nullable(),
});
export type Client = z.infer<typeof ClientSchema>;

// ---------------------------------------------------------------------------
// Queries and bodies (04 §6)
// ---------------------------------------------------------------------------

/** Query-string booleans arrive as 'true'/'false' strings. */
const QueryBooleanSchema = z
  .enum(['true', 'false'])
  .transform((value) => value === 'true');

/** `GET /clients` — admin only; cursor pagination per 04 §1. */
export const ListClientsQuerySchema = z.object({
  status: ClientStatusSchema.optional(),
  search: z.string().min(1).max(200).optional(),
  /** payment confirmed but portal access not yet granted (01 §6). */
  hasPendingAccess: QueryBooleanSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(25),
  cursor: z.string().min(1).optional(),
});
export type ListClientsQuery = z.infer<typeof ListClientsQuerySchema>;

/** `POST /clients` — manual creation outside the intake funnel. */
export const CreateClientBodySchema = z.object({
  companyName: z.string().min(1).max(500),
  website: z.string().max(500).nullable().optional(),
  industry: z.string().max(200).nullable().optional(),
  teamSizeBand: z.string().max(100).nullable().optional(),
  companyTimezone: z.string().max(100).nullable().optional(),
  onboardingReadinessNote: z.string().max(5000).nullable().optional(),
  internalNotes: z.string().max(10000).nullable().optional(),
});
export type CreateClientBody = z.infer<typeof CreateClientBodySchema>;

/** `PATCH /clients/:id`. */
export const UpdateClientBodySchema = z
  .object({
    companyName: z.string().min(1).max(500).optional(),
    website: z.string().max(500).nullable().optional(),
    industry: z.string().max(200).nullable().optional(),
    teamSizeBand: z.string().max(100).nullable().optional(),
    companyTimezone: z.string().max(100).nullable().optional(),
    status: ClientStatusSchema.optional(),
    serviceTier: ServiceTierSchema.nullable().optional(),
    onboardingReadinessNote: z.string().max(5000).nullable().optional(),
    internalNotes: z.string().max(10000).nullable().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateClientBody = z.infer<typeof UpdateClientBodySchema>;

/** `POST /clients/:id/confirm-payment` (04 §6, J2 step 2–3). */
export const ConfirmPaymentBodySchema = z.object({
  paymentConfirmedAt: z.string().datetime({ offset: true }),
  invoiceReference: z.string().max(200).optional(),
  serviceTier: ServiceTierSchema,
});
export type ConfirmPaymentBody = z.infer<typeof ConfirmPaymentBodySchema>;

/**
 * `POST /clients/:id/grant-access` (04 §6, J2 step 4, 06 §2.1).
 * Rejected with 422 PAYMENT_NOT_CONFIRMED while payment is unconfirmed.
 */
export const GrantAccessBodySchema = z.object({
  primaryContactEmail: z.string().email().max(320),
  primaryContactName: z.string().min(1).max(500),
  isPrincipal: z.boolean(),
});
export type GrantAccessBody = z.infer<typeof GrantAccessBodySchema>;

// ---------------------------------------------------------------------------
// Members (04 §6)
// ---------------------------------------------------------------------------

/** The two client-side roles a member may hold. */
export const ClientMemberRoleSchema = z.enum(['client_admin', 'client_user']);
export type ClientMemberRole = z.infer<typeof ClientMemberRoleSchema>;

export const ClientMemberSchema = z.object({
  /** client_members.id */
  id: z.string().uuid(),
  clientId: z.string().uuid(),
  userId: z.string().uuid(),
  email: z.string().email(),
  fullName: z.string(),
  jobTitle: z.string().nullable(),
  role: ClientMemberRoleSchema.nullable(),
  isPrimaryContact: z.boolean(),
  isPrincipal: z.boolean(),
  isActive: z.boolean(),
  invitedAt: z.string().datetime({ offset: true }).nullable(),
  acceptedAt: z.string().datetime({ offset: true }).nullable(),
  createdAt: z.string().datetime({ offset: true }),
});
export type ClientMember = z.infer<typeof ClientMemberSchema>;

/**
 * `POST /clients/:id/members/invite`. A `client_admin` may invite only into
 * their own client (AC-AUTH-06); enforced by the API, not the schema.
 */
export const InviteMemberBodySchema = z.object({
  email: z.string().email().max(320),
  fullName: z.string().min(1).max(500),
  jobTitle: z.string().max(200).optional(),
  role: ClientMemberRoleSchema,
  isPrincipal: z.boolean().optional(),
});
export type InviteMemberBody = z.infer<typeof InviteMemberBodySchema>;

/** `PATCH /clients/:id/members/:userId` — change role and/or principal flag. */
export const UpdateMemberBodySchema = z
  .object({
    role: ClientMemberRoleSchema.optional(),
    isPrincipal: z.boolean().optional(),
  })
  .refine((body) => Object.keys(body).length > 0, {
    message: 'At least one field must be provided',
  });
export type UpdateMemberBody = z.infer<typeof UpdateMemberBodySchema>;

/** `POST /clients/:id/revoke-access` response payload. */
export const RevokeAccessResponseSchema = z.object({
  revoked: z.literal(true),
  /** Users deactivated (and whose sessions were revoked) by the call. */
  deactivatedUserIds: z.array(z.string().uuid()),
});
export type RevokeAccessResponse = z.infer<typeof RevokeAccessResponseSchema>;
