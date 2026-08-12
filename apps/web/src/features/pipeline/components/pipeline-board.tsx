/**
 * The kanban board (05 §4.7, AC-UI-04): nine active-stage columns plus the
 * terminal side group. Drag a card to advance it — while dragging, columns
 * not reachable from the card's current stage via the stage machine are
 * visually disabled and refuse the drop (see StageColumn). The keyboard
 * path is each card's overflow menu ("Advance to…" with legal targets
 * only), driving the exact same onAdvance callback.
 *
 * Dropping on `placed` deliberately does NOT advance: it opens the Place
 * dialog, because placement is a dedicated transaction
 * (POST /assignments/:id/place — AC-PL-13), never a bare stage write.
 */
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  rectIntersection,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useState } from "react";
import type {
  AdminAssignmentRow,
  AssignmentStage,
  CandidateDetail,
} from "@sdb/contracts";
import {
  BOARD_STAGES,
  canAdvance,
  isBoardStage,
  isTerminalStage,
} from "../stage-machine";
import { AssignmentCard, type CardActions } from "./assignment-card";
import { StageColumn } from "./stage-column";
import { TerminalRail } from "./terminal-rail";

export interface PipelineBoardProps {
  rows: AdminAssignmentRow[];
  candidateById: Map<string, CandidateDetail>;
  actions: CardActions;
  /** Multi-select (present) mode: checkboxes on vetted cards. */
  isSelectMode: boolean;
  selectedIds: ReadonlySet<string>;
  onToggleSelect: (assignmentId: string) => void;
  /** Vetted column header slot (Select / Present controls). */
  vettedHeaderAction?: React.ReactNode;
}

export function PipelineBoard({
  rows,
  candidateById,
  actions,
  isSelectMode,
  selectedIds,
  onToggleSelect,
  vettedHeaderAction,
}: PipelineBoardProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const [activeId, setActiveId] = useState<string | null>(null);

  const activeRow = rows.find((row) => row.id === activeId) ?? null;
  const activeStage: AssignmentStage | null = activeRow?.stage ?? null;

  const handleDragStart = (event: DragStartEvent) => {
    setActiveId(String(event.active.id));
  };

  const handleDragEnd = (event: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = event;
    if (over === null) return;
    const row = rows.find((entry) => entry.id === String(active.id));
    if (row === undefined) return;
    const overStage = over.data.current?.stage as AssignmentStage | undefined;
    if (overStage === undefined || overStage === row.stage) return;
    if (!canAdvance(row.stage, overStage)) return; // droppable already disabled — belt and braces
    if (overStage === "placed") {
      actions.onPlace(row);
      return;
    }
    actions.onAdvance(row, overStage);
  };

  const activeRows = rows.filter((row) => isBoardStage(row.stage));
  const terminalRows = rows.filter((row) => isTerminalStage(row.stage));

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={rectIntersection}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="flex items-start gap-3 overflow-x-auto pb-4">
        {BOARD_STAGES.map((stage) => {
          const columnRows = activeRows
            .filter((row) => row.stage === stage)
            .sort(
              (a, b) =>
                a.sortOrder - b.sortOrder ||
                a.candidate.displayName.localeCompare(b.candidate.displayName),
            );
          return (
            <StageColumn
              key={stage}
              stage={stage}
              activeStage={activeStage}
              count={columnRows.length}
              headerAction={stage === "vetted" ? vettedHeaderAction : undefined}
            >
              {columnRows.length === 0 ? (
                <p className="px-1 py-2 text-center text-xs text-neutral-400">
                  No candidates
                </p>
              ) : (
                columnRows.map((row) => (
                  <AssignmentCard
                    key={row.id}
                    row={row}
                    candidate={candidateById.get(row.candidateId)}
                    actions={actions}
                    isSelectable={isSelectMode && stage === "vetted"}
                    isSelected={selectedIds.has(row.id)}
                    onToggleSelect={onToggleSelect}
                    isDraggable={!isSelectMode}
                  />
                ))
              )}
            </StageColumn>
          );
        })}
        <TerminalRail rows={terminalRows} />
      </div>

      <DragOverlay>
        {activeRow !== null ? (
          <div className="w-60 rotate-2 rounded-md border border-border-default bg-surface-raised p-3 shadow-lg">
            <p className="truncate text-sm font-medium text-brand-navy-ink">
              {activeRow.candidate.displayName}
            </p>
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
