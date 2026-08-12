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
import type { RequisitionStatus } from "@sdb/contracts";
import type { ClientVisibleStage, GatedPiiField } from "@sdb/contracts";

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
 * "12 Aug 2026, 14:05" in the VIEWER's timezone. Pair with
 * `viewerTimezone()` for the explicit label NFR-11 requires.
 */
export function formatInViewerTimezone(iso: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: viewerTimezone(),
  }).format(new Date(iso));
}
