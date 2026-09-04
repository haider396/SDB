/**
 * Active placements by post-hire guarantee window (T31, admin side).
 *
 * Rebecca, 37:53: "that progress bar will be for the client, but it's also
 * something that would need to be inside of our pipelines as well. So we can
 * see of the candidates that we've placed, how many are in a 30, 60, 90 day
 * period, so that we know."
 *
 * Counts, not a list — she asked "how many", and the placements themselves are
 * reachable from their positions.
 */
import { ShieldCheck, TriangleAlert } from "lucide-react";
import type { AdminStats } from "@sdb/contracts";
import { GUARANTEE_PERIOD_DAYS } from "@sdb/contracts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const WINDOWS = [
  { key: "d30", label: "First 30 days", hint: "Day 0–29" },
  { key: "d60", label: "Day 30–60", hint: "Settling in" },
  { key: "d90", label: "Day 60–90", hint: "Guarantee ending soon" },
] as const;

export function GuaranteeWindows({
  windows,
}: {
  windows: AdminStats["placementsByGuaranteeWindow"];
}) {
  const inGuarantee = windows.d30 + windows.d60 + windows.d90;

  return (
    <Card className="mt-6">
      <CardHeader className="flex-row items-center gap-2 space-y-0">
        <ShieldCheck aria-hidden="true" className="h-4 w-4 text-neutral-500" />
        <CardTitle className="text-base">Post-hire guarantee</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {inGuarantee === 0 && windows.elapsed === 0 ? (
          <p className="text-sm text-neutral-500">
            No placements are inside their {GUARANTEE_PERIOD_DAYS}-day guarantee
            right now.
          </p>
        ) : (
          <>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {WINDOWS.map((window) => {
                const value = windows[window.key];
                return (
                  <div
                    key={window.key}
                    className={cn(
                      "rounded-lg border p-3",
                      value > 0
                        ? "border-border-default bg-surface-raised"
                        : "border-border-default bg-surface-subtle",
                    )}
                  >
                    <dt className="text-xs text-neutral-500">{window.label}</dt>
                    <dd className="mt-1 text-2xl font-semibold tabular-nums text-brand-navy-ink">
                      {value}
                    </dd>
                    <p className="text-xs text-neutral-500">{window.hint}</p>
                  </div>
                );
              })}
            </dl>

            <p className="text-xs text-neutral-500">
              <span className="tabular-nums">{inGuarantee}</span>{" "}
              {inGuarantee === 1 ? "placement is" : "placements are"} still
              within the {GUARANTEE_PERIOD_DAYS}-day guarantee. After that they
              close automatically.
            </p>
          </>
        )}

        {/* Should sit at zero: the nightly job closes elapsed placements. A
            number here that persists means the job is not running. */}
        {windows.elapsed > 0 ? (
          <p className="flex items-start gap-2 rounded-md bg-warning-subtle px-3 py-2 text-xs text-warning-text">
            <TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              <span className="tabular-nums">{windows.elapsed}</span>{" "}
              {windows.elapsed === 1 ? "placement is" : "placements are"} past
              the guarantee but still marked active. These close automatically
              overnight — if this number persists, the scheduled job is not
              running.
            </span>
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
