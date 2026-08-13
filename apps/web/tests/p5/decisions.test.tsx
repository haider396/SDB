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
  NOW,
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

  it("move forward: ONE primary action at presented → POST approve-for-interview (no body) → card shows approved", async () => {
    const user = userEvent.setup();
    const { state, requisition, row } = presentedState();
    const { requests } = installClientPortalApiMock(state);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    const card = await screen.findByRole("article", {
      name: "Candidate Maria G.",
    });
    // UX 3.1: no separate "Request interview" at presented — one primary.
    expect(
      within(card).queryByRole("button", { name: "Request interview" }),
    ).not.toBeInTheDocument();
    await user.click(
      within(card).getByRole("button", { name: "Move forward to interview" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/they'll coordinate scheduling with you/i),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Move forward to interview" }),
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
      within(card).getByRole("button", { name: "Move forward to interview" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Move forward to interview" }),
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

    // The card moves to the muted declined state with the SERVER's reason
    // label (UX 3.2) — plus the free-text detail.
    await waitFor(() => {
      const declinedCard = screen.getByRole("article", {
        name: "Candidate Maria G.",
      });
      expect(
        within(declinedCard).getByText(/you declined — skills gap/i),
      ).toBeInTheDocument();
      expect(
        within(declinedCard).getByText("Needs stronger reporting skills."),
      ).toBeInTheDocument();
    });
  });

  it("request interview (client_reviewing): confirm → POST request-interview → server-backed chip, stage unchanged", async () => {
    const user = userEvent.setup();
    const requisition = makeRequisition({ status: "candidates_presented" });
    const row = makeClientAssignment({
      requisitionId: requisition.id,
      displayName: "Maria G.",
      stage: "client_reviewing",
    });
    const state = makeState({
      requisitionDetail: requisition,
      assignmentsByRequisitionId: { [requisition.id]: [row] },
    });
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
    // The chip is driven by the server's interviewRequestedAt (UX 3.2),
    // with the relative time appended.
    expect(
      await within(updated).findByText(/interview requested .*ago/i),
    ).toBeInTheDocument();
    // No stage change (scheduling is the admin's move)…
    expect(
      within(updated).getByText("Approved for interview"),
    ).toBeInTheDocument();
    // …and the nudge button disappears once requested.
    expect(
      within(updated).queryByRole("button", { name: "Request interview" }),
    ).not.toBeInTheDocument();
  });

  it("presented card renders the server's interviewRequestedAt chip on load", async () => {
    const requisition = makeRequisition({ status: "candidates_presented" });
    const row = makeClientAssignment({
      requisitionId: requisition.id,
      displayName: "Maria G.",
      stage: "client_reviewing",
      interviewRequestedAt: NOW,
    });
    const state = makeState({
      requisitionDetail: requisition,
      assignmentsByRequisitionId: { [requisition.id]: [row] },
    });
    installClientPortalApiMock(state);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    const card = await screen.findByRole("article", {
      name: "Candidate Maria G.",
    });
    expect(
      within(card).getByText(/interview requested .*ago/i),
    ).toBeInTheDocument();
  });
});
