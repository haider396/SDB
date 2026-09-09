/**
 * Rendering a stored repeating-group answer.
 *
 * Everything here reads `question_snapshot`, never a live question (03 §1.4).
 * The snapshot fixtures deliberately carry a column label and an option label
 * that no live question would produce, so a test that passed by reading the
 * live definition could not pass here (AC-FB-08).
 */
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AnswerTable } from "@/components/patterns/answer-table";
import {
  readRepeatingGroup,
  renderAnswerValue,
  type SnapshotAnswer,
} from "@/lib/answer-value";

/** The snapshot as buildSnapshot writes it: choices resolved inline. */
const SNAPSHOT = {
  questionKey: "skills_and_tools",
  label: "Skills & tools",
  questionType: "repeating_group",
  categoryKey: "candidate_skills",
  repeatingGroup: {
    columns: [
      {
        key: "skill",
        label: "Skill as it was asked",
        columnType: "single_select",
        isRequired: true,
        widthWeight: 2,
        choices: {
          from: "inline",
          options: [{ value: "ClickUp", label: "ClickUp (as labelled then)" }],
        },
      },
      {
        key: "proficiency",
        label: "Proficiency as it was asked",
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
        label: "Notes as they were asked",
        columnType: "short_text",
        isRequired: false,
        widthWeight: 3,
      },
    ],
    minRows: 0,
    maxRows: 20,
  },
};

function answer(
  rows: unknown,
  snapshot: Record<string, unknown> = SNAPSHOT,
): SnapshotAnswer {
  return {
    questionSnapshot: snapshot,
    selectedOptions: [],
    valueText: null,
    valueNumber: null,
    valueBoolean: null,
    valueDate: null,
    valueJson: { rows },
  };
}

describe("renderAnswerValue on a repeating group", () => {
  it("returns a plain-text row count rather than [object Object]", () => {
    const rows = Array.from({ length: 6 }, () => ({ skill: "ClickUp" }));
    expect(renderAnswerValue(answer(rows))).toBe("6 rows");
  });

  it("says 'row' for exactly one", () => {
    expect(renderAnswerValue(answer([{ skill: "ClickUp" }]))).toBe("1 row");
  });

  it("gives two different row sets two different strings", () => {
    // supersededKeys() in form-submissions-card.tsx compares these strings to
    // decide whether a later application changed an answer. A constant would
    // make every repeating group look unchanged forever.
    expect(renderAnswerValue(answer([{ skill: "ClickUp" }]))).not.toBe(
      renderAnswerValue(answer([{ skill: "ClickUp" }, { skill: "Notion" }])),
    );
  });
});

describe("readRepeatingGroup", () => {
  it("returns null when the snapshot has no repeatingGroup key", () => {
    // EVERY answer stored before this feature is this case, which is why no
    // existing row can take the new path.
    expect(
      readRepeatingGroup(answer([{ skill: "ClickUp" }], { label: "Old" })),
    ).toBeNull();
  });

  it("returns null when the stored value is not a row list", () => {
    expect(
      readRepeatingGroup({ ...answer([]), valueJson: { fileIds: ["a"] } }),
    ).toBeNull();
  });

  it("returns the snapshot's columns and the stored rows", () => {
    const result = readRepeatingGroup(answer([{ skill: "ClickUp" }]));
    expect(result?.columns.map((column) => column.key)).toEqual([
      "skill",
      "proficiency",
      "notes",
    ]);
    expect(result?.rows).toEqual([{ skill: "ClickUp" }]);
  });
});

describe("AnswerTable", () => {
  it("renders the SNAPSHOT's column headings and option labels (AC-FB-08)", () => {
    render(
      <AnswerTable
        answer={answer([
          { skill: "ClickUp", proficiency: "expert", notes: "Ran the migration" },
        ])}
        caption="Skills & tools"
      />,
    );
    const table = screen.getByRole("table", { name: "Skills & tools" });
    expect(
      within(table).getByRole("columnheader", { name: "Skill as it was asked" }),
    ).toBeInTheDocument();
    expect(
      within(table).getByText("ClickUp (as labelled then)"),
    ).toBeInTheDocument();
    expect(within(table).getByText("Expert")).toBeInTheDocument();
    expect(within(table).getByText("Ran the migration")).toBeInTheDocument();
  });

  it("renders the raw value when it is not in the snapshot's option list", () => {
    // An answer must never disappear because an option was renamed or the
    // snapshot's resolved list is missing one.
    render(<AnswerTable answer={answer([{ skill: "Notion" }])} />);
    expect(screen.getByText("Notion")).toBeInTheDocument();
  });

  it("shows an empty cell as a dash rather than nothing", () => {
    render(<AnswerTable answer={answer([{ skill: "ClickUp" }])} />);
    // proficiency and notes were left blank, so they are omitted from the row.
    expect(screen.getAllByText("—")).toHaveLength(2);
  });

  it("states the empty case rather than rendering a headings-only table", () => {
    render(<AnswerTable answer={answer([])} />);
    expect(screen.getByText(/nothing was added/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });

  it("falls back to the plain text value when the snapshot cannot be read", () => {
    // A repeating-group answer whose snapshot predates the column definitions
    // still has to show SOMETHING. Rendering nothing loses the answer.
    render(
      <AnswerTable
        answer={answer([{ skill: "ClickUp" }], { label: "Old" })}
      />,
    );
    expect(screen.getByText("1 row")).toBeInTheDocument();
  });
});
