/**
 * The repeating-group control: structure, add, remove, the empty state, and —
 * the part that is easy to get wrong and impossible to retrofit — where focus
 * lands afterwards (AC-FB-09, AC-UI-04).
 *
 * Every interaction here is driven by keyboard or by a real click on a named
 * control. There is no pointer gesture to exercise, which is the point: a
 * table you can only fill with a mouse is not done.
 */
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IntakeFormQuestion } from "@sdb/contracts";
import {
  addRowId,
  cellFieldId,
  cellRemoveId,
} from "@/features/intake-form/components/fields/field-shell";
import { RepeatingGroupField } from "@/features/intake-form/components/fields/repeating-group-field";
import { makeRepeatingGroupQuestion } from "./helpers";

const KEY = "skills_and_tools";

const byId = (id: string) => document.getElementById(id);

/**
 * The control is CONTROLLED: adding a row only produces a row once the parent
 * re-renders with the value onChange handed it. A vi.fn() onChange therefore
 * cannot exercise focus at all — the new inputs never exist.
 */
function renderControlled(
  initial: { rows: Record<string, string | number>[] },
  overrides: Partial<IntakeFormQuestion> = {},
) {
  const question = makeRepeatingGroupQuestion({
    key: KEY,
    label: "Skills & tools",
    options: [
      { value: "ClickUp", label: "ClickUp" },
      { value: "Notion", label: "Notion" },
    ],
    ...overrides,
  });
  function Harness() {
    const [value, setValue] = useState(initial);
    return (
      <RepeatingGroupField
        question={question}
        value={value}
        onChange={(next) => {
          setValue(next as typeof initial);
        }}
        onBlur={vi.fn()}
        error={undefined}
      />
    );
  }
  render(<Harness />);
}

/** maxRows on the shared fixture, without mutating it for other tests. */
function cappedTo(maxRows: number): Partial<IntakeFormQuestion> {
  const group = makeRepeatingGroupQuestion({ key: KEY }).validation
    .repeatingGroup;
  if (group === undefined) {
    throw new Error("fixture must define a repeating group");
  }
  return { validation: { repeatingGroup: { ...group, maxRows } } };
}

function renderField(value: unknown, onChange = vi.fn()) {
  const question = makeRepeatingGroupQuestion({
    key: "skills_and_tools",
    label: "Skills & tools",
    options: [
      { value: "ClickUp", label: "ClickUp" },
      { value: "Notion", label: "Notion" },
    ],
  });
  render(
    <RepeatingGroupField
      question={question}
      value={value}
      onChange={onChange}
      onBlur={vi.fn()}
      error={undefined}
    />,
  );
  return { onChange };
}

afterEach(cleanup);

describe("RepeatingGroupField", () => {
  it("renders an empty state and an add button when there are no rows", () => {
    renderField({ rows: [] });
    expect(screen.getByText(/nothing added yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add another/i }),
    ).toBeInTheDocument();
  });

  it("uses a fieldset whose legend is the question label (AC-UI-03)", () => {
    renderField({ rows: [] });
    expect(
      screen.getByRole("group", { name: /skills & tools/i }),
    ).toBeInTheDocument();
  });

  it("gives every cell input an accessible name naming its column", () => {
    renderField({ rows: [{ skill: "ClickUp", proficiency: "expert" }] });
    expect(
      screen.getByRole("combobox", { name: /skill/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: /notes/i })).toBeInTheDocument();
  });

  it("exposes each row as a group naming its position", () => {
    renderField({ rows: [{ skill: "ClickUp" }, { skill: "Notion" }] });
    expect(screen.getByRole("group", { name: "Row 2" })).toBeInTheDocument();
  });

  it("appends a row when Add another is activated", async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({ rows: [{ skill: "ClickUp" }] });
    await user.click(screen.getByRole("button", { name: /add another/i }));
    expect(onChange).toHaveBeenCalledWith({ rows: [{ skill: "ClickUp" }, {}] });
  });

  it("removes the named row", async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({
      rows: [{ skill: "ClickUp" }, { skill: "Notion" }],
    });
    await user.click(screen.getByRole("button", { name: "Remove row 1" }));
    expect(onChange).toHaveBeenCalledWith({ rows: [{ skill: "Notion" }] });
  });

  it("omits an emptied cell from the row rather than storing an empty string", async () => {
    const user = userEvent.setup();
    const { onChange } = renderField({ rows: [{ notes: "x" }] });
    await user.clear(screen.getByRole("textbox", { name: /notes/i }));
    expect(onChange).toHaveBeenLastCalledWith({ rows: [{}] });
  });

  it("renders nothing for a question with no column definitions", () => {
    const question = makeRepeatingGroupQuestion({ key: "broken" });
    const { container } = render(
      <RepeatingGroupField
        question={{ ...question, validation: {} }}
        value={{ rows: [] }}
        onChange={vi.fn()}
        onBlur={vi.fn()}
        error={undefined}
      />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  /*
   * A class assertion, deliberately. sr-only is position:absolute and there
   * is no layout engine in jsdom, so the only thing that can be checked here
   * is that the positioned ancestor exists at all — and it must, because
   * /register and /f/:slug are public routes with no `relative` shell to
   * inherit one from (HANDOFF §7).
   */
  it("gives its sr-only children a positioned ancestor", () => {
    renderField({ rows: [{ skill: "ClickUp" }] });
    const fieldset = screen.getByRole("group", { name: /skills & tools/i });
    expect(fieldset).toHaveClass("relative");
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("says how many rows are left to give at maxRows", () => {
    const rows = Array.from({ length: 20 }, () => ({ skill: "ClickUp" }));
    renderField({ rows });
    expect(screen.getByText(/at most 20 rows/i)).toBeInTheDocument();
  });
});

describe("RepeatingGroupField — focus, keyboard and announcements", () => {
  it("AC-FB-09 — focuses the first cell of the new row after adding", async () => {
    const user = userEvent.setup();
    renderControlled({ rows: [{ skill: "ClickUp" }] });
    await user.click(screen.getByRole("button", { name: /add another/i }));
    expect(document.activeElement).toBe(byId(cellFieldId(KEY, 1, "skill")));
  });

  it("AC-FB-09 — focuses the replacing row's remove button after removing", async () => {
    const user = userEvent.setup();
    renderControlled({ rows: [{ skill: "ClickUp" }, { skill: "Notion" }] });
    await user.click(screen.getByRole("button", { name: "Remove row 1" }));
    // Row 2 is now row 1; focus lands on the control that took the same place,
    // not on the row above and not on nothing.
    expect(document.activeElement).toBe(byId(cellRemoveId(KEY, 0)));
  });

  it("AC-FB-09 — focuses Add another when the last row is removed", async () => {
    const user = userEvent.setup();
    renderControlled({ rows: [{ skill: "ClickUp" }] });
    await user.click(screen.getByRole("button", { name: "Remove row 1" }));
    expect(document.activeElement).toBe(byId(addRowId(KEY)));
  });

  it("AC-FB-09 — never leaves focus on the body", async () => {
    const user = userEvent.setup();
    renderControlled({ rows: [{ skill: "ClickUp" }, { skill: "Notion" }] });
    await user.click(screen.getByRole("button", { name: /add another/i }));
    expect(document.activeElement).not.toBe(document.body);
    await user.click(screen.getByRole("button", { name: "Remove row 3" }));
    expect(document.activeElement).not.toBe(document.body);
    await user.click(screen.getByRole("button", { name: "Remove row 2" }));
    expect(document.activeElement).not.toBe(document.body);
  });

  it("announces an addition in a polite live region", async () => {
    const user = userEvent.setup();
    renderControlled({ rows: [] });
    await user.click(screen.getByRole("button", { name: /add another/i }));
    const status = screen.getByRole("status");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status).toHaveTextContent(/row 1 added/i);
  });

  it("announces a removal and the remaining count", async () => {
    const user = userEvent.setup();
    renderControlled({ rows: [{ skill: "ClickUp" }, { skill: "Notion" }] });
    await user.click(screen.getByRole("button", { name: "Remove row 1" }));
    expect(screen.getByRole("status")).toHaveTextContent(
      /row 1 removed.*1 row remains/i,
    );
  });

  it("announces rather than disables when maxRows is reached", async () => {
    const user = userEvent.setup();
    renderControlled({ rows: [{ skill: "ClickUp" }] }, cappedTo(1));

    const add = screen.getByRole("button", { name: /add another/i });
    // Enabled, because a disabled control the user has just tabbed to explains
    // nothing about why it will not work.
    expect(add).toBeEnabled();
    await user.click(add);
    expect(screen.getByRole("status")).toHaveTextContent(/maximum of 1 row/i);
    expect(screen.getAllByRole("group", { name: /^Row / })).toHaveLength(1);
  });

  /*
   * The seeded skills catalogue is ~200 options, so in production the first
   * cell is a SearchableSelect, not the NativeSelect every other test here
   * exercises. Different control, different element carrying cellFieldId —
   * and AC-FB-09 would fail in production while the rest of this file passed.
   */
  it("AC-FB-09 — focuses the new row's first cell when it is a searchable select", async () => {
    const user = userEvent.setup();
    renderControlled(
      { rows: [{ skill: "Option 1" }] },
      {
        options: Array.from({ length: 20 }, (_, index) => ({
          value: `Option ${String(index + 1)}`,
          label: `Option ${String(index + 1)}`,
        })),
      },
    );
    await user.click(screen.getByRole("button", { name: /add another/i }));
    const target = byId(cellFieldId(KEY, 1, "skill"));
    expect(target).toBeInstanceOf(HTMLInputElement);
    expect(document.activeElement).toBe(target);
  });

  it("AC-UI-04 — is fully operable from the keyboard alone", async () => {
    const user = userEvent.setup();
    renderControlled({ rows: [{ skill: "ClickUp" }] });

    byId(cellFieldId(KEY, 0, "skill"))?.focus();
    await user.tab(); // proficiency
    await user.tab(); // notes
    await user.tab(); // remove row 1
    expect(document.activeElement).toBe(byId(cellRemoveId(KEY, 0)));
    await user.tab(); // add another
    expect(document.activeElement).toBe(byId(addRowId(KEY)));

    await user.keyboard("{Enter}");
    expect(screen.getAllByRole("group", { name: /^Row / })).toHaveLength(2);
    expect(document.activeElement).toBe(byId(cellFieldId(KEY, 1, "skill")));
  });
});
