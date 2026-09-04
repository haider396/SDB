/**
 * Candidate questions are not managed here any more.
 *
 * They belong to the form builder, which owns the candidate registration form
 * end to end. The page therefore asks the API for CLIENT categories rather
 * than fetching everything and hiding the rest — a page that renders less than
 * it fetched gets the category counts, the reorder call (which posts a whole
 * category's id list) and the cross-category search subtly wrong.
 *
 * These tests pin the request, not just the pixels, because the bug this
 * prevents is invisible: a candidate category rendering with a "New question"
 * button that creates a question the page cannot then show.
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

describe("the Questions page shows client questions only", () => {
  let api: ApiMock;

  beforeEach(() => {
    const clientCategory = makeCategory({
      key: "company_context",
      label: "Company Context",
      audience: "client",
    });
    const candidateCategory = makeCategory({
      key: "candidate_personal",
      label: "About you",
      audience: "candidate",
    });
    const state: ServerState = {
      categories: [clientCategory, candidateCategory],
      questions: [
        makeQuestion({
          key: "company_name",
          categoryId: clientCategory.id,
          label: "Company name",
          audience: "client",
        }),
        makeQuestion({
          key: "first_name",
          categoryId: candidateCategory.id,
          label: "First name",
          audience: "candidate",
        }),
      ],
    };
    api = installApiMock(state);
    renderQuestionManager();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("asks the API for client categories rather than filtering after the fact", async () => {
    await waitFor(() => {
      expect(
        api.requests.some(
          (request) =>
            request.pathname.endsWith("/question-categories") &&
            request.search.get("audience") === "client",
        ),
      ).toBe(true);
    });
  });

  it("does not render a candidate category", async () => {
    expect(await screen.findByText("Company Context")).toBeInTheDocument();
    expect(screen.queryByText("About you")).not.toBeInTheDocument();
  });

  it("keeps candidate questions out of the cross-category search", async () => {
    const user = userEvent.setup();
    const search = await screen.findByRole("searchbox", {
      name: /search questions/i,
    });

    await user.type(search, "name");

    // Both labels contain "name". Only the client one may be offered — the
    // candidate question is not this page's to open.
    const results = await screen.findByRole("list", {
      name: /matching questions/i,
    });
    await waitFor(() => {
      expect(results.textContent).toContain("Company name");
    });
    expect(results.textContent).not.toContain("First name");
  });

  it("no longer offers Candidate in the audience picker", async () => {
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "New question" }));

    const audience = await screen.findByLabelText("Audience");
    const options = [...audience.querySelectorAll("option")].map(
      (option) => option.value,
    );
    expect(options).toEqual(["client", "internal"]);
    expect(
      screen.getByText(/Candidate questions are built in Forms/i),
    ).toBeInTheDocument();
  });
});
