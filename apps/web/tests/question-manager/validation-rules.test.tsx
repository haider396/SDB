/**
 * The validation-rules editor adapts to the question type: only the rule
 * inputs that apply to the selected type are rendered, so an unknown key
 * (422 INVALID_VALIDATION_RULE) cannot be produced (03 §1.5, 02 §6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  installApiMock,
  makeCategory,
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
