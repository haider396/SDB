/**
 * Post-hire milestone tracking (docs/CHANGE-REQUESTS-2026-08-13.md T31).
 *
 * Rebecca, 13 Aug:
 *   37:34 — "under hire, let's have it automatically say like first 30-day
 *            period, 60-day, 90-day, because until the 90 days has passed,
 *            that position is technically like in a trial period."
 *   37:35 — "as a staffing company, we give a 90-day guarantee."
 *   37:53 — "that progress bar will be for the client, but it's also
 *            something that would need to be inside of our pipelines as well."
 *   38:10 — "Once they're post 90 days, it's closed."
 *
 * Confirmed 90 days (not the 12-month figure in README's appendix) by Haider
 * on 28 Aug; the dev seed already used 90.
 *
 * The maths lives here rather than in either app because BOTH sides render it
 * — the client's progress bar and the admin's pipeline view must never
 * disagree about which window a placement is in.
 */
import { z } from 'zod';

/** The guarantee window. A placement is "in trial" until this many days pass. */
export const GUARANTEE_PERIOD_DAYS = 90;

/** Milestones shown on the progress bar, in order. */
export const PLACEMENT_MILESTONE_DAYS = [30, 60, 90] as const;

export type PlacementMilestoneDay = (typeof PLACEMENT_MILESTONE_DAYS)[number];

export const PlacementMilestoneSchema = z.object({
  /** Whole days elapsed since the start date. Never negative. */
  daysElapsed: z.number().int().min(0),
  /**
   * The window the placement is currently IN — 30 means "within the first 30
   * days", 60 means "past 30, within 60", 90 means "past 60, within 90".
   * null once the guarantee has elapsed.
   */
  currentMilestone: z.union([z.literal(30), z.literal(60), z.literal(90)]).nullable(),
  /** Days until the guarantee ends. 0 once elapsed. */
  daysRemaining: z.number().int().min(0),
  /** True once the guarantee window has passed — the placement can close. */
  isGuaranteeElapsed: z.boolean(),
  /** ISO date the guarantee ends (start + GUARANTEE_PERIOD_DAYS). */
  guaranteeEndDate: z.string(),
});
export type PlacementMilestone = z.infer<typeof PlacementMilestoneSchema>;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Midnight UTC for a `YYYY-MM-DD` string or Date, so day maths is exact. */
function toUtcDay(value: string | Date): number {
  const date = typeof value === 'string' ? new Date(`${value.slice(0, 10)}T00:00:00Z`) : value;
  return Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
  );
}

function isoDate(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/**
 * Where a placement sits in its guarantee window.
 *
 * Dates are compared at whole-day UTC granularity: a placement that started
 * today is on day 0, not "some hours in". Timezones would otherwise let the
 * same placement report different milestones to a client in Mexico City and
 * an admin in Karachi.
 */
export function placementMilestone(
  startDate: string | Date,
  today: string | Date = new Date(),
): PlacementMilestone {
  const start = toUtcDay(startDate);
  const now = toUtcDay(today);
  const daysElapsed = Math.max(0, Math.floor((now - start) / MS_PER_DAY));

  const currentMilestone =
    PLACEMENT_MILESTONE_DAYS.find((day) => daysElapsed < day) ?? null;

  const daysRemaining = Math.max(0, GUARANTEE_PERIOD_DAYS - daysElapsed);

  return {
    daysElapsed,
    currentMilestone,
    daysRemaining,
    isGuaranteeElapsed: daysElapsed >= GUARANTEE_PERIOD_DAYS,
    guaranteeEndDate: isoDate(start + GUARANTEE_PERIOD_DAYS * MS_PER_DAY),
  };
}

/**
 * The guarantee end date a placement should get when none was supplied.
 * `placements.guarantee_end_date` is nullable and the create path defaulted it
 * to null, which left nothing for the milestone view to work from.
 */
export function defaultGuaranteeEndDate(startDate: string | Date): string {
  return isoDate(toUtcDay(startDate) + GUARANTEE_PERIOD_DAYS * MS_PER_DAY);
}

/**
 * The slice of a placement a CLIENT may see (T31). Deliberately minimal:
 * dates and status only — no rate, no fee, nothing commercial. The client
 * needs to know where their hire sits in the guarantee, not what it cost.
 */
export const ClientPlacementSchema = z.object({
  startDate: z.string(),
  guaranteeEndDate: z.string().nullable(),
  /** 'active' while the guarantee runs; 'completed' once it has elapsed. */
  status: z.enum([
    'active',
    'ended_by_client',
    'ended_by_candidate',
    'completed',
  ]),
});
export type ClientPlacement = z.infer<typeof ClientPlacementSchema>;

/** Human label for a milestone window, shared by both portals. */
export function milestoneLabel(milestone: PlacementMilestone): string {
  if (milestone.isGuaranteeElapsed) return 'Guarantee complete';
  switch (milestone.currentMilestone) {
    case 30:
      return 'First 30 days';
    case 60:
      return 'Day 30–60';
    case 90:
      return 'Day 60–90';
    default:
      return 'Guarantee complete';
  }
}
