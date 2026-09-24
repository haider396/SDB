/**
 * Presentation labels for the notification log. Values stay owned by the
 * contracts enums (06 §4.1 event table).
 */
import type { NotificationEvent, NotificationStatus } from "@sdb/contracts";

export const NOTIFICATION_EVENT_LABELS: Record<NotificationEvent, string> = {
  intake_submitted: "Intake submitted",
  portal_invitation: "Portal invitation",
  principal_approval_requested: "Approver sign-off requested",
  candidates_presented: "Candidates presented",
  client_decision_recorded: "Client decision recorded",
  interview_scheduled: "Interview scheduled",
  requisition_status_changed: "Placement status changed",
};

export const NOTIFICATION_STATUS_LABELS: Record<NotificationStatus, string> = {
  queued: "Queued",
  sent: "Sent",
  failed: "Failed",
};
