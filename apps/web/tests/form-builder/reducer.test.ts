/**
 * The builder document reducer: undo/redo, coalescing, and dirty tracking.
 *
 * Coalescing is the one people get wrong: dragging a padding stepper from 0 to
 * 24 fires 24 actions, and each one becoming its own undo step makes undo
 * useless. These tests pin the 500ms window.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormBlock, FormDocument } from "@sdb/contracts";
import {
  builderReducer,
  initialState,
  isDirty,
  type BuilderState,
} from "@/features/form-builder/builder/store/reducer";

function block(id: string, col = 0, row = 0): FormBlock {
  return {
    id,
    parentBlockId: null,
    blockType: "spacer",
    questionId: null,
    pageIndex: 0,
    sortOrder: 0,
    layout: {
      desktop: { col, row, colSpan: 12, rowSpan: 8, z: 0 },
      mobile: null,
    },
    style: {},
    props: {},
    isRequiredOverride: null,
    labelOverride: null,
    placeholderOverride: null,
    helpTextOverride: null,
    optionValueOverrides: null,
  };
}

function doc(blocks: FormBlock[] = []): FormDocument {
  return {
    pages: [{ index: 0, title: "About you", description: null }],
    theme: {
      pageBackground: "surface-page",
      padding: { top: 24, right: 24, bottom: 24, left: 24 },
      maxWidthPx: 880,
      card: {},
      field: {},
      headingColorToken: "brand-navy-ink",
      bodyColorToken: "neutral-800",
      accentColorToken: "brand-blue",
      showLogo: true,
      logoPosition: "center",
      logoHeightPx: 32,
      showBrandGradientBar: true,
    },
    blocks,
  };
}

let state: BuilderState;
beforeEach(() => {
  vi.useRealTimers();
  state = initialState(doc([block("a")]));
});

describe("editing", () => {
  it("adds a block and selects it", () => {
    const next = builderReducer(state, { type: "ADD_BLOCK", block: block("b") });
    expect(next.present.blocks).toHaveLength(2);
    expect(next.selectedIds).toEqual(["b"]);
  });

  it("deletes and clears the selection", () => {
    const next = builderReducer(
      { ...state, selectedIds: ["a"] },
      { type: "DELETE_BLOCKS", ids: ["a"] },
    );
    expect(next.present.blocks).toHaveLength(0);
    expect(next.selectedIds).toEqual([]);
  });

  it("moves every selected block by the same delta", () => {
    const many = initialState(doc([block("a"), block("b", 4)]));
    const next = builderReducer(many, {
      type: "MOVE_BLOCKS",
      ids: ["a", "b"],
      deltaCols: 2,
      deltaRows: 1,
    });
    expect(next.present.blocks.map((entry) => entry.layout.desktop.col)).toEqual([2, 6]);
  });

  it("drops a duplicate below the original, not on top of it", () => {
    const next = builderReducer(state, {
      type: "DUPLICATE_BLOCKS",
      ids: ["a"],
      newIds: ["a-copy"],
    });
    const copy = next.present.blocks.find((entry) => entry.id === "a-copy");
    expect(copy?.layout.desktop.row).toBeGreaterThan(0);
  });

  it("never duplicates a question reference — one block per question per form", () => {
    const withQuestion = initialState(
      doc([{ ...block("q"), blockType: "question", questionId: "question-1" }]),
    );
    const next = builderReducer(withQuestion, {
      type: "DUPLICATE_BLOCKS",
      ids: ["q"],
      newIds: ["q-copy"],
    });
    const copy = next.present.blocks.find((entry) => entry.id === "q-copy");
    expect(copy?.questionId).toBeNull();
  });
});

describe("undo and redo", () => {
  it("restores the previous document", () => {
    const added = builderReducer(state, { type: "ADD_BLOCK", block: block("b") });
    const undone = builderReducer(added, { type: "UNDO" });
    expect(undone.present.blocks).toHaveLength(1);
    const redone = builderReducer(undone, { type: "REDO" });
    expect(redone.present.blocks).toHaveLength(2);
  });

  it("is a no-op with nothing to undo", () => {
    expect(builderReducer(state, { type: "UNDO" })).toBe(state);
    expect(builderReducer(state, { type: "REDO" })).toBe(state);
  });

  it("re-selects what an undone delete brought back", () => {
    const deleted = builderReducer(
      { ...state, selectedIds: ["a"] },
      { type: "DELETE_BLOCKS", ids: ["a"] },
    );
    const undone = builderReducer({ ...deleted, selectedIds: ["a"] }, { type: "UNDO" });
    expect(undone.selectedIds).toEqual(["a"]);
  });

  it("discards the redo branch once a new edit happens", () => {
    const added = builderReducer(state, { type: "ADD_BLOCK", block: block("b") });
    const undone = builderReducer(added, { type: "UNDO" });
    const diverged = builderReducer(undone, { type: "ADD_BLOCK", block: block("c") });
    expect(diverged.future).toHaveLength(0);
  });
});

describe("coalescing", () => {
  it("collapses a rapid run of stepper ticks into ONE undo step", () => {
    // 24 ticks of a padding control must not become 24 undo steps.
    let current = state;
    for (let index = 1; index <= 24; index += 1) {
      current = builderReducer(current, {
        type: "SET_RECT",
        id: "a",
        rect: { col: index % 12 },
      });
    }
    expect(current.past).toHaveLength(1);
  });

  it("does NOT collapse across different targets", () => {
    const two = initialState(doc([block("a"), block("b")]));
    const first = builderReducer(two, { type: "SET_RECT", id: "a", rect: { col: 1 } });
    const second = builderReducer(first, { type: "SET_RECT", id: "b", rect: { col: 1 } });
    expect(second.past).toHaveLength(2);
  });

  it("never collapses an add or a delete", () => {
    const one = builderReducer(state, { type: "ADD_BLOCK", block: block("b") });
    const two = builderReducer(one, { type: "ADD_BLOCK", block: block("c") });
    expect(two.past).toHaveLength(2);
  });

  it("starts a new step once the window has passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-04T00:00:00Z"));
    const first = builderReducer(state, { type: "SET_RECT", id: "a", rect: { col: 1 } });
    vi.setSystemTime(new Date("2026-09-04T00:00:02Z")); // +2s, well past 500ms
    const second = builderReducer(first, { type: "SET_RECT", id: "a", rect: { col: 2 } });
    expect(second.past).toHaveLength(2);
    vi.useRealTimers();
  });
});

describe("dirty tracking", () => {
  it("is clean when nothing has changed", () => {
    expect(isDirty(state)).toBe(false);
  });

  it("is dirty after an edit", () => {
    const edited = builderReducer(state, { type: "ADD_BLOCK", block: block("b") });
    expect(isDirty(edited)).toBe(true);
  });

  it("is clean again after saving", () => {
    const edited = builderReducer(state, { type: "ADD_BLOCK", block: block("b") });
    const saved = builderReducer(edited, {
      type: "MARK_SAVED",
      document: edited.present,
    });
    expect(isDirty(saved)).toBe(false);
  });

  it("is clean after undoing back to the saved state", () => {
    const edited = builderReducer(state, { type: "ADD_BLOCK", block: block("b") });
    const undone = builderReducer(edited, { type: "UNDO" });
    expect(isDirty(undone)).toBe(false);
  });
});

describe("steps", () => {
  function threeSteps() {
    return initialState({
      ...doc(),
      pages: [
        { index: 0, title: "One", description: null },
        { index: 1, title: "Two", description: null },
        { index: 2, title: "Three", description: null },
      ],
      blocks: [
        { ...block("a"), pageIndex: 0 },
        { ...block("b"), pageIndex: 1 },
        { ...block("c"), pageIndex: 2 },
        { ...block("d"), pageIndex: 2 },
      ],
    });
  }

  it("adds a step at the end", () => {
    const next = builderReducer(threeSteps(), { type: "ADD_PAGE", title: "Four" });
    expect(next.present.pages.map((page) => page.title)).toEqual([
      "One",
      "Two",
      "Three",
      "Four",
    ]);
    expect(next.present.pages[3]?.index).toBe(3);
  });

  it("renames a step without touching its blocks", () => {
    const next = builderReducer(threeSteps(), {
      type: "RENAME_PAGE",
      index: 1,
      title: "Renamed",
      description: "Some help",
    });
    expect(next.present.pages[1]).toMatchObject({
      title: "Renamed",
      description: "Some help",
    });
    expect(next.present.blocks).toHaveLength(4);
  });

  it("deletes a step AND the blocks on it", () => {
    const next = builderReducer(threeSteps(), { type: "DELETE_PAGE", index: 2 });
    expect(next.present.pages).toHaveLength(2);
    // c and d lived on step 2 and go with it.
    expect(next.present.blocks.map((entry) => entry.id)).toEqual(["a", "b"]);
  });

  it("re-indexes so later blocks follow their own step, not a shifted one", () => {
    // The bug this guards: delete step 0 and, without re-indexing, the blocks
    // from steps 1 and 2 keep pageIndex 1 and 2 while the pages become 0 and 1
    // — every block lands on the wrong step, or on none at all.
    const next = builderReducer(threeSteps(), { type: "DELETE_PAGE", index: 0 });
    expect(next.present.pages.map((page) => page.index)).toEqual([0, 1]);
    const byId = new Map(next.present.blocks.map((entry) => [entry.id, entry]));
    expect(byId.get("b")?.pageIndex).toBe(0); // was step 1, now step 0
    expect(byId.get("c")?.pageIndex).toBe(1); // was step 2, now step 1
    expect(byId.get("d")?.pageIndex).toBe(1);
  });

  it("leaves a gap-free 0..n-1 sequence", () => {
    const next = builderReducer(threeSteps(), { type: "DELETE_PAGE", index: 1 });
    expect(next.present.pages.map((page) => page.index)).toEqual([0, 1]);
  });

  it("is undoable, blocks and all", () => {
    const deleted = builderReducer(threeSteps(), { type: "DELETE_PAGE", index: 2 });
    const undone = builderReducer(deleted, { type: "UNDO" });
    expect(undone.present.pages).toHaveLength(3);
    expect(undone.present.blocks).toHaveLength(4);
  });
});

/**
 * Per-form wording and choice overrides.
 *
 * The distinction these pin down: `null` means "use the question library", an
 * empty string does NOT. An admin who clears the Field name box is asking to
 * fall back, not to ship a form with a blank label — so the inspector maps ""
 * to null and the reducer stores exactly what it is given.
 */
describe("content overrides", () => {
  function questionState(): BuilderState {
    return initialState(
      doc([{ ...block("q"), blockType: "question", questionId: "question-1" }]),
    );
  }

  it("stores a per-form label without touching the question id", () => {
    const next = builderReducer(questionState(), {
      type: "SET_CONTENT_OVERRIDE",
      id: "q",
      patch: { labelOverride: "Your legal first name" },
    });
    const edited = next.present.blocks[0];
    expect(edited?.labelOverride).toBe("Your legal first name");
    // Still the same library question — an override is not a copy.
    expect(edited?.questionId).toBe("question-1");
  });

  it("patches one field at a time, leaving the others alone", () => {
    const withLabel = builderReducer(questionState(), {
      type: "SET_CONTENT_OVERRIDE",
      id: "q",
      patch: { labelOverride: "Name" },
    });
    const withHint = builderReducer(withLabel, {
      type: "SET_CONTENT_OVERRIDE",
      id: "q",
      patch: { placeholderOverride: "e.g. Maria" },
    });
    expect(withHint.present.blocks[0]).toMatchObject({
      labelOverride: "Name",
      placeholderOverride: "e.g. Maria",
    });
  });

  it("clears back to the library wording with null, not with an empty string", () => {
    const overridden = builderReducer(questionState(), {
      type: "SET_CONTENT_OVERRIDE",
      id: "q",
      patch: { labelOverride: "Name" },
    });
    const cleared = builderReducer(overridden, {
      type: "SET_CONTENT_OVERRIDE",
      id: "q",
      patch: { labelOverride: null },
    });
    expect(cleared.present.blocks[0]?.labelOverride).toBeNull();
  });

  it("keeps an empty help line as a real override", () => {
    // "" is a deliberate choice — hide the library's help text on this form.
    const next = builderReducer(questionState(), {
      type: "SET_CONTENT_OVERRIDE",
      id: "q",
      patch: { helpTextOverride: "" },
    });
    expect(next.present.blocks[0]?.helpTextOverride).toBe("");
  });

  it("stores a choice subset in the order given", () => {
    const next = builderReducer(questionState(), {
      type: "SET_CONTENT_OVERRIDE",
      id: "q",
      patch: { optionValueOverrides: ["full_time", "part_time"] },
    });
    expect(next.present.blocks[0]?.optionValueOverrides).toEqual([
      "full_time",
      "part_time",
    ]);
  });

  it("collapses a run of keystrokes into ONE undo step", () => {
    // Typing a label is 20 actions; undo must take it back in one press.
    let current = questionState();
    for (const value of ["Y", "Yo", "You", "Your"]) {
      current = builderReducer(current, {
        type: "SET_CONTENT_OVERRIDE",
        id: "q",
        patch: { labelOverride: value },
      });
    }
    expect(current.past).toHaveLength(1);
    expect(builderReducer(current, { type: "UNDO" }).present.blocks[0]?.labelOverride)
      .toBeNull();
  });

  it("marks the document dirty so the save button lights up", () => {
    const next = builderReducer(questionState(), {
      type: "SET_CONTENT_OVERRIDE",
      id: "q",
      patch: { labelOverride: "Name" },
    });
    expect(isDirty(next)).toBe(true);
  });
});

/**
 * Keeping a block as tall as what it renders.
 *
 * The canvas grid has fixed 8px rows, so a block that outgrows its row span
 * lands on top of the next one. Heights depend on the question library, which
 * is server state the reducer cannot see — so the caller measures and sends
 * `fitRowSpan` along with the edit that changed the content.
 */
describe("auto-fitting a block to its content", () => {
  function questionBlock(): BuilderState {
    return initialState(
      doc([{ ...block("q"), blockType: "question", questionId: "question-1" }]),
    );
  }

  it("grows the block in the same action that added the help text", () => {
    const next = builderReducer(questionBlock(), {
      type: "SET_CONTENT_OVERRIDE",
      id: "q",
      patch: { helpTextOverride: "Use the name on your passport." },
      fitRowSpan: 15,
    });
    expect(next.present.blocks[0]?.layout.desktop.rowSpan).toBe(15);
    // One action, so one undo step: a follow-up resize would cost two presses
    // and break the keystroke coalescing above.
    expect(next.past).toHaveLength(1);
  });

  it("never shrinks a block an author made taller on purpose", () => {
    const tall = initialState(
      doc([
        {
          ...block("q"),
          blockType: "question",
          questionId: "question-1",
          layout: {
            desktop: { col: 0, row: 0, colSpan: 12, rowSpan: 40, z: 0 },
            mobile: null,
          },
        },
      ]),
    );
    const next = builderReducer(tall, {
      type: "SET_CONTENT_OVERRIDE",
      id: "q",
      patch: { labelOverride: "Name" },
      fitRowSpan: 12,
    });
    expect(next.present.blocks[0]?.layout.desktop.rowSpan).toBe(40);
  });

  it("grows a heading as its text is typed", () => {
    const next = builderReducer(
      initialState(doc([{ ...block("h"), blockType: "heading" }])),
      {
        type: "SET_BLOCK_PROPS",
        id: "h",
        patch: { text: "About the work you are looking for" },
        fitRowSpan: 11,
      },
    );
    expect(next.present.blocks[0]?.layout.desktop.rowSpan).toBe(11);
  });
});

describe("tidying the layout", () => {
  it("re-places every block in ONE undo step", () => {
    const start = initialState(doc([block("a"), block("b", 0, 10)]));
    const next = builderReducer(start, {
      type: "SET_RECTS",
      changes: [
        { id: "a", rect: { col: 0, row: 0, colSpan: 24, rowSpan: 18, z: 0 } },
        { id: "b", rect: { col: 0, row: 20, colSpan: 24, rowSpan: 18, z: 0 } },
      ],
    });
    expect(next.present.blocks.map((entry) => entry.layout.desktop.row)).toEqual([0, 20]);
    expect(next.past).toHaveLength(1);
    expect(builderReducer(next, { type: "UNDO" }).present.blocks[1]?.layout.desktop.row)
      .toBe(10);
  });

  it("does nothing, and costs no undo step, when there is nothing to fix", () => {
    const start = initialState(doc([block("a")]));
    const next = builderReducer(start, { type: "SET_RECTS", changes: [] });
    expect(next).toBe(start);
    expect(isDirty(next)).toBe(false);
  });

  it("leaves blocks it was not asked about alone", () => {
    const start = initialState(doc([block("a"), block("b", 0, 10)]));
    const next = builderReducer(start, {
      type: "SET_RECTS",
      changes: [{ id: "a", rect: { col: 0, row: 0, colSpan: 24, rowSpan: 18, z: 0 } }],
    });
    expect(next.present.blocks[1]).toBe(start.present.blocks[1]);
  });
});

/**
 * Dropping a field onto another one must REARRANGE, not stack.
 *
 * Haider, 9 Sep, with screenshots: dragging "What should we call you?" onto
 * "Last name" left both at row 17 — 112px of overlap, one field rendering on
 * top of the other, its help text hidden behind the next field's label.
 *
 * The cause was that MOVE_BLOCKS translated the dragged rect and stopped: the
 * canvas places every block at an explicit `grid-row` on fixed 8px rows, so two
 * blocks sharing rows are drawn on top of each other. Nothing displaced.
 *
 * The rule these pin: the block you dropped keeps exactly the position you
 * dropped it at, and whatever it lands on moves down to make room.
 */
describe("dropping a block onto an occupied space", () => {
  /** Three stacked fields at the canvas's natural pitch: rows 0, 16, 32. */
  function stack(): FormDocument {
    return doc([
      { ...block("first", 0, 0), layout: { desktop: { col: 0, row: 0, colSpan: 24, rowSpan: 14, z: 0 }, mobile: null } },
      { ...block("last", 0, 16), layout: { desktop: { col: 0, row: 16, colSpan: 24, rowSpan: 14, z: 0 }, mobile: null } },
      { ...block("nickname", 0, 32), layout: { desktop: { col: 0, row: 32, colSpan: 24, rowSpan: 14, z: 0 }, mobile: null } },
    ]);
  }

  function rectOf(next: BuilderState, id: string) {
    const found = next.present.blocks.find((entry) => entry.id === id);
    if (found === undefined) throw new Error(`no block ${id}`);
    return found.layout.desktop;
  }

  /** Any two blocks sharing both a column range and a row range. */
  function overlappingPairs(next: BuilderState): string[] {
    const rects = next.present.blocks.map((entry) => ({ id: entry.id, ...entry.layout.desktop }));
    const pairs: string[] = [];
    for (let i = 0; i < rects.length; i += 1) {
      for (let j = i + 1; j < rects.length; j += 1) {
        const a = rects[i]!;
        const b = rects[j]!;
        if (
          a.col < b.col + b.colSpan && b.col < a.col + a.colSpan &&
          a.row < b.row + b.rowSpan && b.row < a.row + a.rowSpan
        ) {
          pairs.push(`${a.id}/${b.id}`);
        }
      }
    }
    return pairs;
  }

  it("leaves nothing overlapping when a field is dropped straight onto another", () => {
    // Exactly the reported drag: nickname (row 32) dropped onto last (row 16).
    const next = builderReducer(initialState(stack()), {
      type: "MOVE_BLOCKS",
      ids: ["nickname"],
      deltaCols: 0,
      deltaRows: -16,
    });
    expect(overlappingPairs(next)).toEqual([]);
  });

  it("keeps the dropped field where it was dropped and pushes the other down", () => {
    const next = builderReducer(initialState(stack()), {
      type: "MOVE_BLOCKS",
      ids: ["nickname"],
      deltaCols: 0,
      deltaRows: -16,
    });
    expect(rectOf(next, "nickname").row).toBe(16);
    // Below the dropped block, with the standard gap: 16 + 14 + 2.
    expect(rectOf(next, "last").row).toBe(32);
    // Untouched — it was never in the way.
    expect(rectOf(next, "first").row).toBe(0);
  });

  it("displaces a field dropped only partly over another", () => {
    // "near another question" from the report: a 6-row nudge, not a clean swap.
    const next = builderReducer(initialState(stack()), {
      type: "MOVE_BLOCKS",
      ids: ["nickname"],
      deltaCols: 0,
      deltaRows: -10,
    });
    expect(rectOf(next, "nickname").row).toBe(22);
    expect(overlappingPairs(next)).toEqual([]);
  });

  it("does not disturb anything when dropped into free space", () => {
    const next = builderReducer(initialState(stack()), {
      type: "MOVE_BLOCKS",
      ids: ["nickname"],
      deltaCols: 0,
      deltaRows: 20,
    });
    expect(rectOf(next, "first").row).toBe(0);
    expect(rectOf(next, "last").row).toBe(16);
    expect(rectOf(next, "nickname").row).toBe(52);
  });

  it("side-by-side fields in different columns never displace each other", () => {
    // Half-width pair on the same rows is a legitimate layout, not a collision.
    const sideBySide = doc([
      { ...block("left", 0, 0), layout: { desktop: { col: 0, row: 16, colSpan: 12, rowSpan: 14, z: 0 }, mobile: null } },
      { ...block("right", 12, 0), layout: { desktop: { col: 12, row: 32, colSpan: 12, rowSpan: 14, z: 0 }, mobile: null } },
    ]);
    const next = builderReducer(initialState(sideBySide), {
      type: "MOVE_BLOCKS",
      ids: ["right"],
      deltaCols: 0,
      deltaRows: -16,
    });
    expect(rectOf(next, "right").row).toBe(16);
    expect(rectOf(next, "left").row).toBe(16);
    expect(overlappingPairs(next)).toEqual([]);
  });
});

/**
 * Growing a field must push what is below it, for the same reason a drop does.
 *
 * Resizing has the identical failure mode to the drag bug above: RESIZE_BLOCK
 * changed the rectangle and stopped, so dragging a field's bottom edge down
 * over its neighbour drew the two on top of each other. Both gestures dispatch
 * exactly once, on release, so displacing here costs one pass per gesture.
 */
describe("growing a block over its neighbour", () => {
  function pair(): FormDocument {
    return doc([
      { ...block("first", 0, 0), layout: { desktop: { col: 0, row: 0, colSpan: 24, rowSpan: 14, z: 0 }, mobile: null } },
      { ...block("last", 0, 16), layout: { desktop: { col: 0, row: 16, colSpan: 24, rowSpan: 14, z: 0 }, mobile: null } },
    ]);
  }

  function rectOf(next: BuilderState, id: string) {
    const found = next.present.blocks.find((entry) => entry.id === id);
    if (found === undefined) throw new Error(`no block ${id}`);
    return found.layout.desktop;
  }

  it("pushes the block below down instead of drawing over it", () => {
    const next = builderReducer(initialState(pair()), {
      type: "RESIZE_BLOCK",
      id: "first",
      edge: "s",
      deltaCols: 0,
      deltaRows: 8,
    });
    expect(rectOf(next, "first").rowSpan).toBe(22);
    // 0 + 22 + the standard 2-row gap.
    expect(rectOf(next, "last").row).toBe(24);
  });

  it("leaves the neighbour alone when a block is made shorter", () => {
    const next = builderReducer(initialState(pair()), {
      type: "RESIZE_BLOCK",
      id: "first",
      edge: "s",
      deltaCols: 0,
      deltaRows: -4,
    });
    expect(rectOf(next, "last").row).toBe(16);
  });
});

describe("undoing a drop that displaced something", () => {
  it("restores the dropped block AND what it pushed, in one step", () => {
    // The displacement rides on the same action, so it must not cost a second
    // Ctrl+Z — an author who undoes a drag expects the page back as it was.
    const start = initialState(
      doc([
        { ...block("first", 0, 0), layout: { desktop: { col: 0, row: 0, colSpan: 24, rowSpan: 14, z: 0 }, mobile: null } },
        { ...block("last", 0, 16), layout: { desktop: { col: 0, row: 16, colSpan: 24, rowSpan: 14, z: 0 }, mobile: null } },
        { ...block("nickname", 0, 32), layout: { desktop: { col: 0, row: 32, colSpan: 24, rowSpan: 14, z: 0 }, mobile: null } },
      ]),
    );
    const moved = builderReducer(start, {
      type: "MOVE_BLOCKS",
      ids: ["nickname"],
      deltaCols: 0,
      deltaRows: -16,
    });
    expect(moved.present.blocks.find((b) => b.id === "last")?.layout.desktop.row).toBe(32);

    const undone = builderReducer(moved, { type: "UNDO" });
    const rows = Object.fromEntries(
      undone.present.blocks.map((b) => [b.id, b.layout.desktop.row]),
    );
    expect(rows).toEqual({ first: 0, last: 16, nickname: 32 });
  });
});
