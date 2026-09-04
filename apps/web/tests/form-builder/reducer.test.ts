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
