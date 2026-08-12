/**
 * The add-candidates picker: excludes already-assigned candidates,
 * multi-select POSTs the exact body, and the two documented failures —
 * 422 blockedCandidates (AC-PL-04) and 409 DUPLICATE_ASSIGNMENT — surface
 * inline with candidate names, atomically ("nobody was added").
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Candidate } from "@sdb/contracts";
import {
  installPipelineApiMock,
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

describe("add candidates sheet", () => {
  const requisition = makeRequisition();
  let mock: PipelineApiMock;
  let assigned: Candidate;
  let available: Candidate;
  let blocked: Candidate;

  beforeEach(() => {
    assigned = makeCandidate({ firstName: "Maria", lastName: "Gonzalez" });
    available = makeCandidate({ firstName: "Ana", lastName: "Cruz" });
    blocked = makeCandidate({ firstName: "Jon", lastName: "Reyes" });
    const state = makePipelineState({
      requisition,
      candidates: [assigned, available, blocked],
      detailsById: {
        [assigned.id]: makeDetail(assigned),
        [available.id]: makeDetail(available),
        [blocked.id]: makeDetail(blocked),
      },
    });
    state.assignments = [
      makeAssignment({ requisition, candidate: assigned, stage: "sourced" }),
    ];
    mock = installPipelineApiMock(state);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function openSheet() {
    const user = userEvent.setup();
    await screen.findByRole("region", { name: "Sourced column" });
    await user.click(screen.getByRole("button", { name: "Add candidates" }));
    await screen.findByRole("dialog");
    return user;
  }

  it("lists only unassigned candidates and posts the selected ids", async () => {
    renderPipeline(requisition.id);
    const user = await openSheet();

    const list = await screen.findByRole("list", {
      name: "Available candidates",
    });
    expect(within(list).getByText("Ana C.")).toBeInTheDocument();
    expect(within(list).getByText("Jon R.")).toBeInTheDocument();
    // Already assigned → excluded from the picker.
    expect(within(list).queryByText("Maria G.")).not.toBeInTheDocument();

    await user.click(within(list).getByLabelText(/Ana C\./));
    await user.click(
      screen.getByRole("button", { name: "Add 1 candidate" }),
    );

    await waitFor(() => {
      const post = mock.requests.find(
        (request) =>
          request.method === "POST" &&
          request.pathname ===
            `/api/v1/requisitions/${requisition.id}/assignments`,
      );
      expect(post).toBeDefined();
      expect(post?.body).toEqual({ candidateIds: [available.id] });
    });

    // Board refresh shows the new sourced card.
    await waitFor(() => {
      const sourced = screen.getByRole("region", { name: "Sourced column" });
      expect(within(sourced).getByText("Ana C.")).toBeInTheDocument();
    });
  });

  it("surfaces 422 blockedCandidates with names, atomically", async () => {
    const state = mock.state;
    mock = installPipelineApiMock(state, (request) => {
      if (
        request.method === "POST" &&
        request.pathname === `/api/v1/requisitions/${requisition.id}/assignments`
      ) {
        return new Response(
          JSON.stringify({
            error: {
              code: "VALIDATION_FAILED",
              message:
                "One or more candidates must not be presented to this client.",
              details: {
                blockedCandidates: [
                  {
                    candidateId: blocked.id,
                    reason: "do_not_present_to_client",
                  },
                ],
              },
              requestId: "req-test-422",
            },
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        );
      }
      return undefined;
    });

    renderPipeline(requisition.id);
    const user = await openSheet();
    const list = await screen.findByRole("list", {
      name: "Available candidates",
    });
    await user.click(within(list).getByLabelText(/Jon R\./));
    await user.click(screen.getByRole("button", { name: "Add 1 candidate" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("do-not-present");
    expect(alert.textContent).toContain("Jon R.");
    expect(alert.textContent).toContain("Nobody was added.");
  });

  it("surfaces 409 DUPLICATE_ASSIGNMENT cleanly", async () => {
    const state = mock.state;
    mock = installPipelineApiMock(state, (request) => {
      if (
        request.method === "POST" &&
        request.pathname === `/api/v1/requisitions/${requisition.id}/assignments`
      ) {
        return new Response(
          JSON.stringify({
            error: {
              code: "DUPLICATE_ASSIGNMENT",
              message:
                "One or more candidates are already assigned to this requisition.",
              details: { candidateIds: [available.id] },
              requestId: "req-test-409",
            },
          }),
          { status: 409, headers: { "Content-Type": "application/json" } },
        );
      }
      return undefined;
    });

    renderPipeline(requisition.id);
    const user = await openSheet();
    const list = await screen.findByRole("list", {
      name: "Available candidates",
    });
    await user.click(within(list).getByLabelText(/Ana C\./));
    await user.click(screen.getByRole("button", { name: "Add 1 candidate" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Already assigned");
    expect(alert.textContent).toContain("Ana C.");
  });
});
