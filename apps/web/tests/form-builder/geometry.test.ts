/**
 * Canvas geometry.
 *
 * These are the tests that matter most for the builder: `css: false` + jsdom
 * means getBoundingClientRect() returns zeros, so a pointer drag is untestable
 * in Vitest. All the maths therefore lives in pure functions and is verified
 * here, without a DOM.
 */
import { describe, expect, it } from "vitest";
import { CANVAS_COLUMNS, MIN_COL_SPAN, MIN_ROW_SPAN } from "@sdb/contracts";
import type { CanvasRect, FormBlock } from "@sdb/contracts";
import {
  describeRect,
  moveRect,
  nextFreeRow,
  normaliseRect,
  reflowOrder,
  resizeRect,
  restack,
  snapToGrid,
} from "@/features/form-builder/geometry";

function rect(overrides: Partial<CanvasRect> = {}): CanvasRect {
  return { col: 0, row: 0, colSpan: 12, rowSpan: 8, z: 0, ...overrides };
}

function block(id: string, overrides: Partial<CanvasRect> = {}, mobile: CanvasRect | null = null): FormBlock {
  return {
    id,
    parentBlockId: null,
    blockType: "spacer",
    questionId: null,
    pageIndex: 0,
    sortOrder: 0,
    layout: { desktop: rect(overrides), mobile },
    style: {},
    props: {},
    isRequiredOverride: null,
    labelOverride: null,
    placeholderOverride: null,
    helpTextOverride: null,
    optionValueOverrides: null,
  };
}

describe("snapping", () => {
  it("rounds a pixel delta to the nearest whole unit", () => {
    expect(snapToGrid(31, 10)).toBe(3);
    expect(snapToGrid(35, 10)).toBe(4);
    expect(snapToGrid(-31, 10)).toBe(-3);
  });

  it("does not divide by zero before the canvas has been measured", () => {
    expect(snapToGrid(100, 0)).toBe(0);
  });
});

describe("moving", () => {
  it("moves by the delta", () => {
    expect(moveRect(rect(), 3, 5)).toMatchObject({ col: 3, row: 5 });
  });

  it("stops at the left edge instead of going negative", () => {
    expect(moveRect(rect({ col: 2 }), -10, 0).col).toBe(0);
  });

  it("stops at the right edge so a block always fits", () => {
    // A 12-wide block on a 24-column canvas can never start past column 12.
    expect(moveRect(rect({ col: 0, colSpan: 12 }), 99, 0).col).toBe(12);
  });

  it("never lets a row go negative", () => {
    expect(moveRect(rect({ row: 1 }), 0, -50).row).toBe(0);
  });
});

describe("resizing", () => {
  it("grows from the east edge", () => {
    expect(resizeRect(rect(), "e", 4, 0).colSpan).toBe(16);
  });

  it("moves the origin when dragging the west edge", () => {
    // The right edge stays put: col 4 + span 12 = 16, so col 6 → span 10.
    const result = resizeRect(rect({ col: 4, colSpan: 12 }), "w", 2, 0);
    expect(result).toMatchObject({ col: 6, colSpan: 10 });
  });

  it("refuses to shrink a field below usable size", () => {
    expect(resizeRect(rect(), "e", -99, 0).colSpan).toBe(MIN_COL_SPAN);
    expect(resizeRect(rect(), "s", 0, -99).rowSpan).toBe(MIN_ROW_SPAN);
  });

  it("never grows past the right edge of the canvas", () => {
    const result = resizeRect(rect({ col: 20, colSpan: 4 }), "e", 99, 0);
    expect(result.col + result.colSpan).toBeLessThanOrEqual(CANVAS_COLUMNS);
  });

  it("caps an absurd height — a free canvas is not a licence to crash", () => {
    expect(resizeRect(rect(), "s", 0, 900_000).rowSpan).toBeLessThanOrEqual(400);
  });
});

describe("normalising stored data", () => {
  it("pulls an out-of-bounds rectangle back inside", () => {
    const result = normaliseRect({ col: 40, row: -5, colSpan: 99, rowSpan: 1, z: 9999 });
    expect(result.colSpan).toBeLessThanOrEqual(CANVAS_COLUMNS);
    expect(result.col + result.colSpan).toBeLessThanOrEqual(CANVAS_COLUMNS);
    expect(result.row).toBe(0);
    expect(result.rowSpan).toBeGreaterThanOrEqual(MIN_ROW_SPAN);
    expect(result.z).toBeLessThanOrEqual(999);
  });
});

describe("mobile reflow", () => {
  it("reads top to bottom, then left to right", () => {
    const blocks = [
      block("c", { col: 0, row: 10 }),
      block("a", { col: 0, row: 0 }),
      block("b", { col: 12, row: 0 }),
    ];
    const order = reflowOrder(blocks);
    expect(order.get("a")).toBe(0);
    expect(order.get("b")).toBe(1);
    expect(order.get("c")).toBe(2);
  });

  it("is a TOTAL order — identical positions never shuffle between renders", () => {
    const blocks = [block("z", { col: 0, row: 0 }), block("a", { col: 0, row: 0 })];
    const first = reflowOrder(blocks);
    const second = reflowOrder([...blocks].reverse());
    expect(first.get("a")).toBe(second.get("a"));
    expect(first.get("z")).toBe(second.get("z"));
  });

  it("puts a hand-placed phone layout before the auto-stacked ones", () => {
    const blocks = [
      block("auto", { col: 0, row: 0 }),
      block("placed", { col: 0, row: 99 }, rect({ row: 0 })),
    ];
    expect(reflowOrder(blocks).get("placed")).toBe(0);
  });
});

describe("z-order", () => {
  it("brings a block to the front and normalises to a dense range", () => {
    const blocks = [block("a", { z: 0 }), block("b", { z: 5 }), block("c", { z: 9 })];
    const result = restack(blocks, "a", "front");
    expect(result.get("a")).toBe(2);
    // Dense 0..n-1 so values cannot drift upward over time.
    expect([...result.values()].sort()).toEqual([0, 1, 2]);
  });

  it("moves one step at a time for forward and backward", () => {
    const blocks = [block("a", { z: 0 }), block("b", { z: 1 }), block("c", { z: 2 })];
    expect(restack(blocks, "a", "forward").get("a")).toBe(1);
    expect(restack(blocks, "c", "backward").get("c")).toBe(1);
  });

  it("is a no-op at the ends", () => {
    const blocks = [block("a", { z: 0 }), block("b", { z: 1 })];
    expect(restack(blocks, "a", "backward").get("a")).toBe(0);
    expect(restack(blocks, "b", "forward").get("b")).toBe(1);
  });
});

describe("placement helpers", () => {
  it("puts a new block below everything on the page", () => {
    const blocks = [block("a", { row: 0, rowSpan: 8 }), block("b", { row: 20, rowSpan: 8 })];
    expect(nextFreeRow(blocks, 0)).toBe(30);
  });

  it("starts at the top of an empty page", () => {
    expect(nextFreeRow([], 0)).toBe(0);
    expect(nextFreeRow([block("a", { row: 40 })], 1)).toBe(0);
  });

  it("describes a position in words for the live region", () => {
    expect(describeRect(rect({ col: 3, row: 4 }))).toBe(
      "column 4, row 5, 12 columns wide, 8 rows tall",
    );
  });
});
