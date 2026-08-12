import { describe, expect, it } from 'vitest';
import {
  ACCENT_STRENGTH_ORDER,
  CandidateConsentBodySchema,
  CreateCandidateBodySchema,
  DOWNLOAD_URL_TTL_SECONDS,
  FileUploadUrlBodySchema,
  ListCandidatesQuerySchema,
  PutCandidateToolsBodySchema,
  PutDisqualifierChecksBodySchema,
  UpdateCandidateBodySchema,
  UpdateCandidateFileBodySchema,
  WebhookCandidateBodySchema,
  WebhookResponseSchema,
} from './candidates.js';

describe('CreateCandidateBodySchema', () => {
  it('accepts only firstName and lastName (AC-CA-01)', () => {
    const result = CreateCandidateBodySchema.safeParse({
      firstName: 'Maria',
      lastName: 'Gomez',
    });
    expect(result.success).toBe(true);
  });

  it('rejects a missing lastName', () => {
    expect(
      CreateCandidateBodySchema.safeParse({ firstName: 'Maria' }).success,
    ).toBe(false);
  });

  it('rejects server-owned fields (displayName, dataCompleteness) via strictness of known keys only', () => {
    // Unknown keys are stripped, not rejected — but they must not survive.
    const parsed = CreateCandidateBodySchema.parse({
      firstName: 'Maria',
      lastName: 'Gomez',
      displayName: 'hacked',
      dataCompleteness: 'incomplete',
      reference: 'CAN-999999',
    } as Record<string, unknown>);
    expect(parsed).not.toHaveProperty('displayName');
    expect(parsed).not.toHaveProperty('dataCompleteness');
    expect(parsed).not.toHaveProperty('reference');
  });

  it('accepts a rich body with enums and arrays', () => {
    const result = CreateCandidateBodySchema.safeParse({
      firstName: 'Ana',
      lastName: 'Lopez',
      englishSpokenLevel: 'professional',
      accentStrength: 'light',
      engagementTypes: ['full_time', 'project'],
      expectedRateAmount: 2000,
      expectedRateUnit: 'monthly',
      recruiterRating: 5,
      doNotPresentToClientIds: ['0e6bb251-9bb2-4b6e-b7b9-1d4f9f0d3f5f'],
    });
    expect(result.success).toBe(true);
  });

  it('rejects an out-of-range rating and a bad enum', () => {
    expect(
      CreateCandidateBodySchema.safeParse({
        firstName: 'A',
        lastName: 'B',
        recruiterRating: 6,
      }).success,
    ).toBe(false);
    expect(
      CreateCandidateBodySchema.safeParse({
        firstName: 'A',
        lastName: 'B',
        accentStrength: 'very_heavy',
      }).success,
    ).toBe(false);
  });
});

describe('UpdateCandidateBodySchema', () => {
  it('requires at least one field', () => {
    expect(UpdateCandidateBodySchema.safeParse({}).success).toBe(false);
    expect(
      UpdateCandidateBodySchema.safeParse({ currentTitle: 'EA' }).success,
    ).toBe(true);
  });
});

describe('ListCandidatesQuerySchema', () => {
  it('applies the default limit and parses filters', () => {
    const parsed = ListCandidatesQuerySchema.parse({
      country: 'Mexico',
      englishSpokenLevel: 'professional',
      maxAccentStrength: 'light',
      rateMax: '2500',
      rateUnit: 'monthly',
    });
    expect(parsed.limit).toBe(25);
    expect(parsed.rateMax).toBe(2500);
  });

  it('requires rateUnit when rateMax is present', () => {
    expect(ListCandidatesQuerySchema.safeParse({ rateMax: 100 }).success).toBe(
      false,
    );
  });

  it('splits comma-separated toolIds into uuids', () => {
    const a = '0e6bb251-9bb2-4b6e-b7b9-1d4f9f0d3f5f';
    const b = '3f8a2c94-1a7f-4c1e-9a5b-2b6c8d9e0f1a';
    const parsed = ListCandidatesQuerySchema.parse({ toolIds: `${a},${b}` });
    expect(parsed.toolIds).toEqual([a, b]);
    expect(
      ListCandidatesQuerySchema.safeParse({ toolIds: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('caps limit at 100', () => {
    expect(ListCandidatesQuerySchema.safeParse({ limit: 101 }).success).toBe(
      false,
    );
  });

  it('exposes the accent ordering none < light < moderate < heavy', () => {
    expect(ACCENT_STRENGTH_ORDER).toEqual(['none', 'light', 'moderate', 'heavy']);
  });
});

describe('file schemas (04 §8.1)', () => {
  it('validates an upload-url body', () => {
    expect(
      FileUploadUrlBodySchema.safeParse({
        fileType: 'cv',
        originalFilename: 'cv.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 1024,
      }).success,
    ).toBe(true);
    expect(
      FileUploadUrlBodySchema.safeParse({
        fileType: 'cv',
        originalFilename: '',
        mimeType: 'application/pdf',
        sizeBytes: 0,
      }).success,
    ).toBe(false);
  });

  it('file PATCH requires at least one field', () => {
    expect(UpdateCandidateFileBodySchema.safeParse({}).success).toBe(false);
    expect(
      UpdateCandidateFileBodySchema.safeParse({ isClientVisible: true }).success,
    ).toBe(true);
  });

  it('download URLs are valid for 300 seconds (AC-CA-05)', () => {
    expect(DOWNLOAD_URL_TTL_SECONDS).toBe(300);
  });
});

describe('child collection bodies', () => {
  it('tools PUT replaces the full set', () => {
    expect(
      PutCandidateToolsBodySchema.safeParse({ tools: [] }).success,
    ).toBe(true);
    expect(
      PutCandidateToolsBodySchema.safeParse({
        tools: [
          {
            toolId: '0e6bb251-9bb2-4b6e-b7b9-1d4f9f0d3f5f',
            proficiency: 'expert',
            yearsUsed: 3.5,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it('disqualifier checks constrain result values', () => {
    expect(
      PutDisqualifierChecksBodySchema.safeParse({
        checks: [
          {
            disqualifierId: '0e6bb251-9bb2-4b6e-b7b9-1d4f9f0d3f5f',
            result: 'maybe',
          },
        ],
      }).success,
    ).toBe(false);
  });
});

describe('consent body', () => {
  it('requires both fields', () => {
    expect(
      CandidateConsentBodySchema.safeParse({
        hasConsentToShareProfile: true,
        consentSource: 'signed form',
      }).success,
    ).toBe(true);
    expect(
      CandidateConsentBodySchema.safeParse({ hasConsentToShareProfile: true })
        .success,
    ).toBe(false);
  });
});

describe('webhook contracts (04 §8.2)', () => {
  it('accepts the documented payload', () => {
    expect(
      WebhookCandidateBodySchema.safeParse({
        externalId: 'src_9931',
        source: 'linkedin',
        firstName: 'Maria',
        lastName: 'Gomez',
        email: 'maria@example.com',
        englishSpokenLevel: 'professional',
        accentStrength: 'light',
        yearsExperienceTotal: 6,
        expectedRateAmount: 2200,
        expectedRateUnit: 'monthly',
        primaryRoleCategoryKey: 'executive_assistant',
        cvUrl: 'https://example.com/cv.pdf',
        raw: {},
      }).success,
    ).toBe(true);
  });

  it('requires firstName and lastName only', () => {
    expect(
      WebhookCandidateBodySchema.safeParse({ firstName: 'M', lastName: 'G' })
        .success,
    ).toBe(true);
    expect(
      WebhookCandidateBodySchema.safeParse({ firstName: 'M' }).success,
    ).toBe(false);
  });

  it('validates the response envelope', () => {
    expect(
      WebhookResponseSchema.safeParse({
        candidateReference: 'CAN-000123',
        result: 'created',
        dataCompleteness: 'incomplete',
        droppedFields: ['accentStrength'],
      }).success,
    ).toBe(true);
    expect(
      WebhookResponseSchema.safeParse({
        candidateReference: 'CAN-000123',
        result: 'duplicated',
        dataCompleteness: 'complete',
        droppedFields: [],
      }).success,
    ).toBe(false);
  });
});
