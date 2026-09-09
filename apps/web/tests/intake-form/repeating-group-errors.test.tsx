/**
 * Three sources of failure, one shape on the control (spec §7.4).
 *
 * The control must never read a host's error state: `/f/:slug` and `/register`
 * validate with zodResolver, the client intake form with
 * validateIntakeValues(), and the server answers in a third shape again. Each
 * host flattens into `rowErrors` — these tests prove the flattening lands on
 * the right cell, not merely that it produces an array.
 */
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { ApiError } from "@/lib/api-client";
import { QuestionField } from "@/features/intake-form/components/question-field";
import { cellFieldId } from "@/features/intake-form/components/fields/field-shell";
import { mapSubmissionError } from "@/features/intake-form/error-map";
import { activeRowErrors } from "@/features/intake-form/repeating-group";
import {
  buildIntakeSchema,
  validateIntakeValues,
} from "@/features/intake-form/schema-builder";
import type { IntakeValues } from "@/features/intake-form/conditional";
import { makeRepeatingGroupQuestion } from "./helpers";

afterEach(cleanup);

const KEY = "skills_and_tools";

const question = makeRepeatingGroupQuestion({
  key: KEY,
  label: "Skills & tools",
  options: [{ value: "ClickUp", label: "ClickUp" }],
});

/** The proficiency cell of row 1 — required, and left empty by every test. */
const PROFICIENCY_ID = cellFieldId(KEY, 0, "proficiency");

function expectProficiencyFlagged() {
  const cell = screen.getByRole("combobox", { name: /proficiency/i });
  expect(cell).toHaveAttribute("id", PROFICIENCY_ID);
  expect(cell).toHaveAttribute("aria-invalid", "true");
  expect(cell).toHaveAttribute("aria-describedby", `${PROFICIENCY_ID}-error`);
  expect(document.getElementById(`${PROFICIENCY_ID}-error`)).toHaveTextContent(
    "This field is required.",
  );
}

/** How /f/:slug and /register validate: zodResolver, nested RHF errors. */
function ZodResolverHost() {
  const form = useForm<IntakeValues>({
    resolver: zodResolver(buildIntakeSchema([question])),
    defaultValues: { [KEY]: { rows: [{ skill: "ClickUp" }] } },
  });
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit(() => undefined)(event);
      }}
    >
      <Controller
        name={KEY}
        control={form.control}
        render={({ field, fieldState }) => (
          <QuestionField
            question={question}
            value={field.value}
            onChange={field.onChange}
            onBlur={field.onBlur}
            error={fieldState.error?.message}
            rowErrors={activeRowErrors(fieldState.error, undefined)}
          />
        )}
      />
      <button type="submit">Submit</button>
    </form>
  );
}

describe("repeating-group errors — zodResolver (/f/:slug, /register)", () => {
  it("marks the exact cell that failed, not the table", async () => {
    const user = userEvent.setup();
    render(<ZodResolverHost />);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expectProficiencyFlagged();
  });

  it("leaves the cell that passed alone", async () => {
    const user = userEvent.setup();
    render(<ZodResolverHost />);
    await user.click(screen.getByRole("button", { name: "Submit" }));
    expect(screen.getByRole("combobox", { name: /^skill$/i })).not.toHaveAttribute(
      "aria-invalid",
    );
  });
});

describe("repeating-group errors — validateIntakeValues (client intake form)", () => {
  it("produces the same cell errors the control renders", () => {
    const result = validateIntakeValues([question], {
      [KEY]: { rows: [{ skill: "ClickUp" }] },
    });
    render(
      <QuestionField
        question={question}
        value={{ rows: [{ skill: "ClickUp" }] }}
        onChange={() => undefined}
        onBlur={() => undefined}
        error={result.errors[KEY]}
        rowErrors={result.rowErrors[KEY]}
      />,
    );
    expectProficiencyFlagged();
  });
});

describe("repeating-group errors — the server (mapSubmissionError)", () => {
  it("lands details.fields[key].rows on the cell it names", () => {
    const mapped = mapSubmissionError(
      new ApiError({
        code: "VALIDATION_FAILED",
        message: "Validation failed.",
        details: {
          fields: {
            [KEY]: {
              message: "1 row has problems.",
              rows: [
                {
                  rowIndex: 0,
                  columnKey: "proficiency",
                  message: "This field is required.",
                },
              ],
            },
          },
        },
        requestId: null,
        status: 422,
      }),
    );
    render(
      <QuestionField
        question={question}
        value={{ rows: [{ skill: "ClickUp" }] }}
        onChange={() => undefined}
        onBlur={() => undefined}
        error={mapped.fieldErrors[KEY]}
        rowErrors={mapped.rowErrors[KEY]}
      />,
    );
    expectProficiencyFlagged();
  });
});
