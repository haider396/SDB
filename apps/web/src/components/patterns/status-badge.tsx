/**
 * Stage/status badge per 05-FRONTEND.md §3.6. Colour maps to SEMANTIC tokens,
 * never brand tokens, and every badge carries text as well as colour
 * (AC-UI-03). Stage names come from the shared contracts enum.
 */
import type {
  AssignmentStage,
  ClientStatus,
  RequisitionStatus,
} from "@sdb/contracts";
import { cn } from "@/lib/utils";

type StageGroup = "internal" | "presented" | "interview" | "offer" | "terminal";

const STAGE_META: Record<AssignmentStage, { label: string; group: StageGroup }> = {
  sourced: { label: "Sourced", group: "internal" },
  screened: { label: "Screened", group: "internal" },
  vetted: { label: "Vetted", group: "internal" },
  presented: { label: "Presented", group: "presented" },
  client_reviewing: { label: "Client reviewing", group: "presented" },
  interview_scheduled: { label: "Interview scheduled", group: "interview" },
  interviewed: { label: "Interviewed", group: "interview" },
  offer: { label: "Offer", group: "offer" },
  placed: { label: "Placed", group: "offer" },
  rejected_by_admin: { label: "Rejected by admin", group: "terminal" },
  rejected_by_client: { label: "Rejected by client", group: "terminal" },
  withdrawn: { label: "Withdrawn", group: "terminal" },
  closed_not_selected: { label: "Not selected", group: "terminal" },
};

const GROUP_CLASSES: Record<StageGroup, string> = {
  internal: "text-neutral-600 bg-neutral-100",
  presented: "text-info bg-info-subtle",
  interview: "text-warning-text bg-warning-subtle",
  offer: "text-success-text bg-success-subtle",
  terminal: "text-danger-text bg-danger-subtle",
};

export interface StatusBadgeProps {
  stage: AssignmentStage;
  className?: string;
}

export function StatusBadge({ stage, className }: StatusBadgeProps) {
  const meta = STAGE_META[stage];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        GROUP_CLASSES[meta.group],
        className,
      )}
    >
      {meta.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Requisition status badge (01 §4 state machine)
// ---------------------------------------------------------------------------

export const REQUISITION_STATUS_META: Record<
  RequisitionStatus,
  { label: string; group: StageGroup }
> = {
  submitted: { label: "Submitted", group: "internal" },
  pending_principal_approval: {
    label: "Pending principal approval",
    group: "interview",
  },
  changes_requested: { label: "Changes requested", group: "interview" },
  sourcing: { label: "Sourcing", group: "presented" },
  candidates_presented: { label: "Candidates presented", group: "presented" },
  interviewing: { label: "Interviewing", group: "presented" },
  offer_extended: { label: "Offer extended", group: "offer" },
  placed: { label: "Placed", group: "offer" },
  on_hold: { label: "On hold", group: "internal" },
  closed_unfilled: { label: "Closed unfilled", group: "terminal" },
};

export function RequisitionStatusBadge({
  status,
  className,
}: {
  status: RequisitionStatus;
  className?: string;
}) {
  const meta = REQUISITION_STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        GROUP_CLASSES[meta.group],
        className,
      )}
    >
      {meta.label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Client status badge (client lifecycle enum)
// ---------------------------------------------------------------------------

const CLIENT_STATUS_META: Record<
  ClientStatus,
  { label: string; group: StageGroup }
> = {
  prospect: { label: "Prospect", group: "internal" },
  active: { label: "Active", group: "offer" },
  inactive: { label: "Inactive", group: "interview" },
  archived: { label: "Archived", group: "terminal" },
};

export function ClientStatusBadge({
  status,
  className,
}: {
  status: ClientStatus;
  className?: string;
}) {
  const meta = CLIENT_STATUS_META[status];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        GROUP_CLASSES[meta.group],
        className,
      )}
    >
      {meta.label}
    </span>
  );
}
