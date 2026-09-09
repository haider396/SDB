/**
 * How tall a block has to be for what it actually renders.
 *
 * ── Why this exists ────────────────────────────────────────────────────────
 * The canvas grid has FIXED 8px rows (form-canvas.css: `grid-auto-rows: 8px`)
 * and every block is placed at an explicit grid row. So a block whose content
 * is taller than `rowSpan × 8px` does NOT push the next one down — it spills
 * over it. `rowSpan` is not a hint; it is the whole layout contract.
 *
 * `defaults.ts` handed every new block `rowSpan: 8` — 64px. A bare label plus
 * an input is already 63px, so anything carrying help text, and every question
 * that renders as a list of choices, overlapped the block beneath it.
 * Migration 0022 repaired the SEEDED form's rows; nothing repaired the code
 * that writes new ones, so every form built in the app inherited the bug.
 *
 * ── Reading the numbers ────────────────────────────────────────────────────
 * Each constant names the component and utility class it mirrors. Font sizes
 * come from tokens.css (`--text-sm` = 0.875rem) and line heights from the
 * Tailwind fontSize config (sm/xs are `--leading-normal`, 1.5).
 *
 * They are rounded UP on purpose: over-estimating costs a few pixels of gap,
 * under-estimating costs an overlapping form. The unit tests pin the
 * arithmetic here, not the components — so if a field component changes shape,
 * this file has to be updated by hand. That is the trade for keeping the whole
 * calculation pure: jsdom reports every height as zero, so a DOM measurement
 * could not be tested at all.
 */
import {
  CANVAS_COLUMNS,
  MIN_ROW_SPAN,
  type CanvasRect,
  type FormBlock,
  type FormTheme,
  type IntakeFormQuestion,
  type RepeatingGroupConfig,
} from "@sdb/contracts";
import { MAX_ROW, MAX_ROW_SPAN } from "./geometry";

/**
 * form-canvas.css `grid-auto-rows: 8px`.
 *
 * EXPORTED because layout-growth.ts converts pixels of fill-time growth into
 * grid rows, and the grid's row height is the conversion factor. A second copy
 * of the number there would be wrong the day the grid changes, and wrong by
 * exactly the amount that makes blocks overlap.
 */
export const CANVAS_ROW_PX = 8;

/* ── Shared chrome ───────────────────────────────────────────────────────── */

/** <Label> / <legend>: text-sm (14px) × leading-normal (1.5). */
const LABEL_PX = 21;
/** Help text and inline errors: text-xs (12px) × 1.5. */
const CAPTION_PX = 18;
/** InputShell / GroupShell `space-y-1.5`. */
const STACK_GAP_PX = 6;
/**
 * One line of slack per field. Labels wrap, browsers disagree about control
 * metrics by a pixel or two, and a form that is 2px short still looks broken.
 */
const BREATHING_PX = 6;

/* ── Controls ────────────────────────────────────────────────────────────── */

/** <Input> and <NativeSelect>: `h-9`. Fixed height, so padding never adds. */
const CONTROL_PX = 36;
/**
 * The runtime fallback for a question type this file has not been taught —
 * only reachable if the type reaches the data without a rebuild, since the
 * `never` guard in `controlPx` makes it a compile error otherwise. Generous on
 * purpose: an over-tall block wastes a little canvas, an under-tall one
 * overlaps the field beneath it.
 */
const UNKNOWN_CONTROL_PX = 120;
/** <Textarea>: `min-h-[4.5rem]`. */
const TEXTAREA_MIN_PX = 72;
/** `--sdb-field-pad-*` and `--sdb-field-border-width` defaults in form-canvas.css. */
const FIELD_PAD_DEFAULT_PX = 4;
const FIELD_BORDER_DEFAULT_PX = 1;
/** long_text's character counter, shown only when maxLength is set. */
const COUNTER_PX = CAPTION_PX;
/** One radio/checkbox row: a text-sm label beside an `h-4` control. */
const CHOICE_PX = 21;
/** RadioOptions / CheckboxOptions `space-y-2`. */
const CHOICE_GAP_PX = 8;
/** SegmentedControl: one row of `h-8` pills. */
const SEGMENT_ROW_PX = 32;
/** Its `p-1` on both sides plus the 1px border on both sides. */
const SEGMENT_FRAME_PX = 10;
/** `gap-1`, which flex-wrap applies to rows as well as columns. */
const SEGMENT_GAP_PX = 4;
/** `min-w-9` (36px) is the floor; `px-3` adds 24px around the label. */
const SEGMENT_MIN_PX = 36;
const SEGMENT_PAD_PX = 24;
/** Rough advance width of one text-sm character in the medium weight. */
const CHAR_PX = 8;

/**
 * currency_range's body: a stretched SegmentedControl, a row of two labelled
 * amount inputs, and the "amounts are per hour" caption, at `space-y-3`.
 */
const CURRENCY_BODY_PX =
  SEGMENT_ROW_PX +
  SEGMENT_FRAME_PX +
  12 +
  (CAPTION_PX + 4 + CONTROL_PX) +
  12 +
  CAPTION_PX;

/**
 * file_upload's dashed drop zone: `py-8` on both sides plus a 1px border, an
 * `h-6` icon, and two or THREE lines of copy at `gap-2`.
 *
 * The third — "Accepted: PDF · Max 10 MB" — renders only when the question
 * declares `acceptedMimeTypes` or `maxFileSizeMb`, and the question editor
 * offers both for this type (question-manager/guard-rails.ts). Modelling the
 * zone at a flat two lines left every file question with a size limit 26px
 * short: this bug in miniature, inside its own fix.
 *
 * The copy is spelled out because its LENGTH is what decides the wrap, and in
 * a narrow column both lines wrap several times.
 */
const FILE_ZONE_FRAME_PX = 64 + 2;
const FILE_ZONE_ICON_PX = 24;
/** The zone's `gap-2`. */
const FILE_ZONE_GAP_PX = 8;
/** Its `px-6`, both sides. */
const FILE_ZONE_PAD_X = 48;
/** `max-w-sm` caps the explanatory line at 24rem however wide the block is. */
const FILE_ZONE_BODY_MAX_PX = 384;
const FILE_ZONE_HEADLINE = "File upload is not available on this form yet.";
const FILE_ZONE_BODY =
  "You can share files with your Staffing Done Better contact after submitting — this won't hold up your request.";

/* ── Content blocks ──────────────────────────────────────────────────────── */

/** tokens.css `--text-*`, in pixels. */
const FONT_PX: Record<string, number> = {
  "2xs": 11,
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 30,
  "4xl": 36,
};

/** blocks.tsx HEADING_DEFAULT_SIZE. */
const HEADING_SIZE: Record<number, string> = {
  1: "3xl",
  2: "2xl",
  3: "xl",
  4: "lg",
};

/** `.sdb-block-heading { line-height: var(--leading-tight) }`. */
const HEADING_LEADING = 1.25;
/** `.sdb-block-paragraph { line-height: var(--leading-relaxed) }`. */
const PARAGRAPH_LEADING = 1.625;
/** `.sdb-block-divider`: a 1px rule with 8px of margin above and below. */
const DIVIDER_PX = 17;

/* ── Thresholds, mirroring the field components ──────────────────────────── */

/** select-fields.tsx RADIO_GROUP_MAX_OPTIONS — above this, a select control. */
const RADIO_GROUP_MAX_OPTIONS = 5;
/** multi-select-field.tsx CHECKBOX_GROUP_MAX_OPTIONS — above this, a combobox. */
const CHECKBOX_GROUP_MAX_OPTIONS = 8;

/* ── Width ───────────────────────────────────────────────────────────────── */

/** `.sdb-canvas-node { padding: 0 6px }`. */
const NODE_PAD_PX = 12;

/** The canvas inner width: the theme max width less the form padding. */
export function canvasContentWidthPx(theme: FormTheme): number {
  return Math.max(240, theme.maxWidthPx - theme.padding.left - theme.padding.right);
}

/** How wide one block renders, given its column span. */
export function blockWidthPx(colSpan: number, canvasWidthPx: number): number {
  const share = (colSpan / CANVAS_COLUMNS) * canvasWidthPx;
  return Math.max(80, Math.round(share) - NODE_PAD_PX);
}

/** Wrapped line count for a run of text at a given font size and width. */
function lineCount(text: string, fontPx: number, widthPx: number): number {
  const perLine = Math.max(1, Math.floor(widthPx / (fontPx * 0.55)));
  return text
    .split("\n")
    .reduce(
      (total, line) => total + Math.max(1, Math.ceil(line.length / perLine)),
      0,
    );
}

/* ── Heights ─────────────────────────────────────────────────────────────── */

function choiceListPx(count: number): number {
  // A select with no choices yet still reserves a line, so the block does not
  // collapse and then overlap the moment the first choice is added.
  if (count <= 0) return CHOICE_PX;
  return count * CHOICE_PX + (count - 1) * CHOICE_GAP_PX;
}

function fileZonePx(question: IntakeFormQuestion, widthPx: number): number {
  const inner = Math.max(80, widthPx - FILE_ZONE_PAD_X);
  const headline =
    lineCount(FILE_ZONE_HEADLINE, FONT_PX.sm ?? 14, inner) * LABEL_PX;
  const body =
    lineCount(
      FILE_ZONE_BODY,
      FONT_PX.xs ?? 12,
      Math.min(inner, FILE_ZONE_BODY_MAX_PX),
    ) * CAPTION_PX;
  const hint =
    question.validation.acceptedMimeTypes !== undefined ||
    question.validation.maxFileSizeMb !== undefined
      ? FILE_ZONE_GAP_PX + CAPTION_PX
      : 0;
  return (
    FILE_ZONE_FRAME_PX +
    FILE_ZONE_ICON_PX +
    FILE_ZONE_GAP_PX +
    headline +
    FILE_ZONE_GAP_PX +
    body +
    hint
  );
}

/**
 * The one control with no fixed height, so per-block padding and border width
 * genuinely grow it — form-canvas.css applies `--sdb-field-pad-*` to textareas
 * at a specificity that beats the component's own `py-2`. `<Input>` and
 * `<NativeSelect>` are `h-9` and do not move, which is why only this one reads
 * the block's style.
 */
function textareaPx(style: FormBlock["style"]): number {
  const padTop = style.padding?.top ?? FIELD_PAD_DEFAULT_PX;
  const padBottom = style.padding?.bottom ?? FIELD_PAD_DEFAULT_PX;
  const border = (style.borderWidth ?? FIELD_BORDER_DEFAULT_PX) * 2;
  // `rows={3}` at the text-sm line height.
  return Math.max(TEXTAREA_MIN_PX, 3 * LABEL_PX + padTop + padBottom + border);
}

/** One row of cell controls in a repeating group: an h-9 Input. */
const RG_ROW_PX = CONTROL_PX;
/** The header row: one line of text-xs. */
const RG_HEADER_PX = CAPTION_PX;
/** The rows' `space-y-2`. */
const RG_ROW_GAP_PX = 8;
/** The "Add another" button: `py-1.5` around a text-sm line, plus the gap above it. */
const RG_ADD_PX = 32 + 8;

/**
 * Pixels one extra row adds — the row plus the gap above it.
 *
 * EXPORTED because layout-growth.ts converts "the candidate added three rows"
 * into grid rows, and a private copy of this number there would drift the
 * first time the row control changes height.
 */
export const RG_ROW_PITCH_PX = RG_ROW_PX + RG_ROW_GAP_PX;

/**
 * The rows a repeating-group block is SIZED for.
 *
 * EXPORTED because layout-growth.ts measures fill-time growth from exactly
 * this baseline. Two opinions about the base state would show up as a block
 * that is one row short and overlaps the field beneath it — which is the whole
 * failure this module exists to prevent.
 */
export function repeatingGroupBaseRows(config: RepeatingGroupConfig): number {
  return Math.max(config.minRows, 1);
}

/**
 * A repeating group is sized for its BASE state — max(minRows, 1) rows. Rows
 * added at fill time are handled by shiftForGrowth (form-builder/layout-growth.ts),
 * which pushes down only the blocks that collide. Reserving maxRows here would
 * leave a ~900px hole on every form for a table someone fills with two rows.
 */
function repeatingGroupPx(config: RepeatingGroupConfig): number {
  const rows = repeatingGroupBaseRows(config);
  return (
    RG_HEADER_PX +
    STACK_GAP_PX +
    rows * RG_ROW_PX +
    (rows - 1) * RG_ROW_GAP_PX +
    RG_ADD_PX
  );
}

function segmentedPx(labels: readonly string[], widthPx: number): number {
  const widest = labels.reduce(
    (max, label) =>
      Math.max(max, SEGMENT_MIN_PX, label.length * CHAR_PX + SEGMENT_PAD_PX),
    SEGMENT_MIN_PX,
  );
  const perRow = Math.max(1, Math.floor(widthPx / (widest + SEGMENT_GAP_PX)));
  const rows = Math.max(1, Math.ceil(labels.length / perRow));
  return rows * SEGMENT_ROW_PX + (rows - 1) * SEGMENT_GAP_PX + SEGMENT_FRAME_PX;
}

/** Just the control, without the label and help text the shell adds. */
function controlPx(
  question: IntakeFormQuestion,
  widthPx: number,
  style: FormBlock["style"],
): number {
  const optionCount = question.options.length;

  switch (question.questionType) {
    case "long_text":
      return (
        textareaPx(style) +
        (question.validation.maxLength !== undefined
          ? STACK_GAP_PX + COUNTER_PX
          : 0)
      );

    case "single_select":
      // Five choices or fewer render as radios; anything above is a select or
      // a type-to-filter box, both of which are one control tall.
      return optionCount <= RADIO_GROUP_MAX_OPTIONS
        ? choiceListPx(optionCount)
        : CONTROL_PX;

    case "multi_select":
      return optionCount <= CHECKBOX_GROUP_MAX_OPTIONS
        ? choiceListPx(optionCount)
        : CONTROL_PX;

    case "yes_no":
      return segmentedPx(["Yes", "No"], widthPx);

    case "scale": {
      const min = question.validation.scaleMin ?? 1;
      const max = question.validation.scaleMax ?? 5;
      const steps = Array.from(
        { length: Math.max(max - min + 1, 1) },
        (_, index) => String(min + index),
      );
      const hasCaptions =
        question.validation.scaleMinLabel !== undefined ||
        question.validation.scaleMaxLabel !== undefined;
      return (
        segmentedPx(steps, widthPx) + (hasCaptions ? STACK_GAP_PX + CAPTION_PX : 0)
      );
    }

    case "currency_range":
      return CURRENCY_BODY_PX;

    case "file_upload":
      return fileZonePx(question, widthPx);

    case "short_text":
    case "email":
    case "phone":
    case "number":
    case "date":
      // A single h-9 control.
      return CONTROL_PX;

    case "repeating_group": {
      const config = question.validation.repeatingGroup;
      // A repeating group with no columns is a misconfiguration the API
      // rejects; size it as one empty row rather than collapsing the block.
      return config === undefined
        ? RG_HEADER_PX + STACK_GAP_PX + RG_ROW_PX + RG_ADD_PX
        : repeatingGroupPx(config);
    }

    default: {
      /*
       * Every question type must be measured here, and the `never` assignment
       * is what forces it: adding a member to QuestionType makes this line a
       * COMPILE error until someone gives the new type a height.
       *
       * It used to be a `default:` returning CONTROL_PX, which meant a new
       * type would silently get a 36px box and render on top of whatever sat
       * below it — the exact failure this module exists to prevent, and
       * invisible, because the "Tidy layout" banner compares against this
       * same arithmetic. `question-field.tsx` guards the renderer the same
       * way; this guards the geometry.
       */
      const unhandled: never = question.questionType;
      void unhandled;
      // Should one ever reach here at runtime — a type added to the data
      // without a rebuild — over-estimate. Too tall wastes a little space;
      // too short corrupts the form.
      return UNKNOWN_CONTROL_PX;
    }
  }
}

/**
 * The label as it is actually rendered.
 *
 * Both shells draw `{label}<RequiredMark/>`, and RequiredMark appends "*" or a
 * whole " (optional)" — eleven characters that wrap the line exactly like the
 * label does. Measuring `label` alone left every optional question whose label
 * nearly fills a line one line short, which is most of the library.
 */
const REQUIRED_MARK = " *";
const OPTIONAL_MARK = " (optional)";

function renderedLabel(question: IntakeFormQuestion): string {
  return question.label + (question.isRequired ? REQUIRED_MARK : OPTIONAL_MARK);
}

/** A whole question field: label, optional help text, and the control. */
export function questionHeightPx(
  question: IntakeFormQuestion,
  widthPx: number,
  style: FormBlock["style"] = {},
): number {
  const labelLines = lineCount(renderedLabel(question), FONT_PX.sm ?? 14, widthPx);
  const help =
    question.helpText === null || question.helpText === ""
      ? 0
      : STACK_GAP_PX +
        lineCount(question.helpText, FONT_PX.xs ?? 12, widthPx) * CAPTION_PX;
  return (
    labelLines * LABEL_PX +
    help +
    STACK_GAP_PX +
    controlPx(question, widthPx, style) +
    BREATHING_PX
  );
}

/**
 * How tall this block needs to be, in pixels — or null when its height is the
 * author's to choose (a spacer IS its row span; an image has no known size).
 */
export function contentHeightPx(
  block: FormBlock,
  question: IntakeFormQuestion | null,
  theme: FormTheme,
): number | null {
  const widthPx = blockWidthPx(
    block.layout.desktop.colSpan,
    canvasContentWidthPx(theme),
  );

  switch (block.blockType) {
    case "question":
      // A block whose question has not loaded (or has been retired) keeps the
      // height it has: guessing would resize it on every slow network.
      return question === null
        ? null
        : questionHeightPx(question, widthPx, block.style);

    case "heading": {
      const level = block.props.level ?? 2;
      const size = block.style.fontSize ?? HEADING_SIZE[level] ?? "2xl";
      const fontPx = FONT_PX[size] ?? 24;
      const lines = lineCount(block.props.text ?? "", fontPx, widthPx);
      return Math.ceil(lines * fontPx * HEADING_LEADING) + BREATHING_PX;
    }

    case "paragraph": {
      const fontPx = FONT_PX[block.style.fontSize ?? "sm"] ?? 14;
      const lines = lineCount(block.props.text ?? "", fontPx, widthPx);
      return Math.ceil(lines * fontPx * PARAGRAPH_LEADING) + BREATHING_PX;
    }

    case "divider":
      return DIVIDER_PX;

    default:
      // spacer, image, row, group.
      return null;
  }
}

/** Rows this block needs, or null when its height is the author's to choose. */
export function naturalRowSpan(
  block: FormBlock,
  question: IntakeFormQuestion | null,
  theme: FormTheme,
): number | null {
  const px = contentHeightPx(block, question, theme);
  if (px === null) return null;
  return Math.min(
    MAX_ROW_SPAN,
    Math.max(MIN_ROW_SPAN, Math.ceil(px / CANVAS_ROW_PX)),
  );
}

/**
 * The row span a block should have — never SMALLER than the one it has.
 *
 * An author who dragged a field taller meant it. Auto-layout only ever adds
 * the space content needs; taking space away is a decision, not a repair.
 */
export function fittedRowSpan(
  block: FormBlock,
  question: IntakeFormQuestion | null,
  theme: FormTheme,
): number {
  const natural = naturalRowSpan(block, question, theme);
  if (natural === null) return block.layout.desktop.rowSpan;
  return Math.max(block.layout.desktop.rowSpan, natural);
}

/* ── Tidying a whole page ────────────────────────────────────────────────── */

/** Rows of clear space left between two stacked blocks — matches nextFreeRow. */
export const BLOCK_GAP_ROWS = 2;

/** Resolves the question a block shows, with this form's overrides applied. */
export type QuestionResolver = (block: FormBlock) => IntakeFormQuestion | null;

interface Vertical {
  row: number;
  rowSpan: number;
}

/**
 * Two rectangles share at least one canvas column.
 *
 * EXPORTED for layout-growth.ts, which asks exactly this question at fill
 * time. A private copy there would be one more place to forget when the grid
 * changes, and the two answering differently is precisely how a block ends up
 * rendered on top of another.
 */
export function columnsOverlap(a: CanvasRect, b: CanvasRect): boolean {
  return a.col < b.col + b.colSpan && b.col < a.col + a.colSpan;
}

function rowsOverlap(a: Vertical, b: Vertical): boolean {
  return a.row < b.row + b.rowSpan && b.row < a.row + a.rowSpan;
}

export interface RectChange {
  id: string;
  rect: CanvasRect;
}

/**
 * Make room for blocks that have just been dropped somewhere occupied.
 *
 * ── The bug this closes ────────────────────────────────────────────────────
 * Dragging a field onto another one used to translate the dragged rectangle and
 * stop. The canvas gives every block an explicit `grid-row` on fixed 8px rows,
 * so two blocks sharing rows are simply drawn on top of each other — the field
 * underneath "went behind" the one dropped on it, help text hidden behind the
 * next label. Nothing displaced, and the only way out was the Tidy layout
 * banner, which describes a HEIGHT problem and so read as unrelated.
 *
 * ── The rule ───────────────────────────────────────────────────────────────
 * What you dropped stays exactly where you dropped it; whatever it lands on
 * moves down. `pinnedIds` are placed first at their given rectangles, then
 * every other block is placed in reading order and pushed down only far enough
 * to clear what is already down — the same collision walk `tidyBlocks` uses, so
 * side-by-side columns still never interact and nothing is ever pulled upward.
 *
 * Heights are deliberately untouched: a drag should move things, not resize
 * them. Growing a block to fit its content stays `tidyBlocks`'s job.
 */
export function displaceOverlaps(
  blocks: readonly FormBlock[],
  pinnedIds: readonly string[],
): RectChange[] {
  const pinned = new Set(pinnedIds);
  const changes: RectChange[] = [];

  for (const pageIndex of new Set(blocks.map((block) => block.pageIndex))) {
    const onPage = blocks.filter((block) => block.pageIndex === pageIndex);
    // Nothing was dropped on this page, so nothing can need to move.
    if (!onPage.some((block) => pinned.has(block.id))) continue;

    const placed: CanvasRect[] = onPage
      .filter((block) => pinned.has(block.id))
      .map((block) => block.layout.desktop);

    const rest = onPage
      .filter((block) => !pinned.has(block.id))
      .sort((a, b) => {
        const ar = a.layout.desktop;
        const br = b.layout.desktop;
        return ar.row - br.row || ar.col - br.col || a.id.localeCompare(b.id);
      });

    for (const block of rest) {
      const rect = block.layout.desktop;
      let row = rect.row;

      // Clearing one blocker can land on the next, so repeat — bounded by the
      // number already placed, since each pass clears at least one.
      for (let pass = 0; pass <= placed.length; pass += 1) {
        const blocker = placed
          .filter(
            (other) =>
              columnsOverlap(other, rect) &&
              rowsOverlap(other, { row, rowSpan: rect.rowSpan }),
          )
          .reduce<CanvasRect | null>(
            (lowest, other) =>
              lowest === null ||
              other.row + other.rowSpan > lowest.row + lowest.rowSpan
                ? other
                : lowest,
            null,
          );
        if (blocker === null) break;
        row = Math.min(MAX_ROW, blocker.row + blocker.rowSpan + BLOCK_GAP_ROWS);
      }

      const next: CanvasRect = { ...rect, row };
      placed.push(next);
      if (row !== rect.row) changes.push({ id: block.id, rect: next });
    }
  }

  return changes;
}

/**
 * Grow every block to fit its content, then move only what has to move so
 * nothing overlaps — returning ONLY the rectangles that actually change.
 *
 * ── Why collisions rather than rows ────────────────────────────────────────
 * The obvious algorithm is to group blocks into horizontal "bands" and re-pitch
 * the bands. It is wrong, and it was wrong here: a band closes as soon as a
 * block starts a few rows below its top, so a COLUMN of short fields beside one
 * tall field is not a preserved side-by-side arrangement — only its first row
 * is. Everything below gets shoved past the tall block, leaving a crater in the
 * right-hand column, and the builder reports "changes" on a form that renders
 * perfectly, which teaches an admin to ignore the banner.
 *
 * So: place each block in reading order, and push it down ONLY far enough to
 * clear blocks already placed that share a column with it. Two blocks in
 * disjoint columns never interact however their rows line up, which is what
 * side-by-side actually means — no tolerance to tune, no bands to get wrong.
 *
 * What is preserved: every column and width, the order down the page, any
 * side-by-side or multi-row column arrangement, deliberate extra height, and
 * deliberate whitespace (nothing is ever pulled upward). What changes: heights
 * too small for their content, and the position of blocks that genuinely
 * collide.
 *
 * An empty result means the page is already clean — which is how the builder
 * decides whether to offer the repair at all.
 */
export function tidyBlocks(
  blocks: readonly FormBlock[],
  resolve: QuestionResolver,
  theme: FormTheme,
): RectChange[] {
  const changes: RectChange[] = [];
  const pages = [...new Set(blocks.map((block) => block.pageIndex))];

  for (const pageIndex of pages) {
    const onPage = blocks
      .filter((block) => block.pageIndex === pageIndex)
      .sort((a, b) => {
        const ar = a.layout.desktop;
        const br = b.layout.desktop;
        return ar.row - br.row || ar.col - br.col || a.id.localeCompare(b.id);
      });

    const placed: CanvasRect[] = [];
    for (const block of onPage) {
      const rect = block.layout.desktop;
      const rowSpan = fittedRowSpan(block, resolve(block), theme);
      let row = rect.row;

      // Clearing one blocker can land on the next, so repeat — bounded by the
      // number of blocks already placed, since each pass clears at least one.
      for (let pass = 0; pass <= placed.length; pass += 1) {
        const blocker = placed
          .filter(
            (other) =>
              columnsOverlap(other, rect) && rowsOverlap(other, { row, rowSpan }),
          )
          // Clear the lowest of them in one move rather than one at a time.
          .reduce<CanvasRect | null>(
            (lowest, other) =>
              lowest === null ||
              other.row + other.rowSpan > lowest.row + lowest.rowSpan
                ? other
                : lowest,
            null,
          );
        if (blocker === null) break;
        row = Math.min(MAX_ROW, blocker.row + blocker.rowSpan + BLOCK_GAP_ROWS);
      }

      const next: CanvasRect = { ...rect, row, rowSpan };
      placed.push(next);
      if (row !== rect.row || rowSpan !== rect.rowSpan) {
        changes.push({ id: block.id, rect: next });
      }
    }
  }

  return changes;
}
