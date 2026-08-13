import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  AdvanceBodySchema,
  AssignmentSchema,
  ClientVisibleAssignmentSchema,
  ClientVisibleStageSchema,
  CreateAssignmentsBodySchema,
  PlaceBodySchema,
  PlacementSchema,
  PresentBodySchema,
  RejectBodySchema,
  UpdateAssignmentBodySchema,
  UpdatePlacementBodySchema,
} from './assignments.js';
import { AssignmentStageSchema } from './enums.js';
import { CLIENT_VISIBLE_STAGES, GATED_PII_FIELDS } from './stages.js';

const uuid = () => randomUUID();
const now = new Date().toISOString();

function baseAssignment() {
  return {
    id: uuid(),
    requisitionId: uuid(),
    candidateId: uuid(),
    stage: 'sourced',
    presentedAt: null,
    clientDecisionAt: null,
    assignedBy: uuid(),
    presentedBy: null,
    adminNote: null,
    clientNote: null,
    sortOrder: 0,
    createdAt: now,
    updatedAt: now,
  };
}

/** A view row at `presented`: every gated field null, per the SQL view. */
function presentedViewRow() {
  return {
    assignmentId: uuid(),
    requisitionId: uuid(),
    stage: 'presented',
    presentedAt: now,
    clientNote: 'Strong fit',
    clientId: uuid(),
    candidateId: uuid(),
    reference: 'CAN-000001',
    displayName: 'Maria G.',
    photoPath: null,
    photoUrl: null,
    country: 'Mexico',
    regionState: null,
    city: null,
    timezone: 'America/Mexico_City',
    englishSpokenLevel: 'professional',
    englishWrittenLevel: 'professional',
    accentStrength: 'light',
    yearsExperienceTotal: 6,
    yearsExperienceRelevant: 4,
    currentTitle: 'Executive Assistant',
    seniorityLevel: 'senior',
    hasManagementExperience: true,
    teamSizeManaged: 3,
    hasClientFacingExperience: true,
    hasUsClientExperience: true,
    remoteExperienceYears: 5,
    availableFrom: '2026-09-01',
    engagementTypes: ['full_time'],
    hoursAvailablePerWeek: 40,
    overlapStart: '09:00',
    overlapEnd: '17:00',
    overlapTimezone: 'America/Chicago',
    autonomy: 'fully_autonomous',
    canManageUp: true,
    recruiterRecommendation: 'Recommend strongly',
    strengths: 'Detail, follow-through',
    interviewRequestedAt: null,
    rejectionReasonLabel: null,
    rejectionDetail: null,
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    whatsapp: null,
    linkedinUrl: null,
    currentEmployer: null,
    files: [],
  };
}

describe('AssignmentSchema', () => {
  it('parses a full row', () => {
    expect(AssignmentSchema.safeParse(baseAssignment()).success).toBe(true);
  });
});

describe('ClientVisibleAssignmentSchema — the P5 client contract', () => {
  it('parses a presented row with all seven gated fields null', () => {
    expect(
      ClientVisibleAssignmentSchema.safeParse(presentedViewRow()).success,
    ).toBe(true);
  });

  it('parses an interview_scheduled row with gated PII populated', () => {
    const row = {
      ...presentedViewRow(),
      stage: 'interview_scheduled',
      firstName: 'Maria',
      lastName: 'Gomez',
      email: 'maria@example.com',
      phone: '+52 55 0000 0000',
      whatsapp: '+52 55 0000 0001',
      linkedinUrl: 'https://linkedin.com/in/mariag',
      currentEmployer: 'Employer Inc',
      files: [
        {
          id: uuid(),
          fileType: 'cv',
          originalFilename: 'cv.pdf',
          mimeType: 'application/pdf',
          sizeBytes: 12345,
        },
      ],
    };
    expect(ClientVisibleAssignmentSchema.safeParse(row).success).toBe(true);
  });

  it('every GATED_PII_FIELD plus firstName is nullable in the schema', () => {
    const gated = [...GATED_PII_FIELDS, 'firstName'] as const;
    for (const field of gated) {
      const row = { ...presentedViewRow(), [field]: null };
      expect(
        ClientVisibleAssignmentSchema.safeParse(row).success,
        `${field} must accept null`,
      ).toBe(true);
    }
  });

  it('carries client decision state (UX 3.2): interviewRequestedAt and rejection fields', () => {
    const rejected = {
      ...presentedViewRow(),
      stage: 'rejected_by_client',
      interviewRequestedAt: now,
      rejectionReasonLabel: 'Rate too high',
      rejectionDetail: 'Outside budget',
    };
    const parsed = ClientVisibleAssignmentSchema.parse(rejected);
    expect(parsed.rejectionReasonLabel).toBe('Rate too high');
    expect(parsed.rejectionDetail).toBe('Outside budget');
    expect(parsed.interviewRequestedAt).toBe(now);
  });

  it('rejects the five internal stages (sourced/screened/vetted/rejected_by_admin/withdrawn)', () => {
    const internal = AssignmentStageSchema.options.filter(
      (stage) =>
        !(CLIENT_VISIBLE_STAGES as readonly string[]).includes(stage),
    );
    expect(internal).toEqual([
      'sourced',
      'screened',
      'vetted',
      'rejected_by_admin',
      'withdrawn',
    ]);
    for (const stage of internal) {
      expect(
        ClientVisibleAssignmentSchema.safeParse({
          ...presentedViewRow(),
          stage,
        }).success,
        `${stage} must never be client-visible`,
      ).toBe(false);
    }
  });

  it('ClientVisibleStageSchema matches CLIENT_VISIBLE_STAGES exactly', () => {
    expect(ClientVisibleStageSchema.options).toEqual([
      ...CLIENT_VISIBLE_STAGES,
    ]);
  });

  it('never exposes internal assignment fields (adminNote, assignedBy)', () => {
    const shape = ClientVisibleAssignmentSchema.shape;
    expect(shape).not.toHaveProperty('adminNote');
    expect(shape).not.toHaveProperty('assignedBy');
    expect(shape).not.toHaveProperty('presentedBy');
  });
});

describe('CreateAssignmentsBodySchema', () => {
  it('requires at least one candidateId', () => {
    expect(
      CreateAssignmentsBodySchema.safeParse({ candidateIds: [] }).success,
    ).toBe(false);
    expect(
      CreateAssignmentsBodySchema.safeParse({ candidateIds: [uuid()] }).success,
    ).toBe(true);
  });
});

describe('AdvanceBodySchema', () => {
  it('requires a valid stage', () => {
    expect(AdvanceBodySchema.safeParse({ toStage: 'vetted' }).success).toBe(true);
    expect(AdvanceBodySchema.safeParse({ toStage: 'nonsense' }).success).toBe(false);
  });
});

describe('UpdateAssignmentBodySchema', () => {
  it('rejects an empty body', () => {
    expect(UpdateAssignmentBodySchema.safeParse({}).success).toBe(false);
  });
  it('accepts sortOrder alone', () => {
    expect(UpdateAssignmentBodySchema.safeParse({ sortOrder: 3 }).success).toBe(true);
  });
});

describe('PresentBodySchema', () => {
  it('requires at least one assignmentId', () => {
    expect(PresentBodySchema.safeParse({ assignmentIds: [] }).success).toBe(false);
    expect(
      PresentBodySchema.safeParse({ assignmentIds: [uuid()], clientNote: 'hi' })
        .success,
    ).toBe(true);
  });
});

describe('RejectBodySchema — actor is never accepted from the body (AC-PL-09)', () => {
  it('strips a spoofed actor key', () => {
    const parsed = RejectBodySchema.parse({
      reasonOther: 'not a fit',
      actor: 'admin',
      rejectedBy: uuid(),
    } as Record<string, unknown>);
    expect(parsed).not.toHaveProperty('actor');
    expect(parsed).not.toHaveProperty('rejectedBy');
  });

  it('accepts reasonId-only, reasonOther-only, and both-empty bodies (constraint enforced by API+DB, not schema)', () => {
    expect(RejectBodySchema.safeParse({ reasonId: uuid() }).success).toBe(true);
    expect(RejectBodySchema.safeParse({ reasonOther: 'x' }).success).toBe(true);
    // The schema permits {}; the API returns 422 VALIDATION_FAILED so the
    // stored-vs-validated rule stays in one place (AC-PL-11).
    expect(RejectBodySchema.safeParse({}).success).toBe(true);
  });
});

describe('PlaceBodySchema / PlacementSchema', () => {
  it('requires startDate', () => {
    expect(PlaceBodySchema.safeParse({}).success).toBe(false);
    expect(PlaceBodySchema.safeParse({ startDate: '2026-09-01' }).success).toBe(true);
  });

  it('accepts full commercial terms', () => {
    expect(
      PlaceBodySchema.safeParse({
        startDate: '2026-09-01',
        endDate: null,
        rateAmount: 2500,
        rateUnit: 'monthly',
        rateCurrency: 'USD',
        hoursPerWeek: 40,
        serviceTier: 'handheld_six_month',
        guaranteeEndDate: '2027-03-01',
      }).success,
    ).toBe(true);
  });

  it('parses a placement row', () => {
    expect(
      PlacementSchema.safeParse({
        id: uuid(),
        assignmentId: uuid(),
        candidateId: uuid(),
        clientId: uuid(),
        requisitionId: uuid(),
        startDate: '2026-09-01',
        endDate: null,
        rateAmount: 2500,
        rateUnit: 'monthly',
        rateCurrency: 'USD',
        hoursPerWeek: 40,
        serviceTier: 'standard_placement',
        guaranteeEndDate: null,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }).success,
    ).toBe(true);
  });

  it('UpdatePlacementBodySchema rejects an empty body', () => {
    expect(UpdatePlacementBodySchema.safeParse({}).success).toBe(false);
    expect(
      UpdatePlacementBodySchema.safeParse({ status: 'completed' }).success,
    ).toBe(true);
  });
});
