/**
 * The top-of-form summary and the focus helper behind it (05 §4.4).
 *
 * A repeating group is the only question type where "the field that failed"
 * is not a single control, so the summary has to be able to name — and land
 * on — one cell out of a table (spec §7.4).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  ErrorSummary,
  focusField,
  type SummaryEntry,
} from "@/features/intake-form/components/error-summary";
import { cellFieldId } from "@/features/intake-form/components/fields/field-shell";

afterEach(cleanup);

const CELL_ENTRY: SummaryEntry = {
  questionKey: "skills_and_tools",
  label: "Skills & tools",
  message: "This field is required.",
  rowIndex: 1,
  columnKey: "proficiency",
  columnLabel: "Proficiency",
};

function renderSummary(
  entries: readonly SummaryEntry[],
  onNavigateToField = vi.fn(),
) {
  render(
    <ErrorSummary
      summary="Some answers need attention."
      entries={entries}
      requestId={null}
      onNavigateToField={onNavigateToField}
    />,
  );
  return { onNavigateToField };
}

describe("ErrorSummary", () => {
  it("renders an ordinary field entry unchanged", () => {
    renderSummary([
      {
        questionKey: "hours_per_week",
        label: "Hours per week",
        message: "Must be at most 60.",
      },
    ]);
    const link = screen.getByRole("link", {
      name: "Hours per week: Must be at most 60.",
    });
    expect(link).toHaveAttribute("href", "#field-hours_per_week");
  });

  it("names the row and the column for a repeating-group cell", () => {
    renderSummary([CELL_ENTRY]);
    // Row 2, not row 1: rowIndex is zero-based, the reader counts from one.
    expect(
      screen.getByRole("link", {
        name: "Skills & tools — row 2, Proficiency: This field is required.",
      }),
    ).toBeInTheDocument();
  });

  it("anchors a cell entry at that exact input", () => {
    renderSummary([CELL_ENTRY]);
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `#${cellFieldId("skills_and_tools", 1, "proficiency")}`,
    );
  });

  it("hands the cell to the navigate callback so the host can focus it", async () => {
    const user = userEvent.setup();
    const { onNavigateToField } = renderSummary([CELL_ENTRY]);
    await user.click(screen.getByRole("link"));
    expect(onNavigateToField).toHaveBeenCalledWith("skills_and_tools", {
      rowIndex: 1,
      columnKey: "proficiency",
    });
  });

  it("lists several failing cells of the same question separately", () => {
    renderSummary([
      CELL_ENTRY,
      { ...CELL_ENTRY, rowIndex: 3, columnKey: "skill", columnLabel: "Skill" },
    ]);
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });
});

describe("focusField", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  function mountFieldset() {
    document.body.innerHTML = `
      <fieldset id="field-skills_and_tools">
        <select id="field-skills_and_tools-r0-skill"></select>
        <input id="field-skills_and_tools-r1-proficiency" />
      </fieldset>`;
  }

  it("focuses the exact cell when one is named", () => {
    mountFieldset();
    focusField("skills_and_tools", { rowIndex: 1, columnKey: "proficiency" });
    expect(document.activeElement?.id).toBe(
      "field-skills_and_tools-r1-proficiency",
    );
  });

  it("focuses the first control in the fieldset when no cell is named", () => {
    mountFieldset();
    focusField("skills_and_tools");
    expect(document.activeElement?.id).toBe("field-skills_and_tools-r0-skill");
  });

  it("falls back to the fieldset's first control when the cell has gone", () => {
    mountFieldset();
    // A row removed between the failed submit and the click on the summary.
    focusField("skills_and_tools", { rowIndex: 9, columnKey: "proficiency" });
    expect(document.activeElement?.id).toBe("field-skills_and_tools-r0-skill");
  });
});
