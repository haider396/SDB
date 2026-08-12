/**
 * Presentation labels for the pipeline feature. Stage values stay owned by
 * @sdb/contracts; these are display-only strings matching the StatusBadge
 * wording (components/patterns/status-badge.tsx).
 */
import type { AssignmentStage, InterviewOutcome } from "@sdb/contracts";

export const STAGE_LABELS: Record<AssignmentStage, string> = {
  sourced: "Sourced",
  screened: "Screened",
  vetted: "Vetted",
  presented: "Presented",
  client_reviewing: "Client reviewing",
  interview_scheduled: "Interview scheduled",
  interviewed: "Interviewed",
  offer: "Offer",
  placed: "Placed",
  rejected_by_admin: "Rejected by admin",
  rejected_by_client: "Rejected by client",
  withdrawn: "Withdrawn",
  closed_not_selected: "Not selected",
};

export const OUTCOME_LABELS: Record<InterviewOutcome, string> = {
  pending: "Pending",
  passed: "Passed",
  failed: "Failed",
  no_show: "No-show",
  rescheduled: "Rescheduled",
  cancelled: "Cancelled",
};
