/**
 * Grow repeating-group blocks at FILL time and push down only what collides.
 *
 * The canvas grid has FIXED 8px rows and explicit placement (form-canvas.css),
 * so a block that grows past its span renders ON TOP of the one below it.
 * Sizing every repeating group for maxRows in block-height.ts instead would
 * leave a ~900px hole on every form for a table someone fills with two rows.
 *
 * Deliberately NOT tidyBlocks(): that re-derives EVERY block's natural height
 * and would therefore move blocks on forms with nothing to do with this
 * feature. This function only ever adds the delta a repeating group actually
 * introduced.
 *
 * ── The reference-equality gate ────────────────────────────────────────────
 * With no growth, this returns its INPUT ARRAY. Not a copy. That is what makes
 * "a form with no repeating group is completely unaffected" a proof rather
 * than an argument, and it is what AC-FB-11 asserts with toBe. If you ever
 * rewrite this to map() unconditionally, the guarantee is gone and nothing
 * will fail to tell you.
 */
import type {
  CanvasRect,
  FormBlock,
  RepeatingGroupConfig,
} from "@sdb/contracts";
import {
  CANVAS_ROW_PX,
  columnsOverlap,
  repeatingGroupBaseRows,
  RG_ROW_PITCH_PX,
} from "./block-height";
import { MAX_ROW, MAX_ROW_SPAN } from "./geometry";

/**
 * Grid rows a repeating group needs BEYOND the base state block-height.ts
 * sized its block for.
 *
 * Every input to this comes from block-height.ts — the baseline, the per-row
 * pitch and the grid's row height — so growth and sizing cannot disagree. A
 * count at or below the baseline is zero, never negative: shrinking a block
 * would pull the rest of the page up under the candidate's cursor.
 */
export function extraGridRowsFor(
  config: RepeatingGroupConfig,
  rowCount: number,
): number {
  const added = Math.max(0, rowCount - repeatingGroupBaseRows(config));
  return Math.ceil((added * RG_ROW_PITCH_PX) / CANVAS_ROW_PX);
}

/** A growth, recorded at the block's AUTHORED rectangle. */
interface Growth {
  rect: CanvasRect;
  extra: number;
}

export function shiftForGrowth(
  blocks: readonly FormBlock[],
  extraRowsByBlockId: ReadonlyMap<string, number>,
): readonly FormBlock[] {
  let anyGrowth = false;
  for (const extra of extraRowsByBlockId.values()) {
    if (extra > 0) {
      anyGrowth = true;
      break;
    }
  }
  if (!anyGrowth) return blocks;

  const shifted = new Map<string, CanvasRect>();
  const pages = [...new Set(blocks.map((block) => block.pageIndex))];

  for (const pageIndex of pages) {
    const onPage = blocks
      .filter((block) => block.pageIndex === pageIndex)
      .sort((a, b) => {
        const ar = a.layout.desktop;
        const br = b.layout.desktop;
        return ar.row - br.row || ar.col - br.col || a.id.localeCompare(b.id);
      });

    const growths: Growth[] = [];

    for (const block of onPage) {
      const rect = block.layout.desktop;

      /*
       * Push down by the sum of every growth ABOVE this block that shares a
       * column with it. A growth beside it never applies — which is what
       * "side by side" actually means on this grid.
       *
       * BOTH SIDES OF THE COMPARISON ARE AUTHORED ROWS. Recording a growth at
       * the row it was itself shifted to looks tidier and is wrong: a block
       * pushed down 50 rows then reads as *below* everything authored beneath
       * it, its own growth is skipped, and the block after it lands on top of
       * it. "Was it above me on the canvas the admin arranged" is the question
       * being asked, and only the authored rows answer it.
       */
      let push = 0;
      for (const growth of growths) {
        if (growth.rect.row < rect.row && columnsOverlap(growth.rect, rect)) {
          push += growth.extra;
        }
      }

      const extra = extraRowsByBlockId.get(block.id) ?? 0;
      const row = Math.min(MAX_ROW, rect.row + push);
      // Clamped for the same reason `row` is: CanvasRectSchema caps rowSpan at
      // 400, and a rect this renderer produces has to stay a legal rect even
      // when a stray extras entry is nonsense.
      const rowSpan = Math.min(MAX_ROW_SPAN, rect.rowSpan + extra);

      if (extra > 0) growths.push({ rect, extra });

      if (row !== rect.row || rowSpan !== rect.rowSpan) {
        shifted.set(block.id, { ...rect, row, rowSpan });
      }
    }
  }

  if (shifted.size === 0) return blocks;
  return blocks.map((block) => {
    const rect = shifted.get(block.id);
    // A block that did not move keeps its identity too. Smaller than the array
    // win, but it keeps React from re-rendering untouched nodes.
    return rect === undefined
      ? block
      : { ...block, layout: { ...block.layout, desktop: rect } };
  });
}
