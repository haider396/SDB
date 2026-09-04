/**
 * The canvas: drag to move, handles to resize, arrows to nudge.
 *
 * dnd-kit, not a new dependency — it is already the house DnD idiom and
 * `useDraggable` + `event.delta` is exactly the free-positioning primitive
 * needed. `@dnd-kit/sortable` is deliberately NOT used here: the canvas is
 * free placement, not a list.
 *
 * ⚠ This module and everything under builder/ must never be imported from
 * render/ or from a public route — dnd-kit must not reach the public entry
 * chunk. Enforced by no-restricted-imports in eslint.config.js.
 *
 * ── Performance ────────────────────────────────────────────────────────────
 * A drag dispatches ONCE, on drop. dnd-kit's transform moves the node
 * locally while the gesture is in flight; dispatching per pointermove would
 * re-run the reducer and re-render every block 60×/sec.
 *
 * ── Keyboard ───────────────────────────────────────────────────────────────
 * dnd-kit's KeyboardSensor is deliberately NOT registered. A lift/move/drop
 * mode fights direct arrow-nudge for the same keys, and nudging a selected
 * block is simply better on a free canvas. The full keyboard story is: the
 * layer tree, arrow nudging here, and the Position panel.
 */
import { useCallback, useEffect, useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type Modifier,
} from "@dnd-kit/core";
import { Copy, Pencil, Trash2 } from "lucide-react";
import { CANVAS_COLUMNS, type FormBlock, type IntakeFormQuestion } from "@sdb/contracts";
import { cn } from "@/lib/utils";
import { CanvasRenderer } from "../../render/canvas-renderer";
import { CANVAS_ROW_PX_VALUE, type ResizeEdge } from "../../defaults";
import { moveRect, resizeRect } from "../../geometry";
import type { BuilderAction } from "../store/reducer";

const HANDLES: ResizeEdge[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

const HANDLE_STYLE: Record<ResizeEdge, string> = {
  nw: "left-0 top-0 -translate-x-1/2 -translate-y-1/2 cursor-nwse-resize",
  n: "left-1/2 top-0 -translate-x-1/2 -translate-y-1/2 cursor-ns-resize",
  ne: "right-0 top-0 translate-x-1/2 -translate-y-1/2 cursor-nesw-resize",
  e: "right-0 top-1/2 translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
  se: "bottom-0 right-0 translate-x-1/2 translate-y-1/2 cursor-nwse-resize",
  s: "bottom-0 left-1/2 -translate-x-1/2 translate-y-1/2 cursor-ns-resize",
  sw: "bottom-0 left-0 -translate-x-1/2 translate-y-1/2 cursor-nesw-resize",
  w: "left-0 top-1/2 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize",
};

/** Snap the live transform to whole grid units, so drags feel deliberate. */
function snapModifier(columnWidth: { current: number }): Modifier {
  return ({ transform }) => {
    const unit = columnWidth.current > 0 ? columnWidth.current : 1;
    return {
      ...transform,
      x: Math.round(transform.x / unit) * unit,
      y: Math.round(transform.y / CANVAS_ROW_PX_VALUE) * CANVAS_ROW_PX_VALUE,
    };
  };
}

export interface BuilderCanvasProps {
  blocks: readonly FormBlock[];
  questionsById: ReadonlyMap<string, IntakeFormQuestion>;
  pageIndex: number;
  selectedIds: readonly string[];
  dispatch: (action: BuilderAction) => void;
  announce: (message: string) => void;
  labelFor: (block: FormBlock) => string;
  renderQuestion: (question: IntakeFormQuestion, block: FormBlock) => ReactNode;
  /** Phone preview drops the authoring width floor. */
  device: "desktop" | "mobile";
  /** Reveal this block's settings — the inspector already follows selection. */
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
}

export function BuilderCanvas({
  blocks,
  questionsById,
  pageIndex,
  selectedIds,
  dispatch,
  announce,
  labelFor,
  renderQuestion,
  device,
  onEdit,
  onDuplicate,
}: BuilderCanvasProps) {
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const columnWidth = useRef(0);

  // One observer for the whole canvas, written into a ref so the snap modifier
  // stays a pure closure and no re-render is needed on resize.
  useEffect(() => {
    const element = canvasRef.current;
    if (element === null) return;
    const measure = () => {
      columnWidth.current = element.clientWidth / CANVAS_COLUMNS;
    };
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const sensors = useSensors(
    // 4px activation distance — the house convention from sortable-list.tsx,
    // so a click to select is never mistaken for a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const id = String(event.active.id);
      const unit = columnWidth.current > 0 ? columnWidth.current : 1;
      const deltaCols = Math.round(event.delta.x / unit);
      const deltaRows = Math.round(event.delta.y / CANVAS_ROW_PX_VALUE);
      if (deltaCols === 0 && deltaRows === 0) return;
      const ids = selectedIds.includes(id) ? selectedIds : [id];
      dispatch({ type: "MOVE_BLOCKS", ids, deltaCols, deltaRows });
      const moved = blocks.find((block) => block.id === id);
      if (moved !== undefined) {
        announce(
          `Moved to column ${String(moved.layout.desktop.col + deltaCols + 1)}, row ${String(moved.layout.desktop.row + deltaRows + 1)}.`,
        );
      }
    },
    [announce, blocks, dispatch, selectedIds],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      modifiers={[snapModifier(columnWidth)]}
      onDragEnd={onDragEnd}
    >
      <div
        ref={canvasRef}
        className={cn(
          "sdb-builder-canvas sdb-form-scope",
          device === "mobile" && "sdb-builder-canvas--mobile",
        )}
      >
        <CanvasRenderer
          blocks={blocks}
          questionsById={questionsById}
          pageIndex={pageIndex}
          renderQuestion={renderQuestion}
          wrapNode={(block, node) => (
            <EditableNode
              key={block.id}
              block={block}
              node={node}
              label={labelFor(block)}
              selected={selectedIds.includes(block.id)}
              dispatch={dispatch}
              announce={announce}
              columnWidth={columnWidth}
              onEdit={onEdit}
              onDuplicate={onDuplicate}
            />
          )}
        />
      </div>
      <DragOverlay dropAnimation={null}>
        <div className="rounded-sm border-2 border-brand-blue bg-brand-blue-subtle/40" />
      </DragOverlay>
    </DndContext>
  );
}

function EditableNode({
  block,
  node,
  label,
  selected,
  dispatch,
  announce,
  columnWidth,
  onEdit,
  onDuplicate,
}: {
  block: FormBlock;
  node: ReactNode;
  label: string;
  selected: boolean;
  dispatch: (action: BuilderAction) => void;
  announce: (message: string) => void;
  columnWidth: { current: number };
  onEdit: (id: string) => void;
  onDuplicate: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: block.id,
  });

  /** Arrow nudging: the direct-manipulation keyboard path. */
  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 4 : 1;
    const resizing = event.ctrlKey || event.metaKey;
    let handled = true;

    /**
     * Announce where the block ENDED UP, computed from the same clamped
     * geometry the reducer uses — so a nudge that hits the canvas edge says
     * the position did not change rather than claiming a move that never
     * happened.
     */
    const announceMove = (deltaCols: number, deltaRows: number) => {
      const next = moveRect(block.layout.desktop, deltaCols, deltaRows);
      announce(
        next.col === block.layout.desktop.col && next.row === block.layout.desktop.row
          ? `${label} is already at the edge.`
          : `Moved to column ${String(next.col + 1)}, row ${String(next.row + 1)}.`,
      );
    };
    const announceResize = (edge: ResizeEdge, deltaCols: number, deltaRows: number) => {
      const next = resizeRect(block.layout.desktop, edge, deltaCols, deltaRows);
      announce(
        `Resized to ${String(next.colSpan)} columns by ${String(next.rowSpan)} rows.`,
      );
    };
    switch (event.key) {
      case "ArrowLeft":
        if (resizing) {
          dispatch({ type: "RESIZE_BLOCK", id: block.id, edge: "e", deltaCols: -step, deltaRows: 0 });
          announceResize("e", -step, 0);
        } else {
          dispatch({ type: "MOVE_BLOCKS", ids: [block.id], deltaCols: -step, deltaRows: 0 });
          announceMove(-step, 0);
        }
        break;
      case "ArrowRight":
        if (resizing) {
          dispatch({ type: "RESIZE_BLOCK", id: block.id, edge: "e", deltaCols: step, deltaRows: 0 });
          announceResize("e", step, 0);
        } else {
          dispatch({ type: "MOVE_BLOCKS", ids: [block.id], deltaCols: step, deltaRows: 0 });
          announceMove(step, 0);
        }
        break;
      case "ArrowUp":
        if (event.altKey) {
          dispatch({ type: "RESTACK", id: block.id, direction: "forward" });
          announce(`${label} brought forward.`);
        } else if (resizing) {
          dispatch({ type: "RESIZE_BLOCK", id: block.id, edge: "s", deltaCols: 0, deltaRows: -step });
          announceResize("s", 0, -step);
        } else {
          dispatch({ type: "MOVE_BLOCKS", ids: [block.id], deltaCols: 0, deltaRows: -step });
          announceMove(0, -step);
        }
        break;
      case "ArrowDown":
        if (event.altKey) {
          dispatch({ type: "RESTACK", id: block.id, direction: "backward" });
          announce(`${label} sent backward.`);
        } else if (resizing) {
          dispatch({ type: "RESIZE_BLOCK", id: block.id, edge: "s", deltaCols: 0, deltaRows: step });
          announceResize("s", 0, step);
        } else {
          dispatch({ type: "MOVE_BLOCKS", ids: [block.id], deltaCols: 0, deltaRows: step });
          announceMove(0, step);
        }
        break;
      case "Delete":
      case "Backspace":
        dispatch({ type: "DELETE_BLOCKS", ids: [block.id] });
        announce(`${label} removed.`);
        break;
      case "Escape":
        dispatch({ type: "SELECT", ids: [] });
        break;
      default:
        handled = false;
    }
    if (handled) {
      event.preventDefault();
      event.stopPropagation();
    }
  }

  /** Pointer resize. Live preview is inline style; ONE dispatch on release. */
  function startResize(edge: ResizeEdge, event: ReactPointerEvent<HTMLButtonElement>) {
    event.preventDefault();
    event.stopPropagation();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    const startX = event.clientX;
    const startY = event.clientY;

    const onUp = (upEvent: PointerEvent) => {
      target.removeEventListener("pointerup", onUp);
      const unit = columnWidth.current > 0 ? columnWidth.current : 1;
      const deltaCols = Math.round((upEvent.clientX - startX) / unit);
      const deltaRows = Math.round((upEvent.clientY - startY) / CANVAS_ROW_PX_VALUE);
      if (deltaCols !== 0 || deltaRows !== 0) {
        dispatch({ type: "RESIZE_BLOCK", id: block.id, edge, deltaCols, deltaRows });
        announce(`${label} resized.`);
      }
    };
    target.addEventListener("pointerup", onUp);
  }

  return (
    <div
      ref={setNodeRef}
      // dnd-kit's attributes come first so our accessible name, pressed state
      // and key handling win — they set role/tabIndex/aria-* of their own.
      {...attributes}
      {...listeners}
      role="button"
      tabIndex={0}
      aria-label={`${label}, column ${String(block.layout.desktop.col + 1)}, row ${String(block.layout.desktop.row + 1)}`}
      aria-pressed={selected}
      onKeyDown={onKeyDown}
      onClick={(event) => {
        event.stopPropagation();
        dispatch({ type: "SELECT", ids: [block.id] });
      }}
      style={
        transform === null
          ? undefined
          : { transform: `translate3d(${String(transform.x)}px, ${String(transform.y)}px, 0)` }
      }
      className={cn(
        "sdb-node-focus relative h-full",
        selected && "sdb-node-selected",
        isDragging && "opacity-60",
      )}
    >
      {node}
      {/*
        Per-block actions. Shown on the SELECTED block only — one toolbar per
        block on a busy canvas would be noise, and selection is a click away.
        These duplicate what the layer tree and Position panel already do, so
        the keyboard path is unaffected if they are never used.
      */}
      {selected ? (
        <div
          /*
           * Bottom-LEFT, inside the block. Two clipping traps ruled out the
           * obvious placements:
           *  - above the block: the canvas scrolls (overflow-x:auto forces
           *    overflow-y:auto), so a first-row block's toolbar is cut off;
           *  - block's right edge: a full-width block is 832px in a ~500px
           *    pane, putting a right-anchored toolbar outside the view.
           * The left edge is always in view, and the row height leaves a gap
           * below the input for it to sit in.
           */
          className="absolute bottom-1 left-1 z-10 flex items-center gap-0.5 rounded-md border border-border-default bg-surface-raised p-0.5 shadow-sm"
          // The parent is draggable; a pointer-down here must not start a drag.
          onPointerDown={(event) => event.stopPropagation()}
        >
          <button
            type="button"
            aria-label={`Edit ${label}`}
            title="Edit"
            className="rounded-sm p-1 text-neutral-600 hover:bg-surface-subtle"
            onClick={(event) => {
              event.stopPropagation();
              onEdit(block.id);
            }}
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`Duplicate ${label}`}
            title="Duplicate"
            className="rounded-sm p-1 text-neutral-600 hover:bg-surface-subtle"
            onClick={(event) => {
              event.stopPropagation();
              onDuplicate(block.id);
            }}
          >
            <Copy className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            aria-label={`Delete ${label}`}
            title="Delete"
            className="rounded-sm p-1 text-danger-text hover:bg-danger-subtle"
            onClick={(event) => {
              event.stopPropagation();
              dispatch({ type: "DELETE_BLOCKS", ids: [block.id] });
              // No confirmation: undo covers it, and a dialog on every field
              // removal would make building a form tedious.
              announce(`${label} removed. Press Ctrl+Z to undo.`);
            }}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        </div>
      ) : null}
      {selected
        ? HANDLES.map((edge) => (
            <button
              key={edge}
              type="button"
              // Pointer affordance only — the keyboard equivalent is the
              // Position panel, so these stay out of the tab order.
              aria-hidden="true"
              tabIndex={-1}
              onPointerDown={(event) => startResize(edge, event)}
              className={cn("sdb-resize-handle", HANDLE_STYLE[edge])}
            />
          ))
        : null}
    </div>
  );
}
