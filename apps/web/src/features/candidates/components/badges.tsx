/**
 * Candidate-specific badges + the field visibility chips. Badges follow the
 * shared status-badge conventions: semantic tokens only, text always carried
 * alongside colour (AC-UI-03).
 */
import { Eye, EyeOff, Lock } from "lucide-react";
import type { DataCompleteness, PoolStatus, VettingStatus } from "@sdb/contracts";
import { cn } from "@/lib/utils";
import {
  DATA_COMPLETENESS_LABELS,
  POOL_STATUS_LABELS,
  VETTING_STATUS_LABELS,
} from "../labels";
import type { FieldVisibility } from "../visibility";

const BADGE_BASE =
  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium";

const POOL_CLASSES: Record<PoolStatus, string> = {
  active: "text-success-text bg-success-subtle",
  passive: "text-info bg-info-subtle",
  placed: "text-neutral-600 bg-neutral-100",
  unavailable: "text-warning-text bg-warning-subtle",
  do_not_use: "text-danger-text bg-danger-subtle",
};

export function PoolStatusBadge({
  status,
  className,
}: {
  status: PoolStatus;
  className?: string;
}) {
  return (
    <span className={cn(BADGE_BASE, POOL_CLASSES[status], className)}>
      {POOL_STATUS_LABELS[status]}
    </span>
  );
}

const VETTING_CLASSES: Record<VettingStatus, string> = {
  not_started: "text-neutral-600 bg-neutral-100",
  in_progress: "text-info bg-info-subtle",
  passed: "text-success-text bg-success-subtle",
  failed: "text-danger-text bg-danger-subtle",
};

export function VettingStatusBadge({
  status,
  className,
}: {
  status: VettingStatus;
  className?: string;
}) {
  return (
    <span className={cn(BADGE_BASE, VETTING_CLASSES[status], className)}>
      {VETTING_STATUS_LABELS[status]}
    </span>
  );
}

/**
 * Data-completeness marker: incomplete records get a warning badge
 * (webhook-sourced rows with dropped fields); complete stays quiet text.
 */
export function DataCompletenessBadge({
  completeness,
}: {
  completeness: DataCompleteness;
}) {
  if (completeness === "complete") {
    return (
      <span className="text-xs text-neutral-500">
        {DATA_COMPLETENESS_LABELS.complete}
      </span>
    );
  }
  return (
    <span className={cn(BADGE_BASE, "bg-warning-subtle text-warning-text")}>
      {DATA_COMPLETENESS_LABELS.incomplete}
    </span>
  );
}

/**
 * Field visibility chips (02 §11 model): shown wherever a field's visibility
 * differs from its section's dominant visibility, so the admin always knows
 * what the client can see.
 */
export function VisibilityChip({ visibility }: { visibility: FieldVisibility }) {
  if (visibility === "gated") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-info-subtle px-1.5 py-0.5 text-2xs font-medium text-info"
        title="Clients see this only once an interview is scheduled"
      >
        <Lock aria-hidden="true" className="h-3 w-3" />
        Gated until interview
      </span>
    );
  }
  if (visibility === "internal") {
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-neutral-100 px-1.5 py-0.5 text-2xs font-medium text-neutral-600"
        title="Never shown to clients"
      >
        <EyeOff aria-hidden="true" className="h-3 w-3" />
        Internal
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-success-subtle px-1.5 py-0.5 text-2xs font-medium text-success-text"
      title="Shown to clients from the presented stage"
    >
      <Eye aria-hidden="true" className="h-3 w-3" />
      Client-visible
    </span>
  );
}
