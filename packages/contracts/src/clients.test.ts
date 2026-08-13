import { describe, expect, it } from 'vitest';
import {
  ClientSchema,
  ConfirmPaymentBodySchema,
  CreateClientBodySchema,
  GrantAccessBodySchema,
  InviteMemberBodySchema,
  ListClientsQuerySchema,
  UpdateClientBodySchema,
  UpdateMemberBodySchema,
} from './clients.js';

const UUID = '6f1f4e9a-3f6a-4a3e-9a3e-1c2d3e4f5a6b';
const NOW = '2026-08-12T09:00:00.000Z';

describe('ClientSchema', () => {
  const base = {
    id: UUID,
    publicId: 'lSbqRVXPbTmC',
    companyName: 'Acme Inc.',
    website: null,
    industry: null,
    teamSizeBand: null,
    companyTimezone: null,
    status: 'prospect',
    serviceTier: null,
    paymentConfirmedAt: null,
    invoiceReference: null,
    portalAccessEnabledAt: null,
    portalAccessEnabledBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
  };

  it('parses an admin payload with the admin-only note fields present', () => {
    const result = ClientSchema.safeParse({
      ...base,
      onboardingReadinessNote: 'ready',
      internalNotes: 'internal',
    });
    expect(result.success).toBe(true);
  });

  it('parses a client-scoped payload with the admin-only keys ABSENT', () => {
    const result = ClientSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect('internalNotes' in result.data).toBe(false);
      expect('onboardingReadinessNote' in result.data).toBe(false);
    }
  });

  it('rejects an unknown status', () => {
    expect(ClientSchema.safeParse({ ...base, status: 'lead' }).success).toBe(false);
  });
});

describe('ListClientsQuerySchema', () => {
  it('coerces query-string values and defaults the limit', () => {
    const result = ListClientsQuerySchema.parse({
      status: 'active',
      hasPendingAccess: 'true',
    });
    expect(result.limit).toBe(25);
    expect(result.hasPendingAccess).toBe(true);
  });

  it('caps limit at 100', () => {
    expect(ListClientsQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });
});

describe('CreateClientBodySchema / UpdateClientBodySchema', () => {
  it('requires only companyName on create', () => {
    expect(CreateClientBodySchema.safeParse({ companyName: 'Acme' }).success).toBe(true);
    expect(CreateClientBodySchema.safeParse({}).success).toBe(false);
  });

  it('rejects an empty PATCH body', () => {
    expect(UpdateClientBodySchema.safeParse({}).success).toBe(false);
    expect(UpdateClientBodySchema.safeParse({ status: 'inactive' }).success).toBe(true);
  });
});

describe('ConfirmPaymentBodySchema (04 §6)', () => {
  it('accepts the documented body', () => {
    expect(
      ConfirmPaymentBodySchema.safeParse({
        paymentConfirmedAt: NOW,
        invoiceReference: 'INV-42',
        serviceTier: 'standard_placement',
      }).success,
    ).toBe(true);
  });

  it('requires serviceTier and a valid timestamp', () => {
    expect(
      ConfirmPaymentBodySchema.safeParse({ paymentConfirmedAt: NOW }).success,
    ).toBe(false);
    expect(
      ConfirmPaymentBodySchema.safeParse({
        paymentConfirmedAt: 'yesterday',
        serviceTier: 'standard_placement',
      }).success,
    ).toBe(false);
  });
});

describe('GrantAccessBodySchema (04 §6)', () => {
  it('accepts the documented body', () => {
    expect(
      GrantAccessBodySchema.safeParse({
        primaryContactEmail: 'founder@acme.com',
        primaryContactName: 'Founder Fran',
        isPrincipal: true,
      }).success,
    ).toBe(true);
  });

  it('rejects a malformed email and a missing isPrincipal', () => {
    expect(
      GrantAccessBodySchema.safeParse({
        primaryContactEmail: 'not-an-email',
        primaryContactName: 'X',
        isPrincipal: false,
      }).success,
    ).toBe(false);
    expect(
      GrantAccessBodySchema.safeParse({
        primaryContactEmail: 'a@b.co',
        primaryContactName: 'X',
      }).success,
    ).toBe(false);
  });
});

describe('InviteMemberBodySchema / UpdateMemberBodySchema (04 §6)', () => {
  it('accepts client_admin and client_user roles only', () => {
    for (const role of ['client_admin', 'client_user'] as const) {
      expect(
        InviteMemberBodySchema.safeParse({
          email: 'colleague@acme.com',
          fullName: 'Col League',
          role,
        }).success,
      ).toBe(true);
    }
    expect(
      InviteMemberBodySchema.safeParse({
        email: 'x@acme.com',
        fullName: 'X',
        role: 'admin',
      }).success,
    ).toBe(false);
  });

  it('rejects an empty member PATCH', () => {
    expect(UpdateMemberBodySchema.safeParse({}).success).toBe(false);
    expect(UpdateMemberBodySchema.safeParse({ isPrincipal: true }).success).toBe(true);
    expect(UpdateMemberBodySchema.safeParse({ role: 'client_user' }).success).toBe(true);
  });
});
