/**
 * Optimistic stage advance with rollback (05 §4.5), driven through the
 * keyboard/menu path (jsdom cannot drag): the card moves columns
 * immediately, and a 409 INVALID_TRANSITION rolls it back with a toast
 * surfacing the server's { from, to }.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  errorResponse,
  installPipelineApiMock,
  jsonResponse,
  makeAssignment,
  makeCandidate,
  makeDetail,
  makePipelineState,
  makeRequisition,
  renderPipeline,
  type PipelineApiMock,
} from "./helpers";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

describe("optimistic advance with rollback", () => {
  const requisition = makeRequisition();
  let mock: PipelineApiMock;
  let advanceBehaviour: "succeed" | "fail-409";

  beforeEach(() => {
    advanceBehaviour = "succeed";
    const candidate = makeCandidate({
      firstName: "Maria",
      lastName: "Gonzalez",
    });
    const state = makePipelineState({
      requisition,
      candidates: [candidate],
      detailsById: { [candidate.id]: makeDetail(candidate) },
    });
    state.assignments = [
      makeAssignment({ requisition, candidate, stage: "sourced" }),
    ];
    mock = installPipelineApiMock(state, (request) => {
      if (
        request.method === "POST" &&
        request.pathname.endsWith("/advance")
      ) {
        if (advanceBehaviour === "fail-409") {
          // Delayed so the optimistic state is observable first.
          return new Promise((resolve) => {
            setTimeout(
              () =>
                resolve(
                  new Response(
                    JSON.stringify({
                      error: {
                        code: "INVALID_TRANSITION",
                        message: "Cannot move an assignment from 'sourced' to 'screened'.",
                        details: { from: "sourced", to: "screened" },
                        requestId: "req-test-409",
                      },
                    }),
                    {
                      status: 409,
                      headers: { "Content-Type": "application/json" },
                    },
                  ),
                ),
              80,
            );
          });
        }
        const assignment = mock.state.assignments[0];
        if (assignment === undefined) {
          return errorResponse("NOT_FOUND", "gone", 404);
        }
        const payload = request.body as { toStage: "screened" };
        assignment.stage = payload.toStage;
        return jsonResponse({ data: assignment });
      }
      return undefined;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function advanceViaMenu(): Promise<void> {
    const user = userEvent.setup();
    const sourcedColumn = await screen.findByRole("region", {
      name: "Sourced column",
    });
    await within(sourcedColumn).findByText("Maria G.");
    await user.click(
      within(sourcedColumn).getByRole("button", {
        name: "Actions for Maria G.",
      }),
    );
    const menu = await screen.findByRole("menu");
    await user.click(
      within(menu).getByRole("menuitem", { name: "Advance to Screened" }),
    );
  }

  it("moves the card optimistically and keeps it there on success", async () => {
    renderPipeline(requisition.id);
    await advanceViaMenu();

    const screenedColumn = screen.getByRole("region", {
      name: "Screened column",
    });
    // Optimistic: present immediately, before any server confirmation.
    expect(within(screenedColumn).getByText("Maria G.")).toBeInTheDocument();

    await waitFor(() => {
      const advancePost = mock.requests.find(
        (request) =>
          request.method === "POST" && request.pathname.endsWith("/advance"),
      );
      expect(advancePost).toBeDefined();
      expect(advancePost?.body).toEqual({ toStage: "screened" });
    });
    expect(within(screenedColumn).getByText("Maria G.")).toBeInTheDocument();
  });

  it("rolls back on 409 INVALID_TRANSITION and surfaces from/to in the toast", async () => {
    advanceBehaviour = "fail-409";
    renderPipeline(requisition.id);
    await advanceViaMenu();

    // Optimistic move lands first…
    const screenedColumn = screen.getByRole("region", {
      name: "Screened column",
    });
    expect(within(screenedColumn).getByText("Maria G.")).toBeInTheDocument();

    // …then the 409 rolls it back.
    await waitFor(() => {
      const sourcedColumn = screen.getByRole("region", {
        name: "Sourced column",
      });
      expect(within(sourcedColumn).getByText("Maria G.")).toBeInTheDocument();
    });
    expect(
      within(screenedColumn).queryByText("Maria G."),
    ).not.toBeInTheDocument();

    // Toast surfaces the server's { from, to } as labels.
    await waitFor(() => {
      expect(
        screen.getByText(
          "Cannot move Maria G. from Sourced to Screened — rolled back.",
        ),
      ).toBeInTheDocument();
    });
  });
});
