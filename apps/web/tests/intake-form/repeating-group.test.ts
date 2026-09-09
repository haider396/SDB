/**
 * The pure repeating-group helpers and the Zod schema built from a question's
 * column definitions. No render: option resolution and issue paths are
 * arithmetic, and jsdom is not where arithmetic should be verified.
 */
import { describe, expect, it } from "vitest";
import type { RepeatingGroupColumn } from "@sdb/contracts";
import {
  columnOptions,
  isEmptyRow,
  readRows,
  repeatingGroupConfig,
  toRowErrors,
} from "@/features/intake-form/repeating-group";
import { repeatingGroupSchema } from "@/features/intake-form/schema-builder";
import { makeQuestion, makeRepeatingGroupQuestion } from "./helpers";

const skillColumn: RepeatingGroupColumn = {
  key: "skill",
  label: "Skill",
  columnType: "single_select",
  isRequired: true,
  widthWeight: 2,
  choices: { from: "question_options" },
};

describe("repeatingGroupConfig", () => {
  it("returns null for a question with no repeatingGroup rules", () => {
    expect(repeatingGroupConfig(makeQuestion({ key: "q" }))).toBeNull();
  });

  it("returns the config for a repeating-group question", () => {
    const question = makeRepeatingGroupQuestion({ key: "skills" });
    expect(repeatingGroupConfig(question)?.columns).toHaveLength(3);
  });
});

describe("columnOptions", () => {
  it("reads the question's own options for a question_options column", () => {
    const question = makeRepeatingGroupQuestion({
      key: "skills",
      options: [{ value: "ClickUp", label: "ClickUp" }],
    });
    expect(columnOptions(question, skillColumn)).toEqual([
      { value: "ClickUp", label: "ClickUp" },
    ]);
  });

  it("reads inline options for an inline column", () => {
    const question = makeRepeatingGroupQuestion({ key: "skills" });
    const inline: RepeatingGroupColumn = {
      key: "proficiency",
      label: "Proficiency",
      columnType: "single_select",
      isRequired: true,
      widthWeight: 1,
      choices: { from: "inline", options: [{ value: "expert", label: "Expert" }] },
    };
    expect(columnOptions(question, inline)).toEqual([
      { value: "expert", label: "Expert" },
    ]);
  });

  it("returns an empty list for a non-choice column", () => {
    const notes: RepeatingGroupColumn = {
      key: "notes",
      label: "Notes",
      columnType: "short_text",
      isRequired: false,
      widthWeight: 3,
    };
    expect(columnOptions(makeRepeatingGroupQuestion({ key: "s" }), notes)).toEqual(
      [],
    );
  });
});

describe("readRows", () => {
  it("returns the rows of a well-formed value", () => {
    expect(readRows({ rows: [{ skill: "ClickUp" }] })).toEqual([
      { skill: "ClickUp" },
    ]);
  });

  it("returns [] for the undefined a react-hook-form field starts as", () => {
    expect(readRows(undefined)).toEqual([]);
  });

  it("returns [] for a bare array rather than treating it as rows", () => {
    expect(readRows([{ skill: "ClickUp" }])).toEqual([]);
  });
});

describe("isEmptyRow", () => {
  it("is true for a row with no answered cell", () => {
    expect(isEmptyRow({})).toBe(true);
    expect(isEmptyRow({ skill: "", notes: undefined })).toBe(true);
  });

  it("is false as soon as one cell carries a value", () => {
    expect(isEmptyRow({ skill: "ClickUp" })).toBe(false);
    expect(isEmptyRow({ year: 0 })).toBe(false);
  });
});

describe("toRowErrors", () => {
  it("flattens react-hook-form's nested rows error object", () => {
    expect(
      toRowErrors({
        rows: {
          0: { proficiency: { message: "This field is required." } },
          2: { skill: { message: "Choose one of the provided options." } },
        },
      }),
    ).toEqual([
      { rowIndex: 0, columnKey: "proficiency", message: "This field is required." },
      { rowIndex: 2, columnKey: "skill", message: "Choose one of the provided options." },
    ]);
  });

  it("returns [] for anything that is not a rows error bag", () => {
    expect(toRowErrors(undefined)).toEqual([]);
    expect(toRowErrors({ message: "Add at least one row." })).toEqual([]);
  });
});

describe("repeatingGroupSchema", () => {
  const question = makeRepeatingGroupQuestion({
    key: "skills",
    options: [{ value: "ClickUp", label: "ClickUp" }],
  });

  it("accepts a valid row set", () => {
    const result = repeatingGroupSchema(question).safeParse({
      rows: [{ skill: "ClickUp", proficiency: "expert", notes: "Ran the migration" }],
    });
    expect(result.success).toBe(true);
  });

  it("puts the issue path on the failing row and column", () => {
    const result = repeatingGroupSchema(question).safeParse({
      rows: [{ skill: "ClickUp" }, { skill: "ClickUp", proficiency: "expert" }],
    });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.path).toEqual(["rows", 0, "proficiency"]);
  });

  it("rejects a choice value that is not an option", () => {
    const result = repeatingGroupSchema(question).safeParse({
      rows: [{ skill: "Notion", proficiency: "expert" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more rows than maxRows", () => {
    const rows = Array.from({ length: 21 }, () => ({
      skill: "ClickUp",
      proficiency: "expert",
    }));
    expect(repeatingGroupSchema(question).safeParse({ rows }).success).toBe(false);
  });

  it("accepts an empty table when minRows is 0", () => {
    expect(repeatingGroupSchema(question).safeParse({ rows: [] }).success).toBe(
      true,
    );
  });
});

/**
 * A month column is the one cell type whose control (<input type="month">)
 * can never produce a value the regex was meant to reject — so a broken regex
 * only ever shows up as "every employment date is invalid", with nothing on
 * screen to explain it. Pinned here rather than trusted.
 */
describe("repeatingGroupSchema — month columns", () => {
  const question = makeRepeatingGroupQuestion({
    key: "employment_history",
    validation: {
      repeatingGroup: {
        columns: [
          {
            key: "started_on",
            label: "From",
            columnType: "month",
            isRequired: true,
            widthWeight: 1,
          },
        ],
        minRows: 0,
        maxRows: 10,
        addRowLabel: "Add another",
      },
    },
  });

  it("accepts a YYYY-MM value", () => {
    const result = repeatingGroupSchema(question).safeParse({
      rows: [{ started_on: "2024-03" }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a full date and a 13th month", () => {
    const schema = repeatingGroupSchema(question);
    expect(schema.safeParse({ rows: [{ started_on: "2024-03-11" }] }).success).toBe(
      false,
    );
    expect(schema.safeParse({ rows: [{ started_on: "2024-13" }] }).success).toBe(
      false,
    );
  });
});
