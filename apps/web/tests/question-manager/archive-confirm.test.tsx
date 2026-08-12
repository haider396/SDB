/**
 * AC-UI-10: archiving a question (destructive) requires typing the object's
 * name — the button stays disabled until the typed text matches exactly.
 * Mapped questions cannot be archived at all (409 MAPPED_QUESTION_PROTECTED
 * — the row action is disabled with an explanation).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  installApiMock,
  makeCategory,
  makeQuestion,
  renderQuestionManager,
  type ApiMock,
  type ServerState,
} from "./helpers";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

describe("typed-name archive confirmation (AC-UI-10)", () => {
  let state: ServerState;
  let api: ApiMock;
  let questionId: string;

  beforeEach(() => {
    const category = makeCategory({ key: "budget", label: "Budget" });
    const question = makeQuestion({
      key: "budget_notes",
      categoryId: category.id,
      label: "Budget notes",
    });
    questionId = question.id;
    state = {
      categories: [category],
      questions: [
        question,
        // `company_name` is a MAPPED_QUESTION_KEYS member (03 §3.4).
        makeQuestion({
          key: "company_name",
          categoryId: category.id,
          label: "Company name",
          sortOrder: 2,
        }),
      ],
    };
    api = installApiMock(state);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("arms the destructive button only when the exact name is typed", async () => {
    const user = userEvent.setup();
    renderQuestionManager();

    await user.click(
      await screen.findByRole("button", { name: "Archive Budget notes" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent("Archive “Budget notes”?");

    const confirmButton = screen.getByRole("button", {
      name: "Archive question",
    });
    expect(confirmButton).toBeDisabled();

    const input = screen.getByLabelText(/Type/);
    await user.type(input, "Budget");
    expect(confirmButton).toBeDisabled();

    await user.clear(input);
    await user.type(input, "Budget notes");
    expect(confirmButton).toBeEnabled();

    await user.click(confirmButton);
    await waitFor(() => {
      expect(
        api.requests.some(
          (request) =>
            request.method === "DELETE" &&
            request.pathname.endsWith(`/questions/${questionId}`),
        ),
      ).toBe(true);
    });
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("blocks archiving mapped questions with an explanation", async () => {
    renderQuestionManager();
    const archiveButton = await screen.findByRole("button", {
      name: /Archive Company name/,
    });
    expect(archiveButton).toBeDisabled();
    expect(archiveButton).toHaveAccessibleName(
      "Archive Company name (not allowed for mapped questions)",
    );
    // No DELETE ever fired.
    expect(
      api.requests.some((request) => request.method === "DELETE"),
    ).toBe(false);
  });
});
