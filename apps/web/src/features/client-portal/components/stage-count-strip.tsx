/**
 * Compact per-stage candidate counts for a requisition card, from the
 * dashboard's `stageCounts` (client_visible_assignments only — internal
 * stages are structurally absent). Keys absent = stage absent; zeroes are
 * never rendered.
 */
import type { ClientDashboardRequisition } from "@sdb/contracts";
import { CLIENT_STAGE_ORDER, CLIENT_STAGE_LABELS } from "../labels";

export function totalCandidates(
  stageCounts: ClientDashboardRequisition["stageCounts"],
): number {
  return Object.values(stageCounts).reduce<number>(
    (sum, count) => sum + (count ?? 0),
    0,
  );
}

export function StageCountStrip({
  stageCounts,
}: {
  stageCounts: ClientDashboardRequisition["stageCounts"];
}) {
  const entries = CLIENT_STAGE_ORDER.flatMap((stage) => {
    const count = stageCounts[stage];
    return count !== undefined && count > 0 ? [{ stage, count }] : [];
  });

  if (entries.length === 0) {
    return (
      <p className="text-xs text-neutral-500">No candidates presented yet</p>
    );
  }

  return (
    <ul aria-label="Candidates by stage" className="flex flex-wrap gap-1.5">
      {entries.map(({ stage, count }) => (
        <li
          key={stage}
          className="inline-flex items-center gap-1 rounded-full bg-surface-subtle px-2 py-0.5 text-[11px] font-medium text-neutral-600"
        >
          <span className="tabular-nums text-brand-navy-ink">{count}</span>
          {CLIENT_STAGE_LABELS[stage]}
        </li>
      ))}
    </ul>
  );
}
