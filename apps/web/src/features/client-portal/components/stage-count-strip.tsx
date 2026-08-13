/**
 * Compact per-stage candidate counts for a requisition card, from the
 * dashboard's `stageCounts` (client_visible_assignments only — internal
 * stages are structurally absent). Keys absent = stage absent; zeroes are
 * never rendered.
 */
import type { ClientDashboardRequisition } from "@sdb/contracts";
import { daysSince } from "@/lib/format";
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
  sourcingSince,
}: {
  stageCounts: ClientDashboardRequisition["stageCounts"];
  /**
   * Momentum framing (UX 3.3): pass when the requisition is actively
   * sourcing so the empty line reads as progress, not silence. The instant
   * is sourcingStartedAt when the payload carries it, else submittedAt.
   */
  sourcingSince?: string;
}) {
  const entries = CLIENT_STAGE_ORDER.flatMap((stage) => {
    const count = stageCounts[stage];
    return count !== undefined && count > 0 ? [{ stage, count }] : [];
  });

  if (entries.length === 0) {
    if (sourcingSince !== undefined) {
      const day = daysSince(sourcingSince) + 1;
      return (
        <p className="text-xs text-neutral-600">
          We&rsquo;re sourcing candidates — day{" "}
          <span className="tabular-nums">{day}</span>. Typical first
          candidates within ~21 days.
        </p>
      );
    }
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
