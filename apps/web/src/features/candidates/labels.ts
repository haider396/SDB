/**
 * Presentation labels for the candidate enums (docs/02-DATABASE.md §2/§8).
 * Values stay owned by @sdb/contracts; these are display-only strings, plus
 * the country → flag-emoji helper used by the list and rail.
 */
import type {
  AccentStrength,
  AutonomyLevel,
  CandidateFileType,
  CandidateSource,
  DataCompleteness,
  EmploymentStatus,
  LanguageLevel,
  PoolStatus,
  ProficiencyLevel,
  RateUnit,
  SalesBackgroundWeight,
  SubmissionChannel,
  VettingStatus,
  WorkspaceType,
} from "@sdb/contracts";

export const LANGUAGE_LEVEL_LABELS: Record<LanguageLevel, string> = {
  basic: "Basic",
  conversational: "Conversational",
  professional: "Professional",
  native_equivalent: "Native-equivalent",
};

export const ACCENT_LABELS: Record<AccentStrength, string> = {
  none: "No accent",
  light: "Light accent",
  moderate: "Moderate accent",
  heavy: "Heavy accent",
};

export const PROFICIENCY_LABELS: Record<ProficiencyLevel, string> = {
  aware: "Aware",
  working: "Working",
  proficient: "Proficient",
  expert: "Expert",
};

export const POOL_STATUS_LABELS: Record<PoolStatus, string> = {
  active: "Active",
  passive: "Passive",
  placed: "Placed",
  unavailable: "Unavailable",
  do_not_use: "Do not use",
};

export const VETTING_STATUS_LABELS: Record<VettingStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  passed: "Passed",
  failed: "Failed",
};

export const EMPLOYMENT_STATUS_LABELS: Record<EmploymentStatus, string> = {
  employed: "Employed",
  available: "Available",
  serving_notice: "Serving notice",
};

export const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  needs_direction: "Needs direction",
  balanced: "Balanced",
  fully_autonomous: "Fully autonomous",
};

export const WORKSPACE_LABELS: Record<WorkspaceType, string> = {
  dedicated_home_office: "Dedicated home office",
  shared_space: "Shared space",
  coworking: "Coworking",
  unknown: "Unknown",
};

export const SALES_WEIGHT_LABELS: Record<SalesBackgroundWeight, string> = {
  none: "None",
  light: "Light",
  moderate: "Moderate",
  heavy: "Heavy",
};

export const CANDIDATE_SOURCE_LABELS: Record<CandidateSource, string> = {
  linkedin: "LinkedIn",
  upwork: "Upwork",
  referral: "Referral",
  partner_recruiter: "Partner recruiter",
  inbound: "Inbound",
  webhook: "Webhook",
  import: "Import",
  other: "Other",
};

export const SUBMISSION_CHANNEL_LABELS: Record<SubmissionChannel, string> = {
  manual: "Manual",
  webhook: "Webhook",
  csv_import: "CSV import",
};

export const FILE_TYPE_LABELS: Record<CandidateFileType, string> = {
  cv: "CV",
  photo: "Photo",
  video_intro: "Video intro",
  voice_sample: "Voice sample",
  writing_sample: "Writing sample",
  portfolio: "Portfolio",
  certificate: "Certificate",
  assessment_report: "Assessment report",
  speedtest: "Speed test",
  other: "Other",
};

export const DATA_COMPLETENESS_LABELS: Record<DataCompleteness, string> = {
  complete: "Complete",
  incomplete: "Incomplete",
};

/** "USD 1,200 / month" — null-safe on every part. */
export function formatRate(
  amount: number | null,
  unit: RateUnit | null,
  currency: string | null,
): string {
  if (amount === null) return "—";
  const RATE_UNIT_SUFFIX: Record<RateUnit, string> = {
    hourly: "hour",
    monthly: "month",
  };
  const money = `${currency !== null ? `${currency} ` : ""}${amount.toLocaleString("en-US")}`;
  return unit === null ? money : `${money} / ${RATE_UNIT_SUFFIX[unit]}`;
}

/** "1.2 MB" for the files card. */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Country → flag emoji. `country` is free text (02 §8.1), so this maps the
// common names in the pool plus raw ISO-3166 alpha-2 codes; anything
// unrecognised simply renders without a flag.
// ---------------------------------------------------------------------------

const COUNTRY_ISO: Record<string, string> = {
  argentina: "AR",
  australia: "AU",
  bangladesh: "BD",
  bolivia: "BO",
  brazil: "BR",
  canada: "CA",
  chile: "CL",
  china: "CN",
  colombia: "CO",
  "costa rica": "CR",
  "dominican republic": "DO",
  ecuador: "EC",
  egypt: "EG",
  "el salvador": "SV",
  france: "FR",
  germany: "DE",
  ghana: "GH",
  guatemala: "GT",
  honduras: "HN",
  india: "IN",
  indonesia: "ID",
  ireland: "IE",
  italy: "IT",
  jamaica: "JM",
  japan: "JP",
  kenya: "KE",
  malaysia: "MY",
  mexico: "MX",
  morocco: "MA",
  netherlands: "NL",
  "new zealand": "NZ",
  nicaragua: "NI",
  nigeria: "NG",
  pakistan: "PK",
  panama: "PA",
  paraguay: "PY",
  peru: "PE",
  philippines: "PH",
  poland: "PL",
  portugal: "PT",
  romania: "RO",
  serbia: "RS",
  singapore: "SG",
  "south africa": "ZA",
  spain: "ES",
  "sri lanka": "LK",
  thailand: "TH",
  turkey: "TR",
  ukraine: "UA",
  "united arab emirates": "AE",
  "united kingdom": "GB",
  uk: "GB",
  "united states": "US",
  usa: "US",
  uruguay: "UY",
  venezuela: "VE",
  vietnam: "VN",
};

/**
 * Display-cased country names backing the country filter's datalist
 * (free text stays allowed — the map is a convenience, not a constraint).
 */
export const COUNTRY_NAMES: readonly string[] = Object.keys(COUNTRY_ISO)
  .filter((name) => name.length > 2 || name === "uk")
  .map((name) =>
    name === "uk"
      ? "United Kingdom"
      : name === "usa"
        ? "United States"
        : name.replace(/\b[a-z]/g, (letter) => letter.toUpperCase()),
  )
  .filter((name, index, all) => all.indexOf(name) === index)
  .sort();

const REGIONAL_INDICATOR_OFFSET = 0x1f1e6 - "A".charCodeAt(0);

export function countryFlag(country: string | null): string | null {
  if (country === null) return null;
  const trimmed = country.trim();
  const iso =
    /^[A-Za-z]{2}$/.test(trimmed) && trimmed.toLowerCase() !== "uk"
      ? trimmed.toUpperCase()
      : COUNTRY_ISO[trimmed.toLowerCase()];
  if (iso === undefined) return null;
  return String.fromCodePoint(
    ...[...iso].map((letter) => letter.charCodeAt(0) + REGIONAL_INDICATOR_OFFSET),
  );
}
