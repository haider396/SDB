/**
 * A position's priority, as SDB ranked it.
 *
 * Rebecca, 13 Aug — Haider: *"Priority matters."* Rebecca: *"Priority
 * definitely matters. Priority would need to be seen on the card, preview
 * card."*
 *
 * ── `normal` renders NOTHING ───────────────────────────────────────────────
 * Not a grey "Normal" chip — nothing at all. `normal` is the default, so most
 * positions carry it; a chip on three quarters of a list stops meaning
 * anything, and the two that say "Urgent" stop standing out. Absence is the
 * signal, which is why this returns null rather than leaving the decision to
 * each call site to remember.
 *
 * ⚠ This is SDB's own ranking and the client can see it (her decision), so the
 * wording is customer-facing. It is deliberately NOT `requisitions.urgency` —
 * that is the client's own stated timeline from their intake answer. See
 * migration 0030 for why the two are separate fields.
 */
import { isNotablePriority, type RequisitionPriority } from "@sdb/contracts";
import { Chip, type ChipProps } from "@/components/ui/chip";

const PRIORITY_LABELS: Record<RequisitionPriority, string> = {
  urgent: "Urgent",
  high: "High priority",
  normal: "Normal",
  low: "Low priority",
};

/**
 * Only `urgent` gets the alarming tone. If "high" were also red, the two would
 * compete and neither would read as the top of the list.
 */
const PRIORITY_TONES: Record<RequisitionPriority, ChipProps["tone"]> = {
  urgent: "danger",
  high: "warning",
  normal: "neutral",
  low: "neutral",
};

export function PriorityChip({
  priority,
  size,
}: {
  priority: RequisitionPriority;
  size?: ChipProps["size"];
}) {
  if (!isNotablePriority(priority)) return null;
  return (
    <Chip tone={PRIORITY_TONES[priority]} size={size}>
      {PRIORITY_LABELS[priority]}
    </Chip>
  );
}

/** The full label, for surfaces that must show every value — e.g. an editor. */
export function priorityLabel(priority: RequisitionPriority): string {
  return PRIORITY_LABELS[priority];
}
