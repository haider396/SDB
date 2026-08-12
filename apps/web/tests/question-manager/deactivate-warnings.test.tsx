/**
 * Deactivating a question that others depend on conditionally shows the
 * server's warnings[] in a dialog listing the dependents (AC-Q-09, 03 §2.3),
 * with an undo path that reactivates.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  installApiMock,
  jsonResponse,
  makeCategory,
  makeQuestion,
  renderQuestionManager,
  toDetail,
  type ApiMock,
  type ServerState,
} from "./helpers";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

describe("deactivate warnings dialog", () => {
  let state: ServerState;
  let api: ApiMock;

  beforeEach(() => {
    const category = makeCategory({ key: "about_you", label: "About you" });
    const controller = makeQuestion({
      key: "has_industry",
      categoryId: category.id,
      label: "Industry experience required?",
      questionType: "yes_no",
    });
    const dependent = makeQuestion({
      key: "industry_detail",
      categoryId: category.id,
      label: "Which industry?",
      sortOrder: 2,
      conditional: {
        questionKey: "has_industry",
        operator: "is_true",
        value: null,
      },
    });
    state = { categories: [category], questions: [controller, dependent] };
    api = installApiMock(state, (request) => {
      if (
        request.method === "POST" &&
        request.pathname.endsWith(`/questions/${controller.id}/deactivate`)
      ) {
        controller.isActive = false;
        return jsonResponse({
          data: toDetail(controller),
          warnings: [
            {
              code: "CONDITIONAL_DEPENDENT",
              message:
                "“Which industry?” depends on this question and can no longer be shown.",
              dependent: {
                id: dependent.id,
                key: dependent.key,
                label: dependent.label,
                isActive: true,
              },
            },
          ],
        });
      }
      return undefined;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("lists dependents after deactivation and can undo", async () => {
    const user = userEvent.setup();
    renderQuestionManager();

    const toggle = await screen.findByRole("switch", {
      name: "Active: Industry experience required?",
    });
    expect(toggle).toHaveAttribute("aria-checked", "true");
    await user.click(toggle);

    // Dialog raised from the 200-with-warnings response.
    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveTextContent(
      "“Industry experience required?” was deactivated — with warnings",
    );
    expect(dialog).toHaveTextContent("Which industry?");
    expect(dialog).toHaveTextContent("industry_detail");

    // Undo path: reactivate straight from the dialog.
    await user.click(
      screen.getByRole("button", { name: "Undo — reactivate" }),
    );
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(
        api.requests.some(
          (request) =>
            request.method === "POST" &&
            request.pathname.endsWith("/activate"),
        ),
      ).toBe(true);
    });
  });

  it("closes silently when there are no dependents", async () => {
    // The second question has no dependents — default mock returns warnings: [].
    const user = userEvent.setup();
    renderQuestionManager();

    const toggle = await screen.findByRole("switch", {
      name: "Active: Which industry?",
    });
    await user.click(toggle);

    await waitFor(() => {
      expect(toggle).toHaveAttribute("aria-checked", "false");
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
