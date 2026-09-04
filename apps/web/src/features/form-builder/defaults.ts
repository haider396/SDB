/**
 * Builder defaults.
 *
 * ⚠ Token NAMES only, never colour values. The rendered appearance of a default
 * comes from the var() fallback chain in form-canvas.css, so a brand change is
 * a stylesheet edit with no code change and no data migration — and there is no
 * hex anywhere in TypeScript for AC-UI-01 to catch.
 */
import {
  CANVAS_ROW_PX,
  MIN_ROW_SPAN,
  type CanvasRect,
  type FormBlock,
  type FormBlockType,
} from "@sdb/contracts";

export const CANVAS_ROW_PX_VALUE = CANVAS_ROW_PX;

export type ResizeEdge = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw";

/** A full-width block at the given row — what "add" produces. */
export function defaultRect(row: number, rowSpan = 8): CanvasRect {
  return { col: 0, row, colSpan: 24, rowSpan: Math.max(MIN_ROW_SPAN, rowSpan), z: 0 };
}

/** Client-side ids. crypto.randomUUID exists in browsers and in jsdom 25. */
export function newBlockId(): string {
  return crypto.randomUUID();
}

export function makeBlock(
  blockType: FormBlockType,
  pageIndex: number,
  row: number,
  extra: Partial<FormBlock> = {},
): FormBlock {
  const rowSpan = blockType === "divider" || blockType === "spacer" ? MIN_ROW_SPAN : 8;
  return {
    id: newBlockId(),
    parentBlockId: null,
    blockType,
    questionId: null,
    pageIndex,
    sortOrder: row,
    layout: { desktop: defaultRect(row, rowSpan), mobile: null },
    style: {},
    props: {},
    isRequiredOverride: null,
    // Per-form overrides start unset: the block uses the library wording and
    // every choice until an admin says otherwise.
    labelOverride: null,
    placeholderOverride: null,
    helpTextOverride: null,
    optionValueOverrides: null,
    ...extra,
  };
}

/** Palette entries. Fields come from the question library, not from here. */
export const CONTENT_BLOCKS: { type: FormBlockType; label: string }[] = [
  { type: "heading", label: "Heading" },
  { type: "paragraph", label: "Description" },
  { type: "divider", label: "Divider" },
  { type: "spacer", label: "Spacer" },
];

/**
 * Composite presets. "Sub fields" in Haider's words: one question rendered as
 * several boxes on a row.
 *
 * These are a LAYOUT construct — each part is a real, separate question placed
 * side by side. That keeps first_name / last_name projecting onto their own
 * candidate columns, and means the validator, the snapshots and the submit
 * pipeline need no knowledge of composites at all.
 */
export const COMPOSITE_PRESETS: {
  label: string;
  description: string;
  questionKeys: string[];
  spans: number[];
}[] = [
  {
    label: "Full name",
    description: "First and last name on one row",
    questionKeys: ["first_name", "last_name"],
    spans: [12, 12],
  },
  {
    label: "Location",
    description: "Country, region and city on one row",
    questionKeys: ["country", "region_state", "city"],
    spans: [8, 8, 8],
  },
  {
    label: "Contact",
    description: "Email and phone side by side",
    questionKeys: ["email", "phone"],
    spans: [12, 12],
  },
];
