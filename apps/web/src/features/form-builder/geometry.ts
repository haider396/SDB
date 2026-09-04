/**
 * Canvas geometry — PURE functions, no React, no DOM.
 *
 * Everything positional lives here so it can be unit-tested directly. That
 * matters because `css: false` + jsdom means getBoundingClientRect() returns
 * zeros in tests: pointer-drag geometry is untestable in Vitest, so the maths
 * must be reachable without a drag.
 *
 * Units are GRID units, not pixels: 24 columns wide, 8px rows. Absolute pixels
 * would break the form at any viewport width other than the author's monitor
 * and would make the mobile reflow unsolvable.
 */
import {
  CANVAS_COLUMNS,
  MIN_COL_SPAN,
  MIN_ROW_SPAN,
  type CanvasRect,
  type FormBlock,
} from "@sdb/contracts";

export const MAX_ROW = 2000;
export const MAX_ROW_SPAN = 400;
export const MAX_Z = 999;

const clamp = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

/** Snap a pixel delta to whole grid units. */
export function snapToGrid(deltaPx: number, unitPx: number): number {
  if (unitPx <= 0) return 0;
  return Math.round(deltaPx / unitPx);
}

/**
 * Move a rectangle, keeping it inside the canvas.
 *
 * The column is clamped so the block always fits: a block 12 wide can never
 * start past column 12. Rows are clamped at zero but otherwise free — the
 * canvas grows downward.
 */
export function moveRect(
  rect: CanvasRect,
  deltaCols: number,
  deltaRows: number,
): CanvasRect {
  return {
    ...rect,
    col: clamp(rect.col + deltaCols, 0, CANVAS_COLUMNS - rect.colSpan),
    row: clamp(rect.row + deltaRows, 0, MAX_ROW),
  };
}

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/**
 * Resize from one edge. Dragging a left/top edge moves the origin as well as
 * the span, and both are clamped so a field can never become unusably small
 * (MIN_COL_SPAN / MIN_ROW_SPAN) or escape the canvas.
 */
export function resizeRect(
  rect: CanvasRect,
  edge: ResizeEdge,
  deltaCols: number,
  deltaRows: number,
): CanvasRect {
  let { col, row, colSpan, rowSpan } = rect;

  if (edge.includes("e")) {
    colSpan = clamp(colSpan + deltaCols, MIN_COL_SPAN, CANVAS_COLUMNS - col);
  }
  if (edge.includes("w")) {
    // The right edge is fixed, so the origin and the span move together.
    const right = col + colSpan;
    const nextCol = clamp(col + deltaCols, 0, right - MIN_COL_SPAN);
    colSpan = right - nextCol;
    col = nextCol;
  }
  if (edge.includes("s")) {
    rowSpan = clamp(rowSpan + deltaRows, MIN_ROW_SPAN, MAX_ROW_SPAN);
  }
  if (edge.includes("n")) {
    const bottom = row + rowSpan;
    const nextRow = clamp(row + deltaRows, 0, bottom - MIN_ROW_SPAN);
    rowSpan = bottom - nextRow;
    row = nextRow;
  }

  return { ...rect, col, row, colSpan, rowSpan };
}

/** Force a rectangle into legal bounds — used when reading stored data. */
export function normaliseRect(rect: CanvasRect): CanvasRect {
  const colSpan = clamp(rect.colSpan, MIN_COL_SPAN, CANVAS_COLUMNS);
  return {
    col: clamp(rect.col, 0, CANVAS_COLUMNS - colSpan),
    row: clamp(rect.row, 0, MAX_ROW),
    colSpan,
    rowSpan: clamp(rect.rowSpan, MIN_ROW_SPAN, MAX_ROW_SPAN),
    z: clamp(rect.z, 0, MAX_Z),
  };
}

/**
 * Reading order for the narrow layout: top to bottom, then left to right.
 *
 * A `mobileOrder` override wins when present. The final tiebreak on id keeps
 * the order TOTAL — two blocks at the same position must not reorder between
 * renders, or the form would visibly shuffle.
 */
export function reflowOrder(blocks: readonly FormBlock[]): Map<string, number> {
  const sorted = [...blocks].sort((a, b) => {
    const am = a.layout.mobile;
    const bm = b.layout.mobile;
    // A hand-placed mobile rectangle sorts by its own position first.
    if (am !== null && bm !== null) {
      if (am.row !== bm.row) return am.row - bm.row;
      if (am.col !== bm.col) return am.col - bm.col;
    } else if (am !== null) {
      return -1;
    } else if (bm !== null) {
      return 1;
    }
    if (a.layout.desktop.row !== b.layout.desktop.row) {
      return a.layout.desktop.row - b.layout.desktop.row;
    }
    if (a.layout.desktop.col !== b.layout.desktop.col) {
      return a.layout.desktop.col - b.layout.desktop.col;
    }
    return a.id.localeCompare(b.id);
  });
  return new Map(sorted.map((block, index) => [block.id, index]));
}

export type ZDirection = "front" | "back" | "forward" | "backward";

/**
 * Re-stack one block and normalise the whole set to a dense 0..n-1 range, so
 * z-values cannot drift upward over time.
 */
export function restack(
  blocks: readonly FormBlock[],
  id: string,
  direction: ZDirection,
): Map<string, number> {
  const ordered = [...blocks].sort(
    (a, b) => a.layout.desktop.z - b.layout.desktop.z || a.id.localeCompare(b.id),
  );
  const index = ordered.findIndex((block) => block.id === id);
  if (index < 0) {
    return new Map(ordered.map((block, i) => [block.id, i]));
  }
  const [moved] = ordered.splice(index, 1);
  const target =
    direction === "front"
      ? ordered.length
      : direction === "back"
        ? 0
        : direction === "forward"
          ? Math.min(ordered.length, index + 1)
          : Math.max(0, index - 1);
  ordered.splice(target, 0, moved!);
  return new Map(ordered.map((block, i) => [block.id, i]));
}

/** First free row beneath everything, so a new block never lands on top. */
export function nextFreeRow(blocks: readonly FormBlock[], pageIndex: number): number {
  const onPage = blocks.filter((block) => block.pageIndex === pageIndex);
  if (onPage.length === 0) return 0;
  return Math.min(
    MAX_ROW,
    Math.max(...onPage.map((b) => b.layout.desktop.row + b.layout.desktop.rowSpan)) + 2,
  );
}

/** Spoken description of a block's position, for the aria-live region. */
export function describeRect(rect: CanvasRect): string {
  return `column ${rect.col + 1}, row ${rect.row + 1}, ${rect.colSpan} columns wide, ${rect.rowSpan} rows tall`;
}
