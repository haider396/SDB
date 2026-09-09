/**
 * Fill-time growth on the canvas.
 *
 * The whole point of this module is that it does NOTHING to a page without a
 * repeating group, so the first test is the one that proves it.
 */
import { describe, expect, it } from "vitest";
import type {
  CanvasRect,
  FormBlock,
  RepeatingGroupConfig,
} from "@sdb/contracts";
import {
  extraGridRowsFor,
  shiftForGrowth,
} from "@/features/form-builder/layout-growth";
import { MAX_ROW, MAX_ROW_SPAN } from "@/features/form-builder/geometry";

let nextId = 0;

/** A minimal question block at an explicit rectangle. */
function blockAt(
  row: number,
  col: number,
  colSpan: number,
  rowSpan: number,
): FormBlock {
  nextId += 1;
  return {
    id: `block-${String(nextId)}`,
    parentBlockId: null,
    blockType: "question",
    questionId: `00000000-0000-4000-8000-${String(nextId).padStart(12, "0")}`,
    pageIndex: 0,
    sortOrder: nextId,
    layout: { desktop: { col, row, colSpan, rowSpan, z: 0 }, mobile: null },
    style: {},
    props: {},
    isRequiredOverride: null,
    labelOverride: null,
    placeholderOverride: null,
    helpTextOverride: null,
    optionValueOverrides: null,
  };
}

function rectOf(blocks: readonly FormBlock[], id: string): CanvasRect {
  const block = blocks.find((candidate) => candidate.id === id);
  if (block === undefined) throw new Error(`No block ${id}`);
  return block.layout.desktop;
}

describe("AC-FB-11 — a page with no repeating group is untouched", () => {
  it("returns the SAME ARRAY when nothing has grown", () => {
    const blocks = [blockAt(0, 0, 24, 8), blockAt(10, 0, 24, 8)];
    // toBe, NOT toEqual. Reference equality is the whole "nothing else
    // breaks" guarantee: a rebuilt array would pass toEqual and quietly
    // lose it.
    expect(shiftForGrowth(blocks, new Map())).toBe(blocks);
  });

  it("returns the SAME ARRAY when every recorded growth is zero", () => {
    const blocks = [blockAt(0, 0, 24, 8), blockAt(10, 0, 24, 8)];
    const first = blocks[0];
    if (first === undefined) throw new Error("fixture");
    expect(shiftForGrowth(blocks, new Map([[first.id, 0]]))).toBe(blocks);
  });

  it("keeps the identity of every block that did not move", () => {
    // The array is rebuilt when something grows, but an untouched block must
    // still be the same object, or React re-renders nodes nothing changed.
    const grown = blockAt(0, 0, 12, 8);
    const beside = blockAt(10, 12, 12, 8);
    const result = shiftForGrowth([grown, beside], new Map([[grown.id, 5]]));
    expect(result.find((block) => block.id === beside.id)).toBe(beside);
  });
});

describe("shiftForGrowth", () => {
  it("pushes a block below a grown one down by exactly the delta", () => {
    const grown = blockAt(0, 0, 24, 8);
    const below = blockAt(10, 0, 24, 8);
    const result = shiftForGrowth([grown, below], new Map([[grown.id, 5]]));
    expect(rectOf(result, grown.id).rowSpan).toBe(13);
    expect(rectOf(result, below.id).row).toBe(15);
  });

  it("leaves a block in a disjoint column where it is", () => {
    const grown = blockAt(0, 0, 12, 8); // left half
    const beside = blockAt(10, 12, 12, 8); // right half, lower down
    const result = shiftForGrowth([grown, beside], new Map([[grown.id, 5]]));
    expect(rectOf(result, beside.id).row).toBe(10);
  });

  it("does not move a block ABOVE the grown one", () => {
    const above = blockAt(0, 0, 24, 8);
    const grown = blockAt(10, 0, 24, 8);
    const result = shiftForGrowth([above, grown], new Map([[grown.id, 5]]));
    expect(rectOf(result, above.id).row).toBe(0);
  });

  it("accumulates two growths that share a column", () => {
    const first = blockAt(0, 0, 24, 8);
    const second = blockAt(10, 0, 24, 8);
    const below = blockAt(20, 0, 24, 8);
    const result = shiftForGrowth(
      [first, second, below],
      new Map([
        [first.id, 3],
        [second.id, 4],
      ]),
    );
    expect(rectOf(result, second.id).row).toBe(13);
    expect(rectOf(result, below.id).row).toBe(27);
  });

  it("still clears both growths when the first one is bigger than the gap", () => {
    /*
     * The regression the "record the growth at its SHIFTED row" version of
     * this function got wrong: with A grown by 50, B lands at row 51, and a
     * comparison of B's SHIFTED row (51) against C's authored row (10) decides
     * B is below C and skips its growth — so C lands on top of B. Both sides
     * of the comparison must be authored rows.
     */
    const first = blockAt(0, 0, 24, 8);
    const second = blockAt(1, 0, 24, 8);
    const third = blockAt(10, 0, 24, 8);
    const result = shiftForGrowth(
      [first, second, third],
      new Map([
        [first.id, 50],
        [second.id, 2],
      ]),
    );
    const secondRect = rectOf(result, second.id);
    expect(secondRect.row).toBe(51);
    // Below the bottom of the shifted, grown `second` block.
    expect(rectOf(result, third.id).row).toBeGreaterThanOrEqual(
      secondRect.row + secondRect.rowSpan,
    );
  });

  it("does not touch a block on another page", () => {
    const grown = blockAt(0, 0, 24, 8);
    const otherPage = { ...blockAt(10, 0, 24, 8), pageIndex: 1 };
    const result = shiftForGrowth([grown, otherPage], new Map([[grown.id, 5]]));
    expect(rectOf(result, otherPage.id).row).toBe(10);
  });

  it("clamps to MAX_ROW rather than producing an invalid rect", () => {
    const grown = blockAt(0, 0, 24, 8);
    const below = blockAt(10, 0, 24, 8);
    const result = shiftForGrowth([grown, below], new Map([[grown.id, 100000]]));
    expect(rectOf(result, below.id).row).toBeLessThanOrEqual(MAX_ROW);
    // The grown block's own span is a rectangle too, and CanvasRectSchema
    // caps rowSpan at 400.
    expect(rectOf(result, grown.id).rowSpan).toBeLessThanOrEqual(MAX_ROW_SPAN);
  });
});

describe("extraGridRowsFor", () => {
  /** minRows 0 → the block is sized for one row, matching block-height.ts. */
  const config: RepeatingGroupConfig = {
    columns: [
      {
        key: "skill",
        label: "Skill",
        columnType: "short_text",
        isRequired: false,
        widthWeight: 1,
      },
    ],
    minRows: 0,
    maxRows: 20,
    addRowLabel: "Add another",
  };

  it("asks for nothing at or below the base state", () => {
    expect(extraGridRowsFor(config, 0)).toBe(0);
    expect(extraGridRowsFor(config, 1)).toBe(0);
  });

  it("converts each added row to whole grid rows, rounding up", () => {
    // 44px of pitch over an 8px grid: six rows for the first added row.
    expect(extraGridRowsFor(config, 2)).toBe(6);
    expect(extraGridRowsFor(config, 4)).toBe(17);
  });

  it("measures from minRows when the question demands rows", () => {
    // Sized for three rows already, so the fourth is the first that grows it.
    const threeMin: RepeatingGroupConfig = { ...config, minRows: 3 };
    expect(extraGridRowsFor(threeMin, 3)).toBe(0);
    expect(extraGridRowsFor(threeMin, 4)).toBe(6);
  });
});
