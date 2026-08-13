/**
 * Client-facing presentation labels for the P5 portal (01 §3 J6, 01 §5).
 *
 * Clients see softer wording than the internal admin labels: the stage
 * values stay owned by @sdb/contracts, and the client-visible subset is
 * typed as ClientVisibleStage so an internal stage can never be labelled
 * here — a compile error, not a runtime surprise.
 *
 * Timezone helpers implement NFR-11: timestamps render in the VIEWING
 * user's timezone with an explicit zone label.
 */
import type { EntityEvent, RequisitionStatus } from "@sdb/contracts";
import type { ClientVisibleStage, GatedPiiField } from "@sdb/contracts";
import { humanizeKey } from "@/lib/format";

/** Ordered as a client experiences the journey. */
export const CLIENT_STAGE_ORDER: readonly ClientVisibleStage[] = [
  "presented",
  "client_reviewing",
  "interview_scheduled",
  "interviewed",
  "offer",
  "placed",
  "rejected_by_client",
  "closed_not_selected",
];

export const CLIENT_STAGE_LABELS: Record<ClientVisibleStage, string> = {
  presented: "Awaiting your review",
  client_reviewing: "Approved for interview",
  interview_scheduled: "Interview scheduled",
  interviewed: "Interviewed",
  offer: "Offer",
  placed: "Hired",
  rejected_by_client: "Declined by you",
  closed_not_selected: "Position filled",
};

/** Terminal, muted card states (01 §3 J6 / task spec). */
export function isMutedStage(stage: ClientVisibleStage): boolean {
  return stage === "rejected_by_client" || stage === "closed_not_selected";
}

/** Celebratory card states. */
export function isCelebratoryStage(stage: ClientVisibleStage): boolean {
  return stage === "offer" || stage === "placed";
}

/**
 * Client-facing requisition status labels — REQUISITION_STATUS_META wording
 * softened for the people whose hire it is (05 §2: no role branching inside
 * pages; the client tree simply uses this map instead).
 */
export const CLIENT_REQUISITION_STATUS_LABELS: Record<
  RequisitionStatus,
  string
> = {
  submitted: "Being reviewed",
  pending_principal_approval: "Awaiting brief approval",
  changes_requested: "Brief being revised",
  sourcing: "Sourcing candidates",
  candidates_presented: "Candidates ready for review",
  interviewing: "Interviewing",
  offer_extended: "Offer extended",
  placed: "Hired",
  on_hold: "On hold",
  closed_unfilled: "Closed",
};

/**
 * Client-language label for an event's from/to value (UX 3.3): requisition
 * statuses map through CLIENT_REQUISITION_STATUS_LABELS; anything else is
 * humanized — a raw enum value never reaches the page.
 */
export function clientValueLabel(value: string): string {
  const statusLabel = (
    CLIENT_REQUISITION_STATUS_LABELS as Partial<Record<string, string>>
  )[value];
  if (statusLabel !== undefined) return statusLabel;
  const stageLabel = (
    CLIENT_STAGE_LABELS as Partial<Record<string, string>>
  )[value];
  if (stageLabel !== undefined) return stageLabel;
  return humanizeKey(value);
}

/**
 * One human sentence for a dashboard feed event (UX 3.3/1.3): client
 * wording, no raw enum values, no event-type jargon.
 */
export function clientEventSentence(
  event: Pick<EntityEvent, "eventType" | "fromValue" | "toValue">,
): string {
  const from = event.fromValue !== null ? clientValueLabel(event.fromValue) : null;
  const to = event.toValue !== null ? clientValueLabel(event.toValue) : null;
  if (from !== null && to !== null) {
    return `Moved from ${from} to ${to}`;
  }
  if (to !== null) {
    return `Now ${to}`;
  }
  return humanizeKey(event.eventType);
}

/** Human labels for the gated fields, in GATED_PII_FIELDS order. */
export const GATED_FIELD_LABELS: Record<GatedPiiField, string> = {
  lastName: "Last name",
  email: "Email",
  phone: "Phone",
  whatsapp: "WhatsApp",
  linkedinUrl: "LinkedIn",
  currentEmployer: "Current employer",
};

// ---------------------------------------------------------------------------
// Viewer-timezone rendering (NFR-11)
// ---------------------------------------------------------------------------

/** The viewing user's IANA timezone, from the browser. */
export function viewerTimezone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

/**
 * "12 Aug 2026, 14:05" (browser locale) in the VIEWER's timezone. Pair with
 * `viewerTimezone()` for the explicit label NFR-11 requires. Locale is
 * deliberately undefined — the browser's own locale wins (UX 3.7).
 */
export function formatInViewerTimezone(iso: string): string {
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: viewerTimezone(),
  }).format(new Date(iso));
}
