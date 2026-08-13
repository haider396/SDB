/**
 * One kanban column. The 05 §4.7 requirement lives here: while a card is
 * being dragged, a column that is NOT a machine-legal target renders
 * visually disabled (reduced opacity, not-allowed cursor, aria-disabled)
 * and its droppable is disabled so the drop is refused — invalid targets
 * are communicated DURING the drag, never rejected after the drop.
 *
 * EMPTY columns collapse to a slim vertical strip (label + zero count) so
 * the board's real work fits on screen. A collapsed column stays a fully
 * valid drop target: during a legal drag it lights up, and it expands the
 * moment the card hovers over it.
 */
import { useDroppable } from "@dnd-kit/core";
import type { ReactNode } from "react";
import type { AssignmentStage } from "@sdb/contracts";
import { cn } from "@/lib/utils";
import {
  columnDropState,
  type BoardStage,
  type ColumnDropState,
} from "../stage-machine";
import { STAGE_LABELS } from "../labels";

export interface StageColumnProps {
  stage: BoardStage;
  /** Stage of the card currently being dragged, or null when idle. */
  activeStage: AssignmentStage | null;
  count: number;
  /** Column-header slot (e.g. the vetted column's selection count). */
  headerAction?: ReactNode;
  children: ReactNode;
}

const STATE_CLASSES: Record<ColumnDropState, string> = {
  idle: "",
  origin: "",
  valid: "ring-2 ring-brand-blue ring-offset-1",
  disabled: "opacity-40 cursor-not-allowed",
};

export function StageColumn({
  stage,
  activeStage,
  count,
  headerAction,
  children,
}: StageColumnProps) {
  const dropState = columnDropState(activeStage, stage);
  const { setNodeRef, isOver } = useDroppable({
    id: `column-${stage}`,
    data: { stage },
    disabled: dropState === "disabled" || dropState === "origin",
  });

  // Empty columns collapse to a slim strip; hovering a dragged card over a
  // collapsed valid target expands it so the drop area is unmistakable.
  const isCollapsed = count === 0 && !(dropState === "valid" && isOver);

  if (isCollapsed) {
    return (
      <section
        ref={setNodeRef}
        aria-label={`${STAGE_LABELS[stage]} column`}
        aria-disabled={dropState === "disabled"}
        data-drop-state={dropState}
        data-collapsed="true"
        className={cn(
          "flex min-h-48 w-10 shrink-0 flex-col items-center gap-2 rounded-lg bg-surface-subtle py-3",
          STATE_CLASSES[dropState],
        )}
      >
        <span
          className="rounded-full bg-neutral-100 px-1.5 text-[11px] font-medium tabular-nums text-neutral-600"
          aria-label={`${count} candidates`}
        >
          {count}
        </span>
        <h3 className="text-xs font-semibold uppercase tracking-tight text-neutral-600 [writing-mode:vertical-rl]">
          {STAGE_LABELS[stage]}
        </h3>
        {/* Children stay out of the DOM — an empty column has none worth
            rendering, and the strip must stay slim. */}
      </section>
    );
  }

  return (
    <section
      ref={setNodeRef}
      aria-label={`${STAGE_LABELS[stage]} column`}
      aria-disabled={dropState === "disabled"}
      data-drop-state={dropState}
      className={cn(
        "flex w-64 shrink-0 flex-col rounded-lg bg-surface-subtle",
        STATE_CLASSES[dropState],
        dropState === "valid" && isOver && "bg-brand-blue-subtle",
      )}
    >
      <header className="flex items-center gap-2 px-3 pb-1 pt-3">
        <h3 className="text-xs font-semibold uppercase tracking-tight text-neutral-600">
          {STAGE_LABELS[stage]}
        </h3>
        <span
          className="rounded-full bg-neutral-100 px-1.5 text-[11px] font-medium tabular-nums text-neutral-600"
          aria-label={`${count} candidates`}
        >
          {count}
        </span>
        <div className="ml-auto">{headerAction}</div>
      </header>
      <div className="flex min-h-16 flex-1 flex-col gap-2 overflow-y-auto p-2">
        {children}
      </div>
    </section>
  );
}
