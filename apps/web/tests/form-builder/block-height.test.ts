/**
 * Fields that do not fit the box they were given.
 *
 * The canvas grid has FIXED 8px rows, so a block taller than `rowSpan × 8` is
 * not pushed down — it renders on top of the block below it. Every new block
 * used to be created 8 rows tall (64px) whatever it contained, and a bare
 * label plus an input is already 63px. Anything with help text, and every
 * question that renders as a list of choices, overlapped.
 *
 * These tests pin the arithmetic, not the components: jsdom reports every
 * height as zero, so nothing here could be measured from a render.
 */
import { describe, expect, it } from "vitest";
import { MIN_ROW_SPAN } from "@sdb/contracts";
import type {
  CanvasRect,
  FormBlock,
  FormTheme,
  IntakeFormQuestion,
} from "@sdb/contracts";
import {
  blockWidthPx,
  canvasContentWidthPx,
  fittedRowSpan,
  naturalRowSpan,
  tidyBlocks,
} from "@/features/form-builder/block-height";

const theme: FormTheme = {
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
};

function rect(overrides: Partial<CanvasRect> = {}): CanvasRect {
  return { col: 0, row: 0, colSpan: 24, rowSpan: 8, z: 0, ...overrides };
}

function block(
  id: string,
  overrides: Partial<FormBlock> = {},
  layout: Partial<CanvasRect> = {},
): FormBlock {
  return {
    id,
    parentBlockId: null,
    blockType: "question",
    questionId: `q-${id}`,
    pageIndex: 0,
    sortOrder: 0,
    layout: { desktop: rect(layout), mobile: null },
    style: {},
    props: {},
    isRequiredOverride: null,
    labelOverride: null,
    placeholderOverride: null,
    helpTextOverride: null,
    optionValueOverrides: null,
    ...overrides,
  };
}

function question(
  overrides: Partial<IntakeFormQuestion> = {},
): IntakeFormQuestion {
  return {
    id: "q-1",
    key: "first_name",
    label: "First name",
    helpText: null,
    placeholder: null,
    questionType: "short_text",
    isRequired: true,
    sortOrder: 0,
    validation: {},
    options: [],
    conditional: null,
    ...overrides,
  };
}

function choices(count: number): { value: string; label: string }[] {
  return Array.from({ length: count }, (_, index) => ({
    value: `o${String(index)}`,
    label: `Option ${String(index)}`,
  }));
}

const rows = (b: FormBlock, q: IntakeFormQuestion | null): number | null =>
  naturalRowSpan(b, q, theme);

describe("how tall a question needs to be", () => {
  it("needs more than the 8 rows every block used to get", () => {
    // The whole bug in one assertion: the old default did not fit even the
    // simplest possible field.
    expect(rows(block("a"), question())).toBeGreaterThan(8);
  });

  it("grows for help text", () => {
    const bare = rows(block("a"), question());
    const helped = rows(
      block("a"),
      question({ helpText: "Use the name on your passport." }),
    );
    expect(helped).toBeGreaterThan(bare!);
  });

  it("gives a five-choice select room for all five radio buttons", () => {
    // ≤5 options renders as a radio LIST, not a dropdown — the case that
    // overlapped most visibly on the seeded registration form.
    const listed = rows(block("a"), question({
      questionType: "single_select",
      options: choices(5),
    }))!;
    expect(listed).toBeGreaterThanOrEqual(17);
  });

  it("does not inflate a long list, which renders as one control", () => {
    // 251 countries is a searchable box the height of a text input, so it must
    // NOT be measured as 251 rows of radio buttons.
    const long = rows(block("a"), question({
      questionType: "single_select",
      options: choices(251),
    }))!;
    const short = rows(block("a"), question())!;
    expect(long).toBe(short);
  });

  it("counts checkboxes up to the group threshold and not beyond", () => {
    const eight = rows(block("a"), question({
      questionType: "multi_select",
      options: choices(8),
    }))!;
    const nine = rows(block("a"), question({
      questionType: "multi_select",
      options: choices(9),
    }))!;
    expect(eight).toBeGreaterThan(nine);
  });

  it("makes room for a three-line textarea", () => {
    expect(rows(block("a"), question({ questionType: "long_text" }))!).toBeGreaterThan(
      rows(block("a"), question())!,
    );
  });

  it("adds the character counter only when maxLength is set", () => {
    const plain = rows(block("a"), question({ questionType: "long_text" }))!;
    const counted = rows(
      block("a"),
      question({ questionType: "long_text", validation: { maxLength: 500 } }),
    )!;
    expect(counted).toBeGreaterThan(plain);
  });

  it("wraps a long scale onto a second row of pills in a narrow block", () => {
    const wide = rows(
      block("a", {}, { colSpan: 24 }),
      question({ questionType: "scale", validation: { scaleMin: 1, scaleMax: 10 } }),
    )!;
    const narrow = rows(
      block("a", {}, { colSpan: 4 }),
      question({ questionType: "scale", validation: { scaleMin: 1, scaleMax: 10 } }),
    )!;
    expect(narrow).toBeGreaterThan(wide);
  });

  it("wraps a long label in a narrow column", () => {
    const long = question({
      label:
        "What is the maximum number of hours you are available to work each week?",
    });
    expect(rows(block("a", {}, { colSpan: 6 }), long)!).toBeGreaterThan(
      rows(block("a", {}, { colSpan: 24 }), long)!,
    );
  });

  it("uses the per-form wording it is given, not the library's", () => {
    // The caller resolves overrides before measuring, so a block that hides
    // three of five choices is measured as a two-choice question.
    const trimmed = question({
      questionType: "single_select",
      options: choices(2),
    });
    const full = question({ questionType: "single_select", options: choices(5) });
    expect(rows(block("a"), trimmed)!).toBeLessThan(rows(block("a"), full)!);
  });

  it("leaves a block alone while its question is still loading", () => {
    expect(rows(block("a"), null)).toBeNull();
  });

  it("leaves a spacer at whatever height it was given", () => {
    // A spacer IS its row span — measuring it would defeat the point of it.
    expect(rows(block("a", { blockType: "spacer", questionId: null }), null)).toBeNull();
  });

  it("keeps a divider at the floor", () => {
    const divider = block("a", { blockType: "divider", questionId: null });
    expect(rows(divider, null)).toBe(MIN_ROW_SPAN);
  });

  it("sizes a heading from its level and its text", () => {
    const short = block("a", {
      blockType: "heading",
      questionId: null,
      props: { text: "About you", level: 2 },
    });
    const wrapped = block("a", {
      blockType: "heading",
      questionId: null,
      props: { text: "About you and the work you are looking for right now", level: 1 },
    });
    expect(rows(wrapped, null)!).toBeGreaterThan(rows(short, null)!);
  });

  it("counts the newlines in a paragraph", () => {
    const oneLine = block("a", {
      blockType: "paragraph",
      questionId: null,
      props: { text: "Tell us about you." },
    });
    const threeLines = block("a", {
      blockType: "paragraph",
      questionId: null,
      props: { text: "One.\nTwo.\nThree." },
    });
    expect(rows(threeLines, null)!).toBeGreaterThan(rows(oneLine, null)!);
  });
});

describe("fittedRowSpan never shrinks a block", () => {
  it("keeps the extra height an author dragged in", () => {
    const tall = block("a", {}, { rowSpan: 40 });
    expect(fittedRowSpan(tall, question(), theme)).toBe(40);
  });

  it("grows one that is too short", () => {
    const short = block("a", {}, { rowSpan: MIN_ROW_SPAN });
    expect(fittedRowSpan(short, question(), theme)).toBeGreaterThan(MIN_ROW_SPAN);
  });
});

describe("block width", () => {
  it("follows the theme's max width and padding", () => {
    expect(canvasContentWidthPx(theme)).toBe(832);
    expect(blockWidthPx(12, 832)).toBeLessThan(blockWidthPx(24, 832));
  });
});

describe("tidying a page", () => {
  const resolve = (b: FormBlock) =>
    b.blockType === "question" ? question() : null;

  it("reports nothing to do on a form that already fits", () => {
    const blocks = [
      block("a", {}, { row: 0, rowSpan: 12 }),
      block("b", {}, { row: 14, rowSpan: 12 }),
    ];
    expect(tidyBlocks(blocks, resolve, theme)).toEqual([]);
  });

  it("grows a short block and pushes what follows it down", () => {
    const blocks = [
      block("a", {}, { row: 0, rowSpan: 8 }),
      block("b", {}, { row: 10, rowSpan: 8 }),
    ];
    const changes = tidyBlocks(blocks, resolve, theme);
    const byId = new Map(changes.map((change) => [change.id, change.rect]));

    const first = byId.get("a")!;
    expect(first.rowSpan).toBeGreaterThan(8);
    // Whatever came next now starts below it, with a gap.
    expect(byId.get("b")!.row).toBeGreaterThanOrEqual(first.row + first.rowSpan);
  });

  it("keeps side-by-side fields side by side", () => {
    const left = block("a", {}, { row: 0, col: 0, colSpan: 12, rowSpan: 8 });
    const right = block("b", {}, { row: 0, col: 12, colSpan: 12, rowSpan: 8 });
    const below = block("c", {}, { row: 10, rowSpan: 8 });

    const byId = new Map(
      tidyBlocks([left, right, below], resolve, theme).map((c) => [c.id, c.rect]),
    );
    // Both halves of the row keep their column and share a row.
    expect(byId.get("a")?.row ?? 0).toBe(byId.get("b")?.row ?? 0);
    expect(byId.get("a")?.col ?? 0).toBe(0);
    expect(byId.get("b")?.col ?? 12).toBe(12);
    // And the field beneath clears the taller of the two.
    expect(byId.get("c")!.row).toBeGreaterThan(byId.get("a")!.row);
  });

  it("separates two full-width fields that were sitting on each other", () => {
    // Same columns and overlapping rows is the bug, not a deliberate stack —
    // so these must NOT be treated as one side-by-side band.
    const a = block("a", {}, { row: 0, rowSpan: 20 });
    const b = block("b", {}, { row: 2, rowSpan: 20 });
    const byId = new Map(
      tidyBlocks([a, b], resolve, theme).map((c) => [c.id, c.rect]),
    );
    expect(byId.get("b")!.row).toBeGreaterThanOrEqual(20);
  });

  it("never pulls a block upward, so deliberate whitespace survives", () => {
    const blocks = [
      block("a", {}, { row: 0, rowSpan: 12 }),
      block("b", {}, { row: 60, rowSpan: 12 }),
    ];
    expect(tidyBlocks(blocks, resolve, theme)).toEqual([]);
  });

  it("tidies each step on its own", () => {
    const first = block("a", { pageIndex: 0 }, { row: 0, rowSpan: 8 });
    const second = block("b", { pageIndex: 1 }, { row: 0, rowSpan: 8 });
    const byId = new Map(
      tidyBlocks([first, second], resolve, theme).map((c) => [c.id, c.rect]),
    );
    // Step 2 starts at the top of step 2, not below step 1's content.
    expect(byId.get("b")!.row).toBe(0);
  });
});

/**
 * Regressions found by review, each of which put the overlap bug back.
 *
 * Every one of these is the same failure shape: the model returns a number
 * SMALLER than what renders, so the block overlaps its neighbour AND the
 * "Tidy layout" banner stays silent, because the banner compares against this
 * same arithmetic. An under-estimate is therefore invisible twice over.
 */
describe("heights that were being under-counted", () => {
  it("makes room for the accepted-types line on a file upload", () => {
    // The drop zone renders a THIRD paragraph — "Accepted: PDF · Max 10 MB" —
    // whenever the question declares either rule. Modelling it at a flat two
    // lines left every such question 26px short.
    const plain = rows(block("a"), question({ questionType: "file_upload" }))!;
    const limited = rows(
      block("a"),
      question({ questionType: "file_upload", validation: { maxFileSizeMb: 10 } }),
    )!;
    expect(limited).toBeGreaterThan(plain);

    const typed = rows(
      block("a"),
      question({
        questionType: "file_upload",
        validation: { acceptedMimeTypes: ["application/pdf"] },
      }),
    )!;
    expect(typed).toBeGreaterThan(plain);
  });

  it("wraps the drop zone's own copy in a narrow column", () => {
    const wide = rows(
      block("a", {}, { colSpan: 24 }),
      question({ questionType: "file_upload" }),
    )!;
    const narrow = rows(
      block("a", {}, { colSpan: 8 }),
      question({ questionType: "file_upload" }),
    )!;
    expect(narrow).toBeGreaterThan(wide);
  });

  it("counts the '(optional)' the shell appends to the label", () => {
    // RequiredMark adds " (optional)" — eleven characters that wrap the line
    // exactly like the label does. A required question gets only " *", so at a
    // label length that sits just under one line, the two must differ.
    const label = "What is your current monthly salary expectation?";
    const optional = rows(
      block("a", {}, { colSpan: 12 }),
      question({ label, isRequired: false }),
    )!;
    const required = rows(
      block("a", {}, { colSpan: 12 }),
      question({ label, isRequired: true }),
    )!;
    expect(optional).toBeGreaterThan(required);
  });

  it("grows a textarea when the block's own padding is increased", () => {
    // form-canvas.css applies --sdb-field-pad-* to textareas at a specificity
    // that beats the component's py-2, and a rows={3} textarea has no fixed
    // height — so the Style panel's padding stepper really does make it taller.
    const plain = rows(block("a"), question({ questionType: "long_text" }))!;
    const padded = rows(
      block("a", {
        style: { padding: { top: 24, right: 0, bottom: 24, left: 0 } },
      }),
      question({ questionType: "long_text" }),
    )!;
    expect(padded).toBeGreaterThan(plain);
  });

  it("leaves an h-9 input alone when padding changes, because it cannot grow", () => {
    const plain = rows(block("a"), question())!;
    const padded = rows(
      block("a", {
        style: { padding: { top: 24, right: 0, bottom: 24, left: 0 } },
      }),
      question(),
    )!;
    expect(padded).toBe(plain);
  });
});

/**
 * Tidying must not touch a layout that renders correctly.
 *
 * The first implementation grouped blocks into horizontal bands and re-pitched
 * the bands. A band closed as soon as a block started a few rows below its top,
 * so a COLUMN of fields beside one tall field was not preserved — everything
 * below the first row was shoved past the tall block. Worse, it reported those
 * moves as "fields too short to fit", on a page where nothing overlapped.
 */
describe("tidying leaves correct layouts alone", () => {
  const resolve = (b: FormBlock) =>
    b.blockType === "question" ? question() : null;

  it("keeps a column of fields beside a tall one exactly where it is", () => {
    const tall = block("tall", {}, { row: 0, col: 0, colSpan: 12, rowSpan: 40 });
    const right = [0, 12, 24].map((row, index) =>
      block(`r${String(index)}`, {}, { row, col: 12, colSpan: 12, rowSpan: 10 }),
    );
    expect(tidyBlocks([tall, ...right], resolve, theme)).toEqual([]);
  });

  it("keeps a side-by-side pair whose rows were nudged out of line", () => {
    // An admin drops the right-hand field 4 rows lower so its input lines up
    // under a two-line label on the left. Disjoint columns never collide, so
    // there is nothing to repair.
    const left = block("l", {}, { row: 10, col: 0, colSpan: 12, rowSpan: 12 });
    const right = block("r", {}, { row: 14, col: 12, colSpan: 12, rowSpan: 10 });
    expect(tidyBlocks([left, right], resolve, theme)).toEqual([]);
  });

  it("still separates two blocks that genuinely sit on each other", () => {
    const a = block("a", {}, { row: 0, col: 0, colSpan: 24, rowSpan: 20 });
    const b = block("b", {}, { row: 2, col: 0, colSpan: 24, rowSpan: 20 });
    const byId = new Map(
      tidyBlocks([a, b], resolve, theme).map((c) => [c.id, c.rect]),
    );
    expect(byId.get("b")!.row).toBeGreaterThanOrEqual(22);
    expect(byId.has("a")).toBe(false);
  });

  it("clears the lowest blocker in one move, not one at a time", () => {
    // Two stacked blocks on the left, one incoming block spanning both their
    // columns: it must land below the LOWER of them.
    const first = block("f", {}, { row: 0, col: 0, colSpan: 24, rowSpan: 12 });
    const second = block("s", {}, { row: 14, col: 0, colSpan: 24, rowSpan: 12 });
    const dropped = block("d", {}, { row: 4, col: 0, colSpan: 24, rowSpan: 10 });
    const byId = new Map(
      tidyBlocks([first, second, dropped], resolve, theme).map((c) => [c.id, c.rect]),
    );
    // 'd' sorts after 'f' and before 's' by row, so it clears 'f' — and then
    // 's', which it now collides with, must move clear of 'd' in turn.
    const d = byId.get("d") ?? dropped.layout.desktop;
    const s = byId.get("s") ?? second.layout.desktop;
    expect(s.row).toBeGreaterThanOrEqual(d.row + d.rowSpan);
  });
});

describe("a repeating group is sized for its base state", () => {
  /** The seeded skills-and-tools shape: three columns, minRows 0. */
  const repeatingGroup = (minRows = 0) =>
    question({
      key: "skills_and_tools",
      label: "First name",
      questionType: "repeating_group",
      validation: {
        repeatingGroup: {
          columns: [
            {
              key: "skill",
              label: "Skill",
              columnType: "single_select",
              isRequired: true,
              widthWeight: 2,
              choices: { from: "question_options" },
            },
            {
              key: "proficiency",
              label: "Proficiency",
              columnType: "single_select",
              isRequired: true,
              widthWeight: 1,
              choices: {
                from: "inline",
                options: [{ value: "expert", label: "Expert" }],
              },
            },
            {
              key: "notes",
              label: "Notes",
              columnType: "short_text",
              isRequired: false,
              widthWeight: 3,
            },
          ],
          minRows,
          maxRows: 20,
          addRowLabel: "Add another",
        },
      },
    });

  it("reserves one row, the header and the add button — not maxRows", () => {
    /*
     * label 21 + stack 6 + (header 18 + stack 6 + row 36 + add 40) + breathing 6
     * = 133px, which is 17 grid rows. Reserving all 20 rows would be ~660px of
     * hole on a table most candidates fill with two entries.
     */
    expect(rows(block("a"), repeatingGroup())).toBe(17);
  });

  it("needs more room than the same label on a plain text field", () => {
    const table = rows(block("a"), repeatingGroup())!;
    const plain = rows(block("a"), question())!;
    expect(table).toBeGreaterThan(plain);
  });

  it("grows with minRows, because those rows render before anyone types", () => {
    const one = rows(block("a"), repeatingGroup(1))!;
    const three = rows(block("a"), repeatingGroup(3))!;
    expect(three).toBeGreaterThan(one);
  });
});
