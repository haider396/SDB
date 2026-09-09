/**
 * The validation-rules editor adapts to the question type: only the rule
 * inputs that apply to the selected type are rendered, so an unknown key
 * (422 INVALID_VALIDATION_RULE) cannot be produced (03 §1.5, 02 §6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  installApiMock,
  makeCategory,
  makeQuestion,
  renderQuestionManager,
  type ServerState,
} from "./helpers";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

describe("validation rules adapt to the question type", () => {
  let state: ServerState;

  beforeEach(() => {
    state = {
      categories: [makeCategory({ key: "about_you", label: "About you" })],
      questions: [],
    };
    installApiMock(state);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function openEditor(user: ReturnType<typeof userEvent.setup>) {
    renderQuestionManager();
    await user.click(
      await screen.findByRole("button", { name: "New question" }),
    );
    return screen.findByLabelText("Type");
  }

  it("shows text rules for short_text and swaps them per type", async () => {
    const user = userEvent.setup();
    const typeSelect = await openEditor(user);

    // short_text (default): length + pattern rules, nothing scale-ish.
    expect(screen.getByLabelText("Minimum length")).toBeInTheDocument();
    expect(screen.getByLabelText("Maximum length")).toBeInTheDocument();
    expect(screen.getByLabelText("Pattern")).toBeInTheDocument();
    expect(screen.queryByLabelText("Scale minimum")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Maximum file size (MB)"),
    ).not.toBeInTheDocument();

    // scale: scale bounds + labels, no pattern.
    await user.selectOptions(typeSelect, "scale");
    expect(screen.getByLabelText("Scale minimum")).toBeInTheDocument();
    expect(screen.getByLabelText("Scale maximum")).toBeInTheDocument();
    expect(screen.getByLabelText("Label at minimum")).toBeInTheDocument();
    expect(screen.queryByLabelText("Pattern")).not.toBeInTheDocument();

    // multi_select: selection bounds, and the options section appears.
    await user.selectOptions(typeSelect, "multi_select");
    expect(screen.getByLabelText("Minimum selections")).toBeInTheDocument();
    expect(screen.getByLabelText("Maximum selections")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Add option/ }),
    ).toBeInTheDocument();

    // file_upload: file rules only — MIME types as labelled checkboxes
    // from the NFR-5 list, never a free-typed string.
    await user.selectOptions(typeSelect, "file_upload");
    expect(screen.getByText("Accepted file types")).toBeInTheDocument();
    expect(screen.getByLabelText("PDF")).toBeInTheDocument();
    expect(screen.getByLabelText("Word document (DOCX)")).toBeInTheDocument();
    expect(screen.getByLabelText("MP3 audio")).toBeInTheDocument();
    expect(screen.getByLabelText("Maximum file size (MB)")).toBeInTheDocument();
    expect(screen.queryByLabelText("Minimum selections")).not.toBeInTheDocument();

    // yes_no: no configurable rules at all.
    await user.selectOptions(typeSelect, "yes_no");
    expect(
      screen.getByText(/has no configurable validation rules/),
    ).toBeInTheDocument();
  });

  it("pattern presets: URL preset fills the regex and the probe tests values live", async () => {
    const user = userEvent.setup();
    await openEditor(user);

    const preset = screen.getByLabelText("Pattern");
    // No pattern yet — no probe, no raw regex input.
    expect(screen.queryByLabelText("Test a value")).not.toBeInTheDocument();
    expect(
      screen.queryByLabelText("Regular expression"),
    ).not.toBeInTheDocument();

    // Picking a preset stores its regex and reveals the live probe.
    await user.selectOptions(preset, "url");
    const probe = screen.getByLabelText("Test a value");
    await user.type(probe, "https://example.com");
    expect(screen.getByText("Pass")).toBeInTheDocument();
    await user.clear(probe);
    await user.type(probe, "not a url");
    expect(screen.getByText("Fail")).toBeInTheDocument();

    // Custom exposes the raw regex input.
    await user.selectOptions(preset, "custom");
    expect(screen.getByLabelText("Regular expression")).toBeInTheDocument();
  });
});

/**
 * Option A: WE define the columns, Rebecca edits the choices. The editor
 * therefore shows what the columns are and offers no way to change them.
 * An editor that could write them would let an admin rename a column out from
 * under every answer already stored against it.
 */
describe("a repeating group's columns are shown, never edited", () => {
  const category = makeCategory({ key: "candidate_skills", label: "Skills" });
  const skills = makeQuestion({
    key: "skills_and_tools",
    categoryId: category.id,
    label: "Skills & tools",
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
            maxLength: 500,
          },
        ],
        minRows: 0,
        maxRows: 20,
        addRowLabel: "Add another",
      },
    },
  });

  beforeEach(() => {
    installApiMock({ categories: [category], questions: [skills] });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("summarises the stored columns and offers no editor for them", async () => {
    const user = userEvent.setup();
    renderQuestionManager();
    await user.click(
      await screen.findByRole("button", { name: "Edit Skills & tools" }),
    );

    const summary = await screen.findByRole("group", { name: "Columns" });
    expect(summary).toHaveTextContent("3 columns");
    expect(summary).toHaveTextContent("Skill");
    expect(summary).toHaveTextContent("Proficiency");
    expect(summary).toHaveTextContent("Notes");
    // Type and required flag, so an admin can see what the form will ask for.
    expect(summary).toHaveTextContent("Single select");
    expect(summary).toHaveTextContent("Required");
    expect(summary).toHaveTextContent("Optional");
    // The sentence that stops an admin hunting for an editor that is not there.
    expect(summary).toHaveTextContent(/set by Staffing Done Better/i);

    // Option A: columns are ours, choices are hers.
    expect(
      screen.queryByRole("button", { name: /add column/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("textbox", { name: /column label/i }),
    ).not.toBeInTheDocument();
    // Not one control inside the summary — nothing here can call set().
    expect(within(summary).queryAllByRole("textbox")).toHaveLength(0);
    expect(within(summary).queryAllByRole("button")).toHaveLength(0);
    expect(within(summary).queryAllByRole("combobox")).toHaveLength(0);
    expect(within(summary).queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("says so plainly when a new repeating group has no columns yet", async () => {
    // "Repeating table" is in the type dropdown, so an admin can reach this
    // state. A silent blank would read as a broken editor.
    const user = userEvent.setup();
    renderQuestionManager();
    await user.click(
      await screen.findByRole("button", { name: "New question" }),
    );
    await user.selectOptions(
      await screen.findByLabelText("Type"),
      "repeating_group",
    );

    const summary = await screen.findByRole("group", { name: "Columns" });
    expect(summary).toHaveTextContent(/no columns/i);
  });
});
