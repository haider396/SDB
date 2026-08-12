/**
 * The three client decisions (01 §3 J6, AC-E2E-05): exact endpoints and
 * bodies, optimistic UI updates with rollback on failure, and the
 * structured-reason requirement on reject (AC-PL-11).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@supabase/supabase-js";

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    useSession: () => ({
      session: {} as unknown as Session,
      isLoading: false,
    }),
    getAccessToken: async () => "test-token",
  };
});

import {
  SKILLS_GAP_REASON_ID,
  errorResponse,
  installClientPortalApiMock,
  makeClientAssignment,
  makeRequisition,
  makeState,
  renderClientPortal,
} from "./helpers";

function presentedState() {
  const requisition = makeRequisition({ status: "candidates_presented" });
  const row = makeClientAssignment({
    requisitionId: requisition.id,
    displayName: "Maria G.",
  });
  return {
    state: makeState({
      requisitionDetail: requisition,
      assignmentsByRequisitionId: { [requisition.id]: [row] },
    }),
    requisition,
    row,
  };
}

describe("client decisions", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("approve: confirm dialog → POST approve-for-interview (no body) → card shows approved", async () => {
    const user = userEvent.setup();
    const { state, requisition, row } = presentedState();
    const { requests } = installClientPortalApiMock(state);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    const card = await screen.findByRole("article", {
      name: "Candidate Maria G.",
    });
    await user.click(
      within(card).getByRole("button", { name: "Approve for interview" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Approve for interview" }),
    );

    await waitFor(() => {
      const posted = requests.find(
        (request) =>
          request.method === "POST" &&
          request.pathname ===
            `/api/v1/assignments/${row.assignmentId}/approve-for-interview`,
      );
      expect(posted).toBeDefined();
      expect(posted?.body).toBeUndefined();
    });
    await waitFor(() => {
      expect(
        within(
          screen.getByRole("article", { name: "Candidate Maria G." }),
        ).getByText("Approved for interview"),
      ).toBeInTheDocument();
    });
  });

  it("approve failure rolls the optimistic stage back", async () => {
    const user = userEvent.setup();
    const { state, requisition } = presentedState();
    installClientPortalApiMock(state, (request) =>
      request.pathname.endsWith("/approve-for-interview")
        ? errorResponse("INVALID_TRANSITION", "Stage moved.", 409)
        : undefined,
    );
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    const card = await screen.findByRole("article", {
      name: "Candidate Maria G.",
    });
    await user.click(
      within(card).getByRole("button", { name: "Approve for interview" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Approve for interview" }),
    );

    // The dialog surfaces the error…
    expect(await within(dialog).findByRole("alert")).toHaveTextContent(
      "Stage moved.",
    );
    // …and after closing it (Radix hides the page behind an open modal),
    // the card has rolled back to presented.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => {
      expect(
        within(
          screen.getByRole("article", { name: "Candidate Maria G." }),
        ).getByText("Awaiting your review"),
      ).toBeInTheDocument();
    });
  });

  it("reject requires a structured reason before POSTing", async () => {
    const user = userEvent.setup();
    const { state, requisition, row } = presentedState();
    const { requests } = installClientPortalApiMock(state);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    const card = await screen.findByRole("article", {
      name: "Candidate Maria G.",
    });
    await user.click(within(card).getByRole("button", { name: "Decline" }));
    const dialog = await screen.findByRole("dialog");

    // No reason chosen → validation, no request.
    await user.click(
      within(dialog).getByRole("button", { name: "Decline candidate" }),
    );
    expect(within(dialog).getByRole("alert")).toHaveTextContent(
      "Choose a reason so we can source better matches.",
    );
    expect(
      requests.some((request) => request.pathname.endsWith("/reject")),
    ).toBe(false);

    // Structured reason → exact body: a real reasonId from
    // GET /rejection-reasons (actor=client), optional detail included.
    await user.selectOptions(
      within(dialog).getByLabelText("Reason"),
      "skills_gap",
    );
    await user.type(
      within(dialog).getByLabelText(/anything else we should know/i),
      "Needs stronger reporting skills.",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Decline candidate" }),
    );

    await waitFor(() => {
      const posted = requests.find(
        (request) =>
          request.method === "POST" &&
          request.pathname === `/api/v1/assignments/${row.assignmentId}/reject`,
      );
      expect(posted?.body).toEqual({
        reasonId: SKILLS_GAP_REASON_ID,
        detail: "Needs stronger reporting skills.",
      });
    });

    // The card moves to the muted declined state with the reason shown.
    await waitFor(() => {
      expect(
        within(
          screen.getByRole("article", { name: "Candidate Maria G." }),
        ).getByText(/you declined this candidate: skills gap/i),
      ).toBeInTheDocument();
    });
  });

  it("request interview: confirm → POST request-interview → chip, stage unchanged", async () => {
    const user = userEvent.setup();
    const { state, requisition, row } = presentedState();
    const { requests } = installClientPortalApiMock(state);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    const card = await screen.findByRole("article", {
      name: "Candidate Maria G.",
    });
    await user.click(
      within(card).getByRole("button", { name: "Request interview" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Request interview" }),
    );

    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.method === "POST" &&
            request.pathname ===
              `/api/v1/assignments/${row.assignmentId}/request-interview`,
        ),
      ).toBe(true);
    });
    const updated = screen.getByRole("article", { name: "Candidate Maria G." });
    expect(
      await within(updated).findByText("Interview requested"),
    ).toBeInTheDocument();
    // No stage change (scheduling is the admin's move).
    expect(within(updated).getByText("Awaiting your review")).toBeInTheDocument();
  });
});
