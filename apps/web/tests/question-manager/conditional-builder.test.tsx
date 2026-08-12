/**
 * The conditional builder emits the exact QuestionConditional payload shape
 * the API stores (02 §6): operator adapted to the controller's type, value
 * null for boolean operators, array for `in`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  installApiMock,
  makeCategory,
  makeQuestion,
  renderQuestionManager,
  testUuid,
  type ApiMock,
  type ServerState,
} from "./helpers";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

describe("conditional builder payload shape", () => {
  let state: ServerState;
  let api: ApiMock;

  beforeEach(() => {
    const category = makeCategory({ key: "about_you", label: "About you" });
    state = {
      categories: [category],
      questions: [
        makeQuestion({
          key: "has_industry",
          categoryId: category.id,
          label: "Industry experience required?",
          questionType: "yes_no",
        }),
        makeQuestion({
          key: "team_size",
          categoryId: category.id,
          label: "Team size",
          questionType: "single_select",
          sortOrder: 2,
          options: [
            {
              id: testUuid(),
              value: "solo",
              label: "Just me",
              sortOrder: 1,
              isActive: true,
            },
            {
              id: testUuid(),
              value: "small",
              label: "2–10",
              sortOrder: 2,
              isActive: true,
            },
          ],
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

  it("builds { questionKey, operator: is_true, value: null } for a yes/no controller", async () => {
    const user = userEvent.setup();
    renderQuestionManager();
    await user.click(
      await screen.findByRole("button", { name: "New question" }),
    );

    await user.type(screen.getByLabelText("Label"), "Which industry?");
    await user.selectOptions(
      await screen.findByLabelText("Show only when"),
      "has_industry",
    );
    // Operator list adapts to yes_no: is yes / is no, defaulting to is_true.
    const operatorSelect = screen.getByLabelText("Condition");
    expect(operatorSelect).toHaveValue("is_true");
    expect(screen.queryByLabelText("Value")).not.toBeInTheDocument();

    await user.click(
      screen.getByRole("button", { name: "Create question" }),
    );

    await waitFor(() => {
      expect(
        api.requests.some(
          (request) =>
            request.method === "POST" &&
            request.pathname.endsWith("/questions"),
        ),
      ).toBe(true);
    });
    const post = api.requests.find(
      (request) =>
        request.method === "POST" && request.pathname.endsWith("/questions"),
    );
    expect(post?.body).toMatchObject({
      label: "Which industry?",
      conditional: {
        questionKey: "has_industry",
        operator: "is_true",
        value: null,
      },
    });
  });

  it("builds an array value for `in` against a select controller's options", async () => {
    const user = userEvent.setup();
    renderQuestionManager();
    await user.click(
      await screen.findByRole("button", { name: "New question" }),
    );

    await user.type(screen.getByLabelText("Label"), "Who manages them?");
    await user.selectOptions(
      await screen.findByLabelText("Show only when"),
      "team_size",
    );
    await user.selectOptions(screen.getByLabelText("Condition"), "in");
    await user.click(screen.getByRole("checkbox", { name: "Just me" }));
    await user.click(screen.getByRole("checkbox", { name: "2–10" }));

    await user.click(
      screen.getByRole("button", { name: "Create question" }),
    );

    await waitFor(() => {
      expect(
        api.requests.some(
          (request) =>
            request.method === "POST" &&
            request.pathname.endsWith("/questions"),
        ),
      ).toBe(true);
    });
    const post = api.requests.find(
      (request) =>
        request.method === "POST" && request.pathname.endsWith("/questions"),
    );
    expect(post?.body).toMatchObject({
      conditional: {
        questionKey: "team_size",
        operator: "in",
        value: ["solo", "small"],
      },
    });
  });
});
