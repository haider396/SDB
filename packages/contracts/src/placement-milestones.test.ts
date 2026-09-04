/**
 * Post-hire milestone maths (T31). Both portals render from this, so a bug
 * here shows a client one window and an admin another.
 */
import { describe, expect, it } from 'vitest';
import {
  GUARANTEE_PERIOD_DAYS,
  defaultGuaranteeEndDate,
  milestoneLabel,
  placementMilestone,
} from './placement-milestones.js';

const START = '2026-01-01';

describe('placementMilestone', () => {
  it('is day 0 in the first window on the start date itself', () => {
    const m = placementMilestone(START, '2026-01-01');
    expect(m.daysElapsed).toBe(0);
    expect(m.currentMilestone).toBe(30);
    expect(m.isGuaranteeElapsed).toBe(false);
  });

  it('stays in the 30-day window up to and including day 29', () => {
    expect(placementMilestone(START, '2026-01-30').daysElapsed).toBe(29);
    expect(placementMilestone(START, '2026-01-30').currentMilestone).toBe(30);
  });

  it('moves to the 60-day window on day 30 exactly', () => {
    const m = placementMilestone(START, '2026-01-31');
    expect(m.daysElapsed).toBe(30);
    expect(m.currentMilestone).toBe(60);
  });

  it('moves to the 90-day window on day 60 exactly', () => {
    const m = placementMilestone(START, '2026-03-02'); // 60 days after Jan 1
    expect(m.daysElapsed).toBe(60);
    expect(m.currentMilestone).toBe(90);
  });

  it('marks the guarantee elapsed on day 90, not day 91', () => {
    const day89 = placementMilestone(START, '2026-03-31');
    const day90 = placementMilestone(START, '2026-04-01');
    expect(day89.daysElapsed).toBe(89);
    expect(day89.isGuaranteeElapsed).toBe(false);
    expect(day90.daysElapsed).toBe(90);
    expect(day90.isGuaranteeElapsed).toBe(true);
    expect(day90.currentMilestone).toBeNull();
  });

  it('counts down the days remaining and floors at zero', () => {
    expect(placementMilestone(START, '2026-01-01').daysRemaining).toBe(90);
    expect(placementMilestone(START, '2026-01-31').daysRemaining).toBe(60);
    expect(placementMilestone(START, '2026-04-01').daysRemaining).toBe(0);
    // Long past the window — never negative.
    expect(placementMilestone(START, '2027-01-01').daysRemaining).toBe(0);
  });

  it('never reports negative elapsed days for a future start date', () => {
    const m = placementMilestone('2026-06-01', '2026-01-01');
    expect(m.daysElapsed).toBe(0);
    expect(m.currentMilestone).toBe(30);
  });

  it('computes the guarantee end date as start + 90 days', () => {
    expect(placementMilestone(START, START).guaranteeEndDate).toBe('2026-04-01');
  });

  it('is timezone-stable — a time-of-day difference cannot shift the day', () => {
    const morning = placementMilestone(START, new Date('2026-01-31T00:30:00Z'));
    const evening = placementMilestone(START, new Date('2026-01-31T23:30:00Z'));
    expect(morning.daysElapsed).toBe(evening.daysElapsed);
    expect(morning.currentMilestone).toBe(evening.currentMilestone);
  });

  it('accepts a full ISO timestamp as the start date', () => {
    const m = placementMilestone('2026-01-01T14:22:00.000Z', '2026-01-31');
    expect(m.daysElapsed).toBe(30);
  });
});

describe('defaultGuaranteeEndDate', () => {
  it('is the start date plus the guarantee period', () => {
    expect(GUARANTEE_PERIOD_DAYS).toBe(90);
    expect(defaultGuaranteeEndDate('2026-01-01')).toBe('2026-04-01');
  });

  it('agrees with what placementMilestone reports', () => {
    expect(defaultGuaranteeEndDate('2026-08-10')).toBe(
      placementMilestone('2026-08-10', '2026-08-10').guaranteeEndDate,
    );
  });

  it('matches the 90 days already used by the dev seed', () => {
    // dev_seed places a candidate starting 2026-08-10 with guarantee 2026-11-08.
    expect(defaultGuaranteeEndDate('2026-08-10')).toBe('2026-11-08');
  });
});

describe('milestoneLabel', () => {
  it('names each window', () => {
    expect(milestoneLabel(placementMilestone(START, '2026-01-01'))).toBe(
      'First 30 days',
    );
    expect(milestoneLabel(placementMilestone(START, '2026-01-31'))).toBe(
      'Day 30–60',
    );
    expect(milestoneLabel(placementMilestone(START, '2026-03-02'))).toBe(
      'Day 60–90',
    );
    expect(milestoneLabel(placementMilestone(START, '2026-04-01'))).toBe(
      'Guarantee complete',
    );
  });
});
