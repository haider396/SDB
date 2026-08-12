import { describe, expect, it } from 'vitest';
import {
  ListNotificationsQuerySchema,
  NotificationLogRowSchema,
  NotificationPayloadSchema,
  NotificationStatusSchema,
  ResendResponseSchema,
} from './notifications.js';

const validPayload = {
  event: 'candidates_presented',
  recipient: {
    email: 'client@example.com',
    firstName: 'Ada',
    lastName: 'Lovelace',
    userId: 'f8b2c9c4-0d6e-4bfb-9a3c-2f6de1c1a111',
  },
  context: {
    clientName: 'Acme Inc.',
    requisitionReference: 'REQ-000123',
    roleTitle: 'Executive Assistant',
    candidateCount: 3,
    actionUrl: 'https://portal.example.com/requisitions/REQ-000123',
    actorName: 'Rebecca Kallaus',
  },
  sentAt: '2026-08-12T09:14:22.000Z',
  notificationLogId: 'a3e7c8d2-5f1b-4e9a-8c7d-1b2a3c4d5e6f',
};

describe('NotificationStatusSchema', () => {
  it('matches the notification_log.status domain exactly', () => {
    expect(NotificationStatusSchema.options).toEqual(['queued', 'sent', 'failed']);
  });

  it('rejects unknown statuses', () => {
    expect(NotificationStatusSchema.safeParse('dispatching').success).toBe(false);
  });
});

describe('NotificationPayloadSchema (06 §4.1)', () => {
  it('accepts the documented payload shape', () => {
    expect(NotificationPayloadSchema.safeParse(validPayload).success).toBe(true);
  });

  it('requires every documented context merge field, allowing null', () => {
    const nulled = {
      ...validPayload,
      context: {
        clientName: null,
        requisitionReference: null,
        roleTitle: null,
        candidateCount: null,
        actionUrl: null,
        actorName: null,
      },
    };
    expect(NotificationPayloadSchema.safeParse(nulled).success).toBe(true);

    const partialContext: Partial<typeof nulled.context> = { ...nulled.context };
    delete partialContext.clientName;
    expect(
      NotificationPayloadSchema.safeParse({ ...validPayload, context: partialContext })
        .success,
    ).toBe(false);
  });

  it('passes event-specific context extras through', () => {
    const extra = {
      ...validPayload,
      event: 'client_decision_recorded',
      context: { ...validPayload.context, decision: 'approved_for_interview' },
    };
    const parsed = NotificationPayloadSchema.parse(extra);
    expect(parsed.context['decision']).toBe('approved_for_interview');
  });

  it('accepts sentAt null (queued shape) and rejects a non-uuid log id', () => {
    expect(
      NotificationPayloadSchema.safeParse({ ...validPayload, sentAt: null }).success,
    ).toBe(true);
    expect(
      NotificationPayloadSchema.safeParse({
        ...validPayload,
        notificationLogId: 'not-a-uuid',
      }).success,
    ).toBe(false);
  });

  it('rejects events outside the seven MVP notification events', () => {
    expect(
      NotificationPayloadSchema.safeParse({ ...validPayload, event: 'welcome_email' })
        .success,
    ).toBe(false);
  });
});

describe('NotificationLogRowSchema', () => {
  const row = {
    id: 'a3e7c8d2-5f1b-4e9a-8c7d-1b2a3c4d5e6f',
    event: 'intake_submitted',
    recipientEmail: 'admin@example.com',
    recipientUserId: null,
    entityType: 'requisition',
    entityId: 'f8b2c9c4-0d6e-4bfb-9a3c-2f6de1c1a111',
    payload: { event: 'intake_submitted' },
    provider: 'gohighlevel',
    providerResponse: null,
    status: 'queued',
    attempts: 0,
    lastError: null,
    createdAt: '2026-08-12T09:14:22.000Z',
    sentAt: null,
  };

  it('accepts a queued row and a sent row', () => {
    expect(NotificationLogRowSchema.safeParse(row).success).toBe(true);
    expect(
      NotificationLogRowSchema.safeParse({
        ...row,
        status: 'sent',
        attempts: 1,
        providerResponse: { attemptedAt: row.createdAt, httpStatus: 200 },
        sentAt: '2026-08-12T09:14:23.000Z',
      }).success,
    ).toBe(true);
  });

  it('rejects negative attempts and unknown status', () => {
    expect(NotificationLogRowSchema.safeParse({ ...row, attempts: -1 }).success).toBe(
      false,
    );
    expect(
      NotificationLogRowSchema.safeParse({ ...row, status: 'pending' }).success,
    ).toBe(false);
  });
});

describe('ListNotificationsQuerySchema', () => {
  it('defaults limit to 25 and caps at 100', () => {
    expect(ListNotificationsQuerySchema.parse({})).toEqual({ limit: 25 });
    expect(ListNotificationsQuerySchema.safeParse({ limit: '101' }).success).toBe(
      false,
    );
  });

  it('coerces string limits and accepts status/event/cursor filters', () => {
    const parsed = ListNotificationsQuerySchema.parse({
      limit: '10',
      status: 'failed',
      event: 'portal_invitation',
      cursor: 'abc',
    });
    expect(parsed).toEqual({
      limit: 10,
      status: 'failed',
      event: 'portal_invitation',
      cursor: 'abc',
    });
  });

  it('rejects unknown filter values', () => {
    expect(ListNotificationsQuerySchema.safeParse({ status: 'nope' }).success).toBe(
      false,
    );
    expect(ListNotificationsQuerySchema.safeParse({ event: 'nope' }).success).toBe(
      false,
    );
  });
});

describe('ResendResponseSchema', () => {
  it('is the notification log row shape', () => {
    expect(ResendResponseSchema).toBe(NotificationLogRowSchema);
  });
});
