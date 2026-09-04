/**
 * Post-hire guarantee progress (T31). Shared by BOTH portals.
 *
 * Rebecca, 37:34: "under hire, let's have it automatically say like first
 * 30-day period, 60-day, 90-day, because until the 90 days has passed, that
 * position is technically like in a trial period."
 * 37:53: "that progress bar will be for the client, but it's also something
 * that would need to be inside of our pipelines as well."
 *
 * Rendered identically on the client's position page and the admin's — an
 * admin looking at one filled position is asking the same question the client
 * is ("how is this hire doing?"), so they should not get a different answer or
 * a different-looking answer. The admin stats page answers the OTHER question,
 * "how many placements are in each window", with counts.
 *
 * Two densities, one source of truth:
 *   - `compact` for the client dashboard card (a single line)
 *   - full for either portal's position page (30/60/90 markers + a bar)
 *
 * The milestone is computed by `placementMilestone` from @sdb/contracts — the
 * same function the API's bucket query mirrors — so a client can never be
 * shown a different day count than an admin.
 *
 * Tone is deliberately reassuring: it says how far through the guarantee the
 * hire is, not "days until we stop covering you".
 */
import { ShieldCheck } from "lucide-react";
import type { ClientPlacement } from "@sdb/contracts";
import {
  GUARANTEE_PERIOD_DAYS,
  PLACEMENT_MILESTONE_DAYS,
  milestoneLabel,
  placementMilestone,
} from "@sdb/contracts";
import { cn } from "@/lib/utils";

export function GuaranteeProgress({
  placement,
  compact = false,
}: {
  placement: ClientPlacement;
  compact?: boolean;
}) {
  // A hire that ended early is not "in its guarantee" any more; showing a
  // progress bar for it would be misleading.
  if (placement.status === "ended_by_client" || placement.status === "ended_by_candidate") {
    return null;
  }

  const milestone = placementMilestone(placement.startDate);
  const percent = Math.min(
    100,
    Math.round((milestone.daysElapsed / GUARANTEE_PERIOD_DAYS) * 100),
  );

  if (compact) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-neutral-600">
        <ShieldCheck aria-hidden="true" className="h-3.5 w-3.5 text-success-text" />
        {milestone.isGuaranteeElapsed ? (
          <span>Guarantee complete</span>
        ) : (
          <span>
            {milestoneLabel(milestone)} ·{" "}
            <span className="tabular-nums">{milestone.daysRemaining}</span> days
            of cover left
          </span>
        )}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-medium text-brand-navy-ink">
          <ShieldCheck aria-hidden="true" className="h-4 w-4 text-success-text" />
          {milestone.isGuaranteeElapsed
            ? "Guarantee complete"
            : `${GUARANTEE_PERIOD_DAYS}-day guarantee`}
        </p>
        <p className="text-xs tabular-nums text-neutral-500">
          {milestone.isGuaranteeElapsed
            ? `Ended ${placement.guaranteeEndDate ?? milestone.guaranteeEndDate}`
            : `Day ${milestone.daysElapsed} of ${GUARANTEE_PERIOD_DAYS}`}
        </p>
      </div>

      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={GUARANTEE_PERIOD_DAYS}
        aria-valuenow={milestone.daysElapsed}
        aria-label={`Post-hire guarantee: day ${milestone.daysElapsed} of ${GUARANTEE_PERIOD_DAYS}`}
        className="h-2 w-full overflow-hidden rounded-full bg-neutral-200"
      >
        <div
          // Width is genuinely dynamic — the one case 05 §3.5 allows an inline
          // style rather than a class.
          style={{ width: `${percent}%` }}
          className="h-full rounded-full bg-gradient-progress motion-safe:transition-[width] motion-safe:duration-slow"
        />
      </div>

      <ol className="flex justify-between text-2xs">
        {PLACEMENT_MILESTONE_DAYS.map((day) => {
          const reached = milestone.daysElapsed >= day;
          const isCurrent = milestone.currentMilestone === day;
          return (
            <li
              key={day}
              className={cn(
                "tabular-nums",
                reached
                  ? "font-medium text-success-text"
                  : isCurrent
                    ? "font-medium text-brand-blue"
                    : "text-neutral-400",
              )}
            >
              {day} days
            </li>
          );
        })}
      </ol>

      <p className="text-xs text-neutral-500">
        {milestone.isGuaranteeElapsed
          ? "Your hire is past the guarantee period and settled in."
          : `If this hire does not work out within the guarantee, we replace them. ${milestone.daysRemaining} days of cover remaining.`}
      </p>
    </div>
  );
}
