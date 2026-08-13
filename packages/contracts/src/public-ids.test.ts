import { describe, expect, it } from 'vitest';
import { AdminAssignmentRowSchema } from './assignments.js';
import { CandidateSchema } from './candidates.js';
import { ClientSchema } from './clients.js';
import {
  AttentionQueueItemSchema,
  ClientDashboardRequisitionSchema,
} from './dashboard.js';
import {
  EntityRefSchema,
  PUBLIC_ID_LENGTH,
  PUBLIC_ID_REGEX,
  PublicIdSchema,
} from './public-ids.js';
import { RequisitionSchema } from './requisitions.js';

const UUID = '6f1f4e9a-3f6a-4a3e-9a3e-1c2d3e4f5a6b';
const PUBLIC_ID = 'lSbqRVXPbTmC';

describe('PublicIdSchema', () => {
  it('accepts exactly 12 base62 characters', () => {
    expect(PublicIdSchema.safeParse(PUBLIC_ID).success).toBe(true);
    expect(PublicIdSchema.safeParse('0123456789Az').success).toBe(true);
  });

  it('rejects wrong lengths and non-base62 characters', () => {
    expect(PublicIdSchema.safeParse('short').success).toBe(false);
    expect(PublicIdSchema.safeParse('lSbqRVXPbTmCeqMGPoWK').success).toBe(false); // 20 chars
    expect(PublicIdSchema.safeParse('lSbqRVXPbTm_').success).toBe(false);
    expect(PublicIdSchema.safeParse('lSbqRVXPbTm-').success).toBe(false);
    expect(PublicIdSchema.safeParse(UUID).success).toBe(false);
  });

  it('PUBLIC_ID_REGEX matches the documented length constant', () => {
    expect(PUBLIC_ID_REGEX.test('a'.repeat(PUBLIC_ID_LENGTH))).toBe(true);
    expect(PUBLIC_ID_REGEX.test('a'.repeat(PUBLIC_ID_LENGTH + 1))).toBe(false);
  });
});

describe('EntityRefSchema', () => {
  it('accepts a UUID or a public id', () => {
    expect(EntityRefSchema.safeParse(UUID).success).toBe(true);
    expect(EntityRefSchema.safeParse(PUBLIC_ID).success).toBe(true);
  });

  it('rejects anything else', () => {
    expect(EntityRefSchema.safeParse('REQ-000001').success).toBe(false);
    expect(EntityRefSchema.safeParse('not-an-id').success).toBe(false);
    expect(EntityRefSchema.safeParse('').success).toBe(false);
  });
});

describe('publicId is a required response field', () => {
  const requiredIn = (
    shape: Record<string, { isOptional(): boolean }>,
  ): boolean =>
    'publicId' in shape && shape['publicId']?.isOptional() === false;

  it('CandidateSchema, ClientSchema, RequisitionSchema carry required publicId', () => {
    expect(requiredIn(CandidateSchema.shape)).toBe(true);
    expect(requiredIn(ClientSchema.shape)).toBe(true);
    expect(requiredIn(RequisitionSchema.shape)).toBe(true);
  });

  it('admin assignment candidate summaries carry required publicId', () => {
    expect(
      requiredIn(AdminAssignmentRowSchema.shape.candidate.shape),
    ).toBe(true);
  });

  it('client dashboard requisitions carry required publicId', () => {
    expect(requiredIn(ClientDashboardRequisitionSchema.shape)).toBe(true);
  });

  it('attention-queue items carry an OPTIONAL requisitionPublicId (UUID field stays)', () => {
    const shape = AttentionQueueItemSchema.shape;
    expect(shape.requisitionPublicId.isOptional()).toBe(true);
    expect(shape.requisitionId.isOptional()).toBe(true);
    const item = AttentionQueueItemSchema.parse({
      entityType: 'assignment',
      entityId: UUID,
      requisitionId: UUID,
      requisitionPublicId: PUBLIC_ID,
      reference: 'REQ-000001',
      label: 'Maria G. — REQ-000001',
      since: '2026-08-12T09:00:00.000Z',
    });
    expect(item.requisitionPublicId).toBe(PUBLIC_ID);
  });
});
