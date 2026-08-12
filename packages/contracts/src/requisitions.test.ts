import { describe, expect, it } from 'vitest';
import {
  ListRequisitionsQuerySchema,
  PrincipalRequestChangesBodySchema,
  REQUISITION_COMMERCIAL_KEYS,
  RequisitionCommercialFieldsSchema,
  RequisitionSchema,
  TransitionRequisitionBodySchema,
  UpdateRequisitionAnswersBodySchema,
  UpdateRequisitionBodySchema,
} from './requisitions.js';

const UUID = '6f1f4e9a-3f6a-4a3e-9a3e-1c2d3e4f5a6b';
const NOW = '2026-08-12T09:00:00.000Z';

const baseRequisition = {
  id: UUID,
  reference: 'REQ-000123',
  clientId: UUID,
  clientName: 'Acme Inc.',
  engineId: null,
  departmentId: null,
  roleCategoryId: null,
  advertisedTitle: null,
  headcount: 1,
  status: 'submitted',
  seniorityLevel: null,
  engagementType: null,
  hoursPerWeek: null,
  overlapStart: null,
  overlapEnd: null,
  overlapTimezone: null,
  targetStartDate: null,
  urgency: null,
  principalUserId: null,
  principalApprovedAt: null,
  submittedAt: NOW,
  sourcingStartedAt: null,
  closedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
};

describe('RequisitionSchema — commercial-field omission (AC-RQ-06)', () => {
  it('parses WITHOUT any commercial key (caller lacks view_commercials)', () => {
    const result = RequisitionSchema.safeParse(baseRequisition);
    expect(result.success).toBe(true);
    if (result.success) {
      for (const key of REQUISITION_COMMERCIAL_KEYS) {
        expect(key in result.data, `${key} must stay absent`).toBe(false);
      }
    }
  });

  it('parses WITH the commercial keys (caller has view_commercials)', () => {
    const result = RequisitionSchema.safeParse({
      ...baseRequisition,
      budgetMin: 2000,
      budgetMax: 3000,
      budgetUnit: 'monthly',
      budgetCurrency: 'USD',
      budgetIsFlexible: true,
      serviceTier: 'standard_placement',
    });
    expect(result.success).toBe(true);
  });

  it('REQUISITION_COMMERCIAL_KEYS matches the commercial fields schema exactly', () => {
    expect([...REQUISITION_COMMERCIAL_KEYS].sort()).toEqual(
      Object.keys(RequisitionCommercialFieldsSchema.shape).sort(),
    );
  });
});

describe('ListRequisitionsQuerySchema', () => {
  it('defaults limit and accepts the documented filters', () => {
    const result = ListRequisitionsQuerySchema.parse({
      status: 'sourcing',
      clientId: UUID,
      engineId: UUID,
      roleCategoryId: UUID,
      search: 'assistant',
    });
    expect(result.limit).toBe(25);
  });

  it('rejects an unknown status filter', () => {
    expect(ListRequisitionsQuerySchema.safeParse({ status: 'open' }).success).toBe(false);
  });
});

describe('UpdateRequisitionBodySchema (04 §7 PATCH)', () => {
  it('accepts the admin fields including briefMarkdown, budget, headcount, principalUserId', () => {
    expect(
      UpdateRequisitionBodySchema.safeParse({
        briefMarkdown: '# Brief',
        headcount: 2,
        budgetMin: 2000,
        budgetMax: 2500,
        budgetUnit: 'monthly',
        principalUserId: UUID,
      }).success,
    ).toBe(true);
  });

  it('rejects an empty body and a zero headcount', () => {
    expect(UpdateRequisitionBodySchema.safeParse({}).success).toBe(false);
    expect(UpdateRequisitionBodySchema.safeParse({ headcount: 0 }).success).toBe(false);
  });

  it('accepts the overlap window as HH:MM (or HH:MM:SS) plus an IANA zone', () => {
    expect(
      UpdateRequisitionBodySchema.safeParse({
        overlapStart: '09:00',
        overlapEnd: '14:00:00',
        overlapTimezone: 'America/Chicago',
      }).success,
    ).toBe(true);
    expect(
      UpdateRequisitionBodySchema.safeParse({
        overlapStart: null,
        overlapEnd: null,
        overlapTimezone: null,
      }).success,
    ).toBe(true);
  });

  it('rejects a malformed overlap time', () => {
    expect(
      UpdateRequisitionBodySchema.safeParse({ overlapStart: '9am' }).success,
    ).toBe(false);
    expect(
      UpdateRequisitionBodySchema.safeParse({ overlapEnd: '25' }).success,
    ).toBe(false);
  });
});

describe('TransitionRequisitionBodySchema', () => {
  it('accepts a valid target status with an optional note', () => {
    expect(
      TransitionRequisitionBodySchema.safeParse({
        toStatus: 'pending_principal_approval',
        note: 'brief drafted',
      }).success,
    ).toBe(true);
    expect(
      TransitionRequisitionBodySchema.safeParse({ toStatus: 'on_hold' }).success,
    ).toBe(true);
  });

  it('rejects an unknown status (legality of the move is API behaviour)', () => {
    expect(
      TransitionRequisitionBodySchema.safeParse({ toStatus: 'archived' }).success,
    ).toBe(false);
  });
});

describe('PrincipalRequestChangesBodySchema (AC-RQ-05)', () => {
  it('requires a non-empty comment', () => {
    expect(
      PrincipalRequestChangesBodySchema.safeParse({ comment: 'too broad' }).success,
    ).toBe(true);
    expect(PrincipalRequestChangesBodySchema.safeParse({ comment: '' }).success).toBe(false);
    expect(PrincipalRequestChangesBodySchema.safeParse({}).success).toBe(false);
  });
});

describe('UpdateRequisitionAnswersBodySchema', () => {
  it('requires at least one answer, each with exactly one value field', () => {
    expect(
      UpdateRequisitionAnswersBodySchema.safeParse({
        answers: [{ questionKey: 'company_name', valueText: 'Acme' }],
      }).success,
    ).toBe(true);
    expect(
      UpdateRequisitionAnswersBodySchema.safeParse({ answers: [] }).success,
    ).toBe(false);
    expect(
      UpdateRequisitionAnswersBodySchema.safeParse({
        answers: [{ questionKey: 'k', valueText: 'x', valueNumber: 1 }],
      }).success,
    ).toBe(false);
  });
});
