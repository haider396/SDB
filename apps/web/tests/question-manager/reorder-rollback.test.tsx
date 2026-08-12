/**
 * Reorder is optimistic with rollback + toast on failure (05 §4.5), and the
 * keyboard alternative (move buttons) drives the same path (05 §4.6).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  errorResponse,
  installApiMock,
  makeCategory,
  makeQuestion,
  renderQuestionManager,
  type ServerState,
} from "./helpers";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

describe("optimistic reorder with rollback", () => {
  let state: ServerState;
  let failReorder: boolean;

  beforeEach(() => {
    failReorder = false;
    const category = makeCategory({ key: "about_you", label: "About you" });
    state = {
      categories: [category],
      questions: [
        makeQuestion({
          key: "first_question",
          categoryId: category.id,
          label: "First question",
          sortOrder: 1,
        }),
        makeQuestion({
          key: "second_question",
          categoryId: category.id,
          label: "Second question",
          sortOrder: 2,
        }),
      ],
    };
    installApiMock(state, (request) => {
      if (
        failReorder &&
        request.method === "PATCH" &&
        request.pathname.endsWith("/questions/reorder")
      ) {
        // Delayed failure so the test can observe the optimistic state
        // before the rollback lands.
        return new Promise<Response>((resolve) => {
          setTimeout(
            () =>
              resolve(
                errorResponse(
                  "INTERNAL_ERROR",
                  "The order could not be saved.",
                  500,
                ),
              ),
            80,
          );
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

  function rowLabels(): string[] {
    const list = screen.getByRole("list", { name: "Questions in About you" });
    return within(list)
      .getAllByRole("listitem")
      .map((item) =>
        item.textContent?.includes("First question") ? "first" : "second",
      );
  }

  it("applies the move immediately and keeps it on success", async () => {
    const user = userEvent.setup();
    renderQuestionManager();
    await screen.findByText("First question");
    expect(rowLabels()).toEqual(["first", "second"]);

    await user.click(
      screen.getByRole("button", { name: "Move First question down" }),
    );
    expect(rowLabels()).toEqual(["second", "first"]);

    await waitFor(() => {
      expect(rowLabels()).toEqual(["second", "first"]);
    });
  });

  it("rolls back and shows a toast when the API fails", async () => {
    failReorder = true;
    const user = userEvent.setup();
    renderQuestionManager();
    await screen.findByText("First question");

    await user.click(
      screen.getByRole("button", { name: "Move First question down" }),
    );
    // Optimistic flip…
    await waitFor(() => {
      expect(rowLabels()).toEqual(["second", "first"]);
    });

    // …rolled back with a failure toast.
    await screen.findByText("The order could not be saved.");
    await waitFor(() => {
      expect(rowLabels()).toEqual(["first", "second"]);
    });
  });
});
