/**
 * AC-Q-14 (component level): the live preview renders the real client-form
 * payload from GET /questions/preview and reflects an edit without a page
 * reload — edit → mutation success → query invalidation → preview refetch →
 * re-render, all in one mounted tree.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
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

describe("live preview invalidation (AC-Q-14)", () => {
  let state: ServerState;
  let api: ApiMock;

  beforeEach(() => {
    const category = makeCategory({ key: "about_you", label: "About you" });
    state = {
      categories: [category],
      questions: [
        makeQuestion({
          key: "company_name",
          categoryId: category.id,
          label: "Company name",
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

  it("re-renders the preview with the edited label, without reload", async () => {
    const user = userEvent.setup();
    renderQuestionManager();

    // The preview pane shows the current client form.
    const preview = await screen.findByRole("region", {
      name: "Live preview",
    });
    await within(preview).findByLabelText(/Company name/);

    // Edit the label through the editor sheet.
    await user.click(
      screen.getByRole("button", { name: "Edit Company name" }),
    );
    const labelInput = await screen.findByLabelText("Label");
    await user.clear(labelInput);
    await user.type(labelInput, "Legal company name");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    // The SAME mounted preview re-renders with the new label after the
    // ["question-preview"] invalidation triggers a refetch.
    await within(preview).findByLabelText(/Legal company name/);
    expect(
      within(preview).queryByLabelText(/^Company name/),
    ).not.toBeInTheDocument();

    // Sanity: the preview endpoint really was refetched (not a local echo).
    const previewCalls = api.requests.filter((request) =>
      request.pathname.endsWith("/questions/preview"),
    );
    expect(previewCalls.length).toBeGreaterThanOrEqual(2);
  });
});
