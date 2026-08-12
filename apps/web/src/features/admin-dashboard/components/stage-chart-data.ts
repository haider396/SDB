/**
 * Pure data mapping for the candidates-by-stage chart, kept separate from
 * stage-chart.tsx so the page can import it statically while the Recharts
 * component itself is code-split (Recharts only ships to /admin/stats).
 */
import type { AdminStats, AssignmentStage } from "@sdb/contracts";
import { STAGE_LABELS } from "@/features/pipeline/labels";
import {
  BOARD_STAGES,
  TERMINAL_STAGES,
} from "@/features/pipeline/stage-machine";

export interface StageChartRow {
  stage: AssignmentStage;
  label: string;
  count: number;
}

/**
 * Chart rows in pipeline order: the nine board stages always (zero-filled,
 * so the pipeline's shape is visible even when thin), terminal stages only
 * when the API reports a non-zero count for them.
 */
export function stageChartData(
  candidatesByStage: AdminStats["candidatesByStage"],
): StageChartRow[] {
  const rows: StageChartRow[] = BOARD_STAGES.map((stage) => ({
    stage,
    label: STAGE_LABELS[stage],
    count: candidatesByStage[stage] ?? 0,
  }));
  for (const stage of TERMINAL_STAGES) {
    const count = candidatesByStage[stage] ?? 0;
    if (count > 0) rows.push({ stage, label: STAGE_LABELS[stage], count });
  }
  return rows;
}
