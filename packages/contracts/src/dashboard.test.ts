import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  ATTENTION_QUEUE_BUCKET_KEYS,
  AdminStatsSchema,
  AttentionQueueQuerySchema,
  AttentionQueueSchema,
  ClientDashboardSchema,
  ListEventsQuerySchema,
  RejectionReasonsQuerySchema,
  RejectionReasonsReportSchema,
} from './dashboard.js';

const uuid = () => randomUUID();
const now = new Date().toISOString();

describe('ClientDashboardSchema', () => {
  it('accepts a populated dashboard', () => {
    const parsed = ClientDashboardSchema.parse({
      requisitions: [
        {
          id: uuid(),
          publicId: 'lSbqRVXPbTmC',
          reference: 'REQ-000001',
          advertisedTitle: 'Executive Assistant',
          status: 'candidates_presented',
          submittedAt: now,
          updatedAt: now,
          stageCounts: { presented: 2, client_reviewing: 1 },
        },
      ],
      pendingActions: {
        principalApprovals: [
          {
            requisitionId: uuid(),
            reference: 'REQ-000002',
            advertisedTitle: null,
            since: now,
          },
        ],
        candidatesAwaitingReview: [
          {
            assignmentId: uuid(),
            requisitionId: uuid(),
            requisitionReference: 'REQ-000001',
            displayName: 'Maria G.',
            presentedAt: now,
          },
        ],
      },
      recentEvents: [
        {
          id: uuid(),
          entityType: 'requisition',
          entityId: uuid(),
          eventType: 'status_changed',
          actorId: null,
          actorName: 'Ana Admin',
          actorRole: null,
          fromValue: 'sourcing',
          toValue: 'candidates_presented',
          metadata: {},
          occurredAt: now,
          requisitionReference: 'REQ-000001',
          requisitionTitle: 'Executive Assistant',
        },
      ],
    });
    expect(parsed.requisitions[0]?.stageCounts.presented).toBe(2);
    expect(parsed.recentEvents[0]?.requisitionReference).toBe('REQ-000001');
    expect(parsed.recentEvents[0]?.actorName).toBe('Ana Admin');
  });

  it('rejects internal stages in stageCounts — the client summary is view-shaped', () => {
    const result = ClientDashboardSchema.safeParse({
      requisitions: [
        {
          id: uuid(),
          publicId: 'lSbqRVXPbTmC',
          reference: 'REQ-000001',
          advertisedTitle: null,
          status: 'sourcing',
          submittedAt: now,
          updatedAt: now,
          stageCounts: { sourced: 3 },
        },
      ],
      pendingActions: { principalApprovals: [], candidatesAwaitingReview: [] },
      recentEvents: [],
    });
    expect(result.success).toBe(false);
  });
});

describe('AttentionQueueSchema', () => {
  const bucket = (key: string) => ({
    key,
    label: 'Label',
    count: 1,
    items: [
      {
        entityType: 'requisition',
        entityId: uuid(),
        reference: 'REQ-000001',
        label: 'REQ-000001 — Executive Assistant',
        since: now,
      },
    ],
  });

  it('items accept an optional requisitionId deep-link (UX 1.7)', () => {
    const withLink = {
      computedAt: now,
      buckets: ATTENTION_QUEUE_BUCKET_KEYS.map((key) =>
        key === 'awaiting_client_feedback'
          ? {
              ...bucket(key),
              items: [
                {
                  entityType: 'assignment',
                  entityId: uuid(),
                  requisitionId: uuid(),
                  reference: 'REQ-000001',
                  label: 'Maria G. — REQ-000001',
                  since: now,
                },
              ],
            }
          : bucket(key),
      ),
    };
    const parsed = AttentionQueueSchema.parse(withLink);
    const item = parsed.buckets[4]?.items[0];
    expect(item?.requisitionId).toBeDefined();
    // requisition-typed items omit the key entirely
    expect(parsed.buckets[0]?.items[0]?.requisitionId).toBeUndefined();
  });

  it('the seven bucket keys match docs/01 §6 in order', () => {
    expect(ATTENTION_QUEUE_BUCKET_KEYS).toEqual([
      'new_intake_submissions',
      'awaiting_principal_approval',
      'payment_confirmed_access_not_granted',
      'no_candidates_presented',
      'awaiting_client_feedback',
      'interview_without_outcome',
      'incomplete_webhook_candidates',
    ]);
  });

  it('accepts exactly seven buckets and rejects six or an unknown key', () => {
    const seven = ATTENTION_QUEUE_BUCKET_KEYS.map(bucket);
    expect(
      AttentionQueueSchema.parse({ computedAt: now, buckets: seven }).buckets,
    ).toHaveLength(7);
    expect(
      AttentionQueueSchema.safeParse({
        computedAt: now,
        buckets: seven.slice(0, 6),
      }).success,
    ).toBe(false);
    expect(
      AttentionQueueSchema.safeParse({
        computedAt: now,
        buckets: [...seven.slice(0, 6), bucket('everything_is_fine')],
      }).success,
    ).toBe(false);
  });

  it('query: refresh coerces query-string booleans', () => {
    expect(AttentionQueueQuerySchema.parse({ refresh: 'true' }).refresh).toBe(
      true,
    );
    expect(AttentionQueueQuerySchema.parse({ refresh: 'false' }).refresh).toBe(
      false,
    );
    expect(AttentionQueueQuerySchema.parse({}).refresh).toBeUndefined();
  });
});

describe('AdminStatsSchema', () => {
  it('accepts stats with a partial by-stage record and null average', () => {
    const parsed = AdminStatsSchema.parse({
      openRequisitions: 4,
      candidatesByStage: { sourced: 2, presented: 1 },
      averageDaysToPresent: null,
      activePlacements: 1,
    });
    expect(parsed.candidatesByStage.sourced).toBe(2);
  });

  it('rejects a negative average and an unknown stage key', () => {
    expect(
      AdminStatsSchema.safeParse({
        openRequisitions: 0,
        candidatesByStage: {},
        averageDaysToPresent: -1,
        activePlacements: 0,
      }).success,
    ).toBe(false);
    expect(
      AdminStatsSchema.safeParse({
        openRequisitions: 0,
        candidatesByStage: { limbo: 1 },
        averageDaysToPresent: null,
        activePlacements: 0,
      }).success,
    ).toBe(false);
  });
});

describe('RejectionReasons report contracts', () => {
  it('query requires from and to; actor and roleCategoryId optional', () => {
    expect(RejectionReasonsQuerySchema.safeParse({}).success).toBe(false);
    const parsed = RejectionReasonsQuerySchema.parse({
      from: now,
      to: now,
      actor: 'client',
    });
    expect(parsed.actor).toBe('client');
    expect(parsed.roleCategoryId).toBeUndefined();
  });

  it('report rows carry the other-texts list', () => {
    const parsed = RejectionReasonsReportSchema.parse({
      from: now,
      to: now,
      actor: null,
      roleCategoryId: null,
      totalCount: 3,
      rows: [
        {
          actor: 'client',
          reasonId: uuid(),
          reasonKey: 'culture_fit',
          label: 'Culture fit',
          count: 2,
          otherTexts: [],
        },
        {
          actor: 'client',
          reasonId: null,
          reasonKey: 'other',
          label: 'Other (free text)',
          count: 1,
          otherTexts: ['Too expensive'],
        },
      ],
    });
    expect(parsed.rows[1]?.otherTexts).toEqual(['Too expensive']);
  });
});

describe('ListEventsQuerySchema', () => {
  it('defaults limit to 25 and caps at 100', () => {
    expect(ListEventsQuerySchema.parse({}).limit).toBe(25);
    expect(ListEventsQuerySchema.safeParse({ limit: '101' }).success).toBe(
      false,
    );
    expect(ListEventsQuerySchema.parse({ limit: '100' }).limit).toBe(100);
  });

  it('accepts the documented filters', () => {
    const parsed = ListEventsQuerySchema.parse({
      entityType: 'assignment',
      entityId: uuid(),
      eventType: 'stage_changed',
      actorId: uuid(),
      from: now,
      to: now,
      cursor: 'abc',
    });
    expect(parsed.entityType).toBe('assignment');
  });

  it('rejects a malformed entityId', () => {
    expect(
      ListEventsQuerySchema.safeParse({ entityId: 'not-a-uuid' }).success,
    ).toBe(false);
  });
});
