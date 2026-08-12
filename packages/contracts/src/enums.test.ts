import { describe, expect, it } from 'vitest';
import {
  AssignmentStageSchema,
  RequisitionStatusSchema,
  UserRoleKeySchema,
  NotificationEventSchema,
} from './enums.js';
import { CLIENT_VISIBLE_STAGES, PII_UNLOCKED_STAGES } from './stages.js';
import { PERMISSION_KEYS } from './permissions.js';

describe('RequisitionStatusSchema', () => {
  it('matches the SQL requisition_status enum exactly, in order', () => {
    expect(RequisitionStatusSchema.options).toEqual([
      'submitted',
      'pending_principal_approval',
      'changes_requested',
      'sourcing',
      'candidates_presented',
      'interviewing',
      'offer_extended',
      'placed',
      'on_hold',
      'closed_unfilled',
    ]);
  });

  it('rejects values not in the SQL enum', () => {
    expect(RequisitionStatusSchema.safeParse('open').success).toBe(false);
    expect(RequisitionStatusSchema.safeParse('SUBMITTED').success).toBe(false);
  });
});

describe('AssignmentStageSchema', () => {
  it('matches the SQL assignment_stage enum exactly, in order', () => {
    expect(AssignmentStageSchema.options).toEqual([
      'sourced',
      'screened',
      'vetted',
      'presented',
      'client_reviewing',
      'interview_scheduled',
      'interviewed',
      'offer',
      'placed',
      'rejected_by_admin',
      'rejected_by_client',
      'withdrawn',
      'closed_not_selected',
    ]);
  });

  it('rejects values not in the SQL enum', () => {
    expect(AssignmentStageSchema.safeParse('shortlisted').success).toBe(false);
  });
});

describe('stage visibility constants', () => {
  it('CLIENT_VISIBLE_STAGES matches 01-PRODUCT-OVERVIEW §5 verbatim', () => {
    expect(CLIENT_VISIBLE_STAGES).toEqual([
      'presented',
      'client_reviewing',
      'interview_scheduled',
      'interviewed',
      'offer',
      'placed',
      'rejected_by_client',
      'closed_not_selected',
    ]);
  });

  it('PII_UNLOCKED_STAGES matches 01-PRODUCT-OVERVIEW §5 verbatim', () => {
    expect(PII_UNLOCKED_STAGES).toEqual([
      'interview_scheduled',
      'interviewed',
      'offer',
      'placed',
    ]);
  });

  it('never exposes rejected_by_admin or withdrawn to clients', () => {
    expect(CLIENT_VISIBLE_STAGES).not.toContain('rejected_by_admin');
    expect(CLIENT_VISIBLE_STAGES).not.toContain('withdrawn');
  });

  it('every visibility stage is a valid assignment stage', () => {
    for (const stage of [...CLIENT_VISIBLE_STAGES, ...PII_UNLOCKED_STAGES]) {
      expect(AssignmentStageSchema.safeParse(stage).success).toBe(true);
    }
  });
});

describe('other enums (spot checks)', () => {
  it('user_role_key values', () => {
    expect(UserRoleKeySchema.options).toEqual([
      'super_admin',
      'admin',
      'client_admin',
      'client_user',
    ]);
  });

  it('notification_event values', () => {
    expect(NotificationEventSchema.options).toEqual([
      'intake_submitted',
      'portal_invitation',
      'principal_approval_requested',
      'candidates_presented',
      'client_decision_recorded',
      'interview_scheduled',
      'requisition_status_changed',
    ]);
  });

  it('permission keys are the 29 seeded keys with no duplicates', () => {
    expect(PERMISSION_KEYS).toHaveLength(29);
    expect(new Set(PERMISSION_KEYS).size).toBe(PERMISSION_KEYS.length);
    expect(PERMISSION_KEYS[0]).toBe('client.view');
    expect(PERMISSION_KEYS[PERMISSION_KEYS.length - 1]).toBe('event.view');
  });
});
