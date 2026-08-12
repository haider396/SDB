/**
 * Candidates-by-stage bar chart for /admin/stats — the ONLY Recharts surface
 * in the app (05 §1: "Only for the admin stats view").
 *
 * Colour: a single hue for a single measure (magnitude), taken from the
 * token sheet via CSS vars — never a raw hex (AC-UI-01). Identity lives in
 * the category axis text, values in direct end labels, so nothing depends
 * on colour alone.
 */
import {
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { StageChartRow } from "./stage-chart-data";

const BAR_ROW_HEIGHT = 34;

export function StageChart({ data }: { data: StageChartRow[] }) {
  const total = data.reduce((sum, row) => sum + row.count, 0);
  return (
    <div
      role="img"
      aria-label={`Candidates by stage: ${data
        .map((row) => `${row.label} ${row.count}`)
        .join(", ")}`}
      className="text-xs"
    >
      <ResponsiveContainer
        width="100%"
        height={data.length * BAR_ROW_HEIGHT + 30}
      >
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 4, right: 40, bottom: 4, left: 8 }}
          barCategoryGap={8}
        >
          <CartesianGrid
            horizontal={false}
            stroke="var(--neutral-200)"
            strokeDasharray="0"
          />
          <XAxis
            type="number"
            allowDecimals={false}
            stroke="var(--neutral-300)"
            tick={{ fill: "var(--neutral-500)", fontSize: 12 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            type="category"
            dataKey="label"
            width={150}
            stroke="var(--neutral-300)"
            tick={{ fill: "var(--neutral-600)", fontSize: 12 }}
            tickLine={false}
            axisLine={{ stroke: "var(--neutral-200)" }}
          />
          <Tooltip
            cursor={{ fill: "var(--surface-subtle)" }}
            formatter={(value: number | string) => [value, "Candidates"]}
            contentStyle={{
              backgroundColor: "var(--surface-raised)",
              border: "1px solid var(--border-default)",
              borderRadius: "var(--radius-md)",
              color: "var(--neutral-800)",
              fontSize: "var(--text-xs)",
            }}
          />
          <Bar
            dataKey="count"
            fill="var(--brand-blue)"
            radius={[0, 4, 4, 0]}
            barSize={16}
            isAnimationActive={false}
          >
            <LabelList
              dataKey="count"
              position="right"
              fill="var(--neutral-600)"
              fontSize={12}
              formatter={(value: number | string) =>
                Number(value) === 0 ? "" : String(value)
              }
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="mt-1 text-right text-xs tabular-nums text-neutral-500">
        {total} candidate{total === 1 ? "" : "s"} across active requisitions
      </p>
    </div>
  );
}

/** Default export for React.lazy code-splitting (stats-page.tsx). */
export default StageChart;
