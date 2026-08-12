import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  CreateInterviewBodySchema,
  InterviewSchema,
  OutcomeBodySchema,
  RecordableOutcomeSchema,
  UpdateInterviewBodySchema,
} from './interviews.js';
import { InterviewOutcomeSchema } from './enums.js';

const uuid = () => randomUUID();
const now = new Date().toISOString();

function baseInterview() {
  return {
    id: uuid(),
    assignmentId: uuid(),
    roundNumber: 1,
    scheduledAt: now,
    timezone: 'America/Mexico_City',
    durationMinutes: 45,
    meetingUrl: 'https://meet.example.com/abc',
    interviewerNames: 'Rebecca K, Founder',
    requestedBy: null,
    createdBy: uuid(),
    outcome: 'pending',
    outcomeNotes: null,
    outcomeRecordedBy: null,
    outcomeRecordedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}

describe('InterviewSchema', () => {
  it('accepts a full row', () => {
    expect(InterviewSchema.parse(baseInterview())).toMatchObject({
      roundNumber: 1,
      outcome: 'pending',
    });
  });

  it('accepts a recorded outcome with recorder fields', () => {
    const parsed = InterviewSchema.parse({
      ...baseInterview(),
      outcome: 'passed',
      outcomeNotes: 'Great fit',
      outcomeRecordedBy: uuid(),
      outcomeRecordedAt: now,
    });
    expect(parsed.outcome).toBe('passed');
  });

  it('rejects an unknown outcome and a zero round', () => {
    expect(
      InterviewSchema.safeParse({ ...baseInterview(), outcome: 'ghosted' })
        .success,
    ).toBe(false);
    expect(
      InterviewSchema.safeParse({ ...baseInterview(), roundNumber: 0 }).success,
    ).toBe(false);
  });
});

describe('CreateInterviewBodySchema', () => {
  it('requires scheduledAt and timezone', () => {
    expect(
      CreateInterviewBodySchema.safeParse({ timezone: 'UTC' }).success,
    ).toBe(false);
    expect(
      CreateInterviewBodySchema.safeParse({ scheduledAt: now }).success,
    ).toBe(false);
    const parsed = CreateInterviewBodySchema.parse({
      scheduledAt: now,
      timezone: 'UTC',
    });
    expect(parsed.roundNumber).toBeUndefined();
  });

  it('accepts the full optional set and strips unknown keys', () => {
    const parsed = CreateInterviewBodySchema.parse({
      scheduledAt: now,
      timezone: 'America/New_York',
      durationMinutes: 30,
      meetingUrl: 'https://zoom.example/xyz',
      interviewerNames: 'A, B',
      roundNumber: 2,
      // A spoofed outcome must be discarded at the boundary.
      outcome: 'passed',
    });
    expect(parsed.roundNumber).toBe(2);
    expect('outcome' in parsed).toBe(false);
  });

  it('rejects a non-ISO scheduledAt', () => {
    expect(
      CreateInterviewBodySchema.safeParse({
        scheduledAt: 'tomorrow 3pm',
        timezone: 'UTC',
      }).success,
    ).toBe(false);
  });
});

describe('UpdateInterviewBodySchema', () => {
  it('rejects an empty patch', () => {
    expect(UpdateInterviewBodySchema.safeParse({}).success).toBe(false);
  });

  it('accepts nullable clears on optional schedule fields', () => {
    const parsed = UpdateInterviewBodySchema.parse({
      meetingUrl: null,
      durationMinutes: null,
    });
    expect(parsed.meetingUrl).toBeNull();
  });

  it('has no outcome fields — outcome goes through its own endpoint', () => {
    const parsed = UpdateInterviewBodySchema.parse({
      scheduledAt: now,
      outcome: 'passed',
    });
    expect('outcome' in parsed).toBe(false);
  });
});

describe('OutcomeBodySchema', () => {
  it('accepts every recordable outcome', () => {
    for (const outcome of RecordableOutcomeSchema.options) {
      expect(OutcomeBodySchema.parse({ outcome }).outcome).toBe(outcome);
    }
  });

  it('rejects pending and cancelled — not recordable outcomes', () => {
    expect(OutcomeBodySchema.safeParse({ outcome: 'pending' }).success).toBe(
      false,
    );
    expect(OutcomeBodySchema.safeParse({ outcome: 'cancelled' }).success).toBe(
      false,
    );
  });

  it('recordable = full enum minus pending and cancelled', () => {
    expect([...RecordableOutcomeSchema.options].sort()).toEqual(
      InterviewOutcomeSchema.options
        .filter((value) => value !== 'pending' && value !== 'cancelled')
        .sort(),
    );
  });
});
