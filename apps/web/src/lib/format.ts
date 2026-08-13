/**
 * Display formatting shared by the P2 admin surfaces: dates (absolute +
 * relative pairs for timelines), money, and human labels for contract enums.
 * All labels here are presentation-only — the contracts enums stay the
 * single source of truth for values.
 */
import { differenceInCalendarDays, format, formatDistanceToNow, parseISO } from "date-fns";
import type {
  EngagementType,
  RateUnit,
  SeniorityLevel,
  ServiceTier,
} from "@sdb/contracts";

/** "12 Aug 2026" — dense-table date. */
export function formatDate(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === "") return "—";
  return format(parseISO(iso), "d MMM yyyy");
}

/** "12 Aug 2026, 14:05" — for hover titles and event detail. */
export function formatDateTime(iso: string | null | undefined): string {
  if (iso === null || iso === undefined || iso === "") return "—";
  return format(parseISO(iso), "d MMM yyyy, HH:mm");
}

/** "3 days ago" — relative time for timelines. */
export function formatRelative(iso: string): string {
  return formatDistanceToNow(parseISO(iso), { addSuffix: true });
}

/** Whole days elapsed since the given instant (never negative). */
export function daysSince(iso: string): number {
  return Math.max(0, differenceInCalendarDays(new Date(), parseISO(iso)));
}

/** "$1,500–$2,500 / monthly" style budget line; null-safe on every part. */
export function formatBudget(args: {
  budgetMin: number | null;
  budgetMax: number | null;
  budgetCurrency: string | null;
  budgetUnit: RateUnit | null;
}): string {
  const { budgetMin, budgetMax, budgetCurrency, budgetUnit } = args;
  if (budgetMin === null && budgetMax === null) return "—";
  const currency = budgetCurrency ?? "";
  const amount = (value: number) =>
    `${currency ? `${currency} ` : ""}${value.toLocaleString("en-US")}`;
  const range =
    budgetMin !== null && budgetMax !== null && budgetMin !== budgetMax
      ? `${amount(budgetMin)}–${amount(budgetMax)}`
      : amount(budgetMin ?? budgetMax ?? 0);
  return budgetUnit === null ? range : `${range} / ${RATE_UNIT_LABELS[budgetUnit]}`;
}

// ---------------------------------------------------------------------------
// Structured money parts — the "instrument" treatment (amount emphasized,
// currency + unit as a muted suffix). The string formatters above remain for
// non-visual uses (plain text, aria labels, exports).
// ---------------------------------------------------------------------------

export interface MoneyParts {
  /** The emphasized tabular figure, e.g. "1,500–2,500". */
  amount: string;
  /** Muted suffix, e.g. "USD / month"; null when neither part exists. */
  suffix: string | null;
}

function moneySuffix(currency: string | null, unit: RateUnit | null): string | null {
  const parts = [
    ...(currency !== null && currency !== "" ? [currency] : []),
    ...(unit !== null ? [`/ ${RATE_UNIT_LABELS[unit]}`] : []),
  ];
  return parts.length === 0 ? null : parts.join(" ");
}

/** Structured variant of formatBudget; null when no amount exists. */
export function budgetParts(args: {
  budgetMin: number | null;
  budgetMax: number | null;
  budgetCurrency: string | null;
  budgetUnit: RateUnit | null;
}): MoneyParts | null {
  const { budgetMin, budgetMax, budgetCurrency, budgetUnit } = args;
  if (budgetMin === null && budgetMax === null) return null;
  const figure = (value: number) => value.toLocaleString("en-US");
  const amount =
    budgetMin !== null && budgetMax !== null && budgetMin !== budgetMax
      ? `${figure(budgetMin)}–${figure(budgetMax)}`
      : figure(budgetMin ?? budgetMax ?? 0);
  return { amount, suffix: moneySuffix(budgetCurrency, budgetUnit) };
}

/** Structured variant of formatRate; null when no amount exists. */
export function rateParts(
  amount: number | null,
  unit: RateUnit | null,
  currency: string | null,
): MoneyParts | null {
  if (amount === null) return null;
  return {
    amount: amount.toLocaleString("en-US"),
    suffix: moneySuffix(currency, unit),
  };
}

/** "team_size_band" → "Team size band" for snapshot/category keys. */
export function humanizeKey(key: string): string {
  const spaced = key.replace(/[_-]+/g, " ").trim();
  return spaced.length === 0
    ? key
    : spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

export const SERVICE_TIER_LABELS: Record<ServiceTier, string> = {
  standard_placement: "Standard placement",
  handheld_six_month: "Handheld (6 months)",
};

export const SENIORITY_LABELS: Record<SeniorityLevel, string> = {
  junior: "Junior",
  mid: "Mid",
  senior: "Senior",
  lead: "Lead",
};

export const ENGAGEMENT_LABELS: Record<EngagementType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  project: "Project",
};

export const RATE_UNIT_LABELS: Record<RateUnit, string> = {
  hourly: "hour",
  monthly: "month",
};
