/**
 * Collapsed side group for the four terminal stages (rejected_by_admin,
 * rejected_by_client, withdrawn, closed_not_selected): counts always
 * visible, each group expandable to a plain list — terminal rows are not
 * drop targets and carry no pipeline actions beyond viewing the candidate.
 */
import { ChevronDown, ChevronRight } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import type { AdminAssignmentRow } from "@sdb/contracts";
import { StatusBadge } from "@/components/patterns/status-badge";
import { formatDate } from "@/lib/format";
import { TERMINAL_STAGES, type TerminalStage } from "../stage-machine";
import { STAGE_LABELS } from "../labels";

export interface TerminalRailProps {
  rows: AdminAssignmentRow[];
}

export function TerminalRail({ rows }: TerminalRailProps) {
  const [openStages, setOpenStages] = useState<ReadonlySet<TerminalStage>>(
    new Set(),
  );

  const toggle = (stage: TerminalStage) => {
    setOpenStages((current) => {
      const next = new Set(current);
      if (next.has(stage)) next.delete(stage);
      else next.add(stage);
      return next;
    });
  };

  const byStage = new Map<TerminalStage, AdminAssignmentRow[]>(
    TERMINAL_STAGES.map((stage) => [
      stage,
      rows.filter((row) => row.stage === stage),
    ]),
  );

  return (
    <aside
      aria-label="Closed assignments"
      className="w-64 shrink-0 rounded-lg bg-surface-subtle p-3"
    >
      <h3 className="text-xs font-semibold uppercase tracking-tight text-neutral-600">
        Closed
      </h3>
      <ul className="mt-2 space-y-1">
        {TERMINAL_STAGES.map((stage) => {
          const stageRows = byStage.get(stage) ?? [];
          const isOpen = openStages.has(stage);
          return (
            <li key={stage}>
              <button
                type="button"
                aria-expanded={isOpen}
                onClick={() => toggle(stage)}
                className="flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm text-neutral-700 hover:bg-surface-raised"
              >
                {isOpen ? (
                  <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
                )}
                <span>{STAGE_LABELS[stage]}</span>
                <span className="ml-auto rounded-full bg-neutral-100 px-1.5 text-[11px] font-medium tabular-nums text-neutral-600">
                  {stageRows.length}
                </span>
              </button>
              {isOpen ? (
                stageRows.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-neutral-500">
                    No candidates here.
                  </p>
                ) : (
                  <ul className="mt-1 space-y-1 pl-4">
                    {stageRows.map((row) => (
                      <li
                        key={row.id}
                        className="rounded-md bg-surface-raised px-2 py-1.5 shadow-xs"
                      >
                        <Link
                          to={`/admin/candidates/${row.candidateId}`}
                          className="block truncate text-sm font-medium text-brand-navy-ink hover:underline"
                        >
                          {row.candidate.displayName}
                        </Link>
                        <div className="mt-0.5 flex items-center justify-between gap-1">
                          <StatusBadge stage={row.stage} />
                          <span className="text-[11px] text-neutral-500">
                            {formatDate(row.updatedAt)}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
