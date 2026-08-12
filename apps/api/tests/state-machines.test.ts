/**
 * Full adjacency check of both state machines: every valid transition returns
 * true, every other from→to pair returns false, and terminal states have no
 * outbound transitions (docs/06-BACKEND.md §2.2, docs/01 §4–§5).
 */
import { describe, expect, it } from 'vitest';
import {
  AssignmentStageSchema,
  RequisitionStatusSchema,
  type AssignmentStage,
  type RequisitionStatus,
} from '@sdb/contracts';
import {
  ASSIGNMENT_TRANSITIONS,
  REQUISITION_TRANSITIONS,
  canTransition,
} from '../src/services/state-machines.js';

const ALL_STATUSES = RequisitionStatusSchema.options;
const ALL_STAGES = AssignmentStageSchema.options;

// Expected adjacency, restated independently of the implementation.
const EXPECTED_REQUISITION: Record<RequisitionStatus, RequisitionStatus[]> = {
  submitted: ['pending_principal_approval', 'on_hold', 'closed_unfilled'],
  pending_principal_approval: [
    'sourcing',
    'changes_requested',
    'on_hold',
    'closed_unfilled',
  ],
  changes_requested: ['pending_principal_approval', 'on_hold', 'closed_unfilled'],
  sourcing: ['candidates_presented', 'on_hold', 'closed_unfilled'],
  candidates_presented: ['interviewing', 'sourcing', 'on_hold', 'closed_unfilled'],
  interviewing: [
    'offer_extended',
    'candidates_presented',
    'on_hold',
    'closed_unfilled',
  ],
  offer_extended: ['placed', 'interviewing', 'on_hold', 'closed_unfilled'],
  placed: [],
  on_hold: ['sourcing', 'candidates_presented', 'interviewing', 'closed_unfilled'],
  closed_unfilled: [],
};

const NON_TERMINAL_STAGES: AssignmentStage[] = [
  'sourced',
  'screened',
  'vetted',
  'presented',
  'client_reviewing',
  'interview_scheduled',
  'interviewed',
  'offer',
];

const HAPPY_PATH_NEXT: Partial<Record<AssignmentStage, AssignmentStage>> = {
  sourced: 'screened',
  screened: 'vetted',
  vetted: 'presented',
  presented: 'client_reviewing',
  client_reviewing: 'interview_scheduled',
  interview_scheduled: 'interviewed',
  interviewed: 'offer',
  offer: 'placed',
};

const REJECTED_BY_CLIENT_FROM: AssignmentStage[] = [
  'presented',
  'client_reviewing',
  'interviewed',
];

function expectedAssignmentTargets(from: AssignmentStage): AssignmentStage[] {
  if (!NON_TERMINAL_STAGES.includes(from)) return [];
  const targets: AssignmentStage[] = [];
  const next = HAPPY_PATH_NEXT[from];
  if (next !== undefined) targets.push(next);
  targets.push('rejected_by_admin'); // any non-terminal stage
  if (REJECTED_BY_CLIENT_FROM.includes(from)) targets.push('rejected_by_client');
  targets.push('withdrawn'); // any non-terminal stage
  targets.push('closed_not_selected'); // placement flow closes siblings
  return targets;
}

describe('REQUISITION_TRANSITIONS', () => {
  it('matches 06 §2.2 exactly for every from→to pair', () => {
    for (const from of ALL_STATUSES) {
      for (const to of ALL_STATUSES) {
        const expected = EXPECTED_REQUISITION[from].includes(to);
        expect(
          canTransition(REQUISITION_TRANSITIONS, from, to),
          `${from} → ${to}`,
        ).toBe(expected);
      }
    }
  });

  it('placed and closed_unfilled have no outbound transitions', () => {
    expect(REQUISITION_TRANSITIONS.placed).toEqual([]);
    expect(REQUISITION_TRANSITIONS.closed_unfilled).toEqual([]);
  });

  it('covers every requisition status as a key', () => {
    expect(Object.keys(REQUISITION_TRANSITIONS).sort()).toEqual(
      [...ALL_STATUSES].sort(),
    );
  });
});

describe('ASSIGNMENT_TRANSITIONS', () => {
  it('matches the 01 §5 stage machine for every from→to pair', () => {
    for (const from of ALL_STAGES) {
      const expectedTargets = expectedAssignmentTargets(from);
      for (const to of ALL_STAGES) {
        expect(
          canTransition(ASSIGNMENT_TRANSITIONS, from, to),
          `${from} → ${to}`,
        ).toBe(expectedTargets.includes(to));
      }
    }
  });

  it('all terminal stages have no outbound transitions', () => {
    for (const terminal of [
      'placed',
      'rejected_by_admin',
      'rejected_by_client',
      'withdrawn',
      'closed_not_selected',
    ] as AssignmentStage[]) {
      expect(ASSIGNMENT_TRANSITIONS[terminal]).toEqual([]);
    }
  });

  it('covers every assignment stage as a key', () => {
    expect(Object.keys(ASSIGNMENT_TRANSITIONS).sort()).toEqual(
      [...ALL_STAGES].sort(),
    );
  });

  it('no self-transitions anywhere', () => {
    for (const from of ALL_STAGES) {
      expect(canTransition(ASSIGNMENT_TRANSITIONS, from, from)).toBe(false);
    }
  });
});
