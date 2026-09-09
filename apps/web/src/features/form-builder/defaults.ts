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

/**
 * The floor for a question block: label (21px) + gap + an `h-9` control, plus
 * a line of slack. Anything taller than its row span spills over the block
 * below — see block-height.ts — so 8 rows was never enough for a real field.
 * Callers that know the question pass its measured height instead.
 */
export const DEFAULT_QUESTION_ROW_SPAN = 9;

/**
 * Row spans for a freshly added content block, which has no text yet. Text
 * blocks grow as an admin types (the builder re-fits them on every props
 * change); a divider and a spacer are as tall as they are told to be.
 */
const NEW_BLOCK_ROW_SPAN: Partial<Record<FormBlockType, number>> = {
  heading: 6,
  paragraph: 6,
  divider: MIN_ROW_SPAN,
  spacer: MIN_ROW_SPAN,
  image: 20,
};

/** A full-width block at the given row — what "add" produces. */
export function defaultRect(row: number, rowSpan = DEFAULT_QUESTION_ROW_SPAN): CanvasRect {
  return { col: 0, row, colSpan: 24, rowSpan: Math.max(MIN_ROW_SPAN, rowSpan), z: 0 };
}

/** Client-side ids. crypto.randomUUID exists in browsers and in jsdom 25. */
export function newBlockId(): string {
  return crypto.randomUUID();
}

/**
 * A new block, `rowSpan` tall — or tall enough for its type when the caller
 * cannot say. A question block's caller knows the question and should measure
 * it (block-height.ts `naturalRowSpan`); the fallback is the plain-field floor.
 */
export function makeBlock(
  blockType: FormBlockType,
  pageIndex: number,
  row: number,
  extra: Partial<FormBlock> = {},
  rowSpan = NEW_BLOCK_ROW_SPAN[blockType] ?? DEFAULT_QUESTION_ROW_SPAN,
): FormBlock {
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
