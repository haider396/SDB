/**
 * /admin/stats (04 §12 GET /admin/stats): three stat tiles and the
 * candidates-by-stage bar chart. Numerals are tabular everywhere (05 §4.2).
 */
import { Suspense, lazy } from "react";
import { BarChart3 } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { PageHeader } from "@/components/patterns/page-header";
import { useAdminStats } from "./api";
import { stageChartData } from "./components/stage-chart-data";

/** Recharts is heavy and stats-only (05 §1) — split it out of the shell. */
const StageChart = lazy(() => import("./components/stage-chart"));

function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <div className="rounded-lg bg-surface-raised p-6 shadow-sm">
      <p className="text-sm font-medium text-neutral-500">{label}</p>
      <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight text-brand-navy-ink">
        {value}
      </p>
      <p className="mt-1 text-xs text-neutral-500">{hint}</p>
    </div>
  );
}

export function StatsPage() {
  const query = useAdminStats();

  const header = (
    <PageHeader
      breadcrumbs={[{ label: "Admin", to: "/admin" }, { label: "Stats" }]}
      title="Stats"
      subtitle="Pipeline health across all active requisitions"
    />
  );

  if (query.isPending) {
    return (
      <div>
        {header}
        <LoadingSkeleton variant="card" rows={3} label="Loading stats…" />
      </div>
    );
  }

  if (query.isError) {
    return (
      <div>
        {header}
        <ErrorState error={query.error} onRetry={() => void query.refetch()} />
      </div>
    );
  }

  const stats = query.data;
  const chartData = stageChartData(stats.candidatesByStage);
  const hasPipeline = chartData.some((row) => row.count > 0);

  return (
    <div>
      {header}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatTile
          label="Open requisitions"
          value={String(stats.openRequisitions)}
          hint="Not yet placed or closed"
        />
        <StatTile
          label="Active placements"
          value={String(stats.activePlacements)}
          hint="Currently working with a client"
        />
        <StatTile
          label="Average days to present"
          value={
            stats.averageDaysToPresent === null
              ? "—"
              : stats.averageDaysToPresent.toFixed(1)
          }
          hint={
            stats.averageDaysToPresent === null
              ? "Nothing presented in the last 90 days"
              : "From assignment to presentation, last 90 days"
          }
        />
      </div>

      <section
        aria-label="Candidates by stage"
        className="mt-6 rounded-lg bg-surface-raised p-6 shadow-sm"
      >
        <h2 className="text-lg font-semibold tracking-tight text-brand-navy-ink">
          Candidates by stage
        </h2>
        <p className="mt-0.5 text-sm text-neutral-500">
          Assignments on active requisitions, in pipeline order
        </p>
        <div className="mt-4">
          {hasPipeline ? (
            <Suspense
              fallback={
                <LoadingSkeleton
                  variant="card"
                  rows={2}
                  label="Loading the chart…"
                />
              }
            >
              <StageChart data={chartData} />
            </Suspense>
          ) : (
            <EmptyState
              icon={BarChart3}
              title="No candidates in any pipeline"
              description="Assign candidates to a requisition and their stages will chart here."
            />
          )}
        </div>
      </section>
    </div>
  );
}
