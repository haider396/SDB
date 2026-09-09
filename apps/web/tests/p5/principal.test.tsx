/**
 * J3 principal approval (01 §3): the panel renders ONLY for the designated
 * principal while the requisition is pending_principal_approval. Approve
 * confirms then POSTs principal-approve; Request changes REQUIRES a comment
 * and POSTs it.
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
  installClientPortalApiMock,
  makeMe,
  makeRequisition,
  makeState,
  renderClientPortal,
  testUuid,
} from "./helpers";

function pendingApprovalState(principalUserId: string | null) {
  const me = makeMe();
  const requisition = makeRequisition({
    status: "pending_principal_approval",
    principalUserId,
    // T16: the client now reads the JOB DESCRIPTION — the admin-authored
    // brief was retired in 0018, and the approval gates on this instead.
    jobDescription: "We need a senior EA.\n\nUS-hours overlap required.",
  });
  return {
    mock: makeState({ me, requisitionDetail: requisition }),
    me,
    requisition,
  };
}

describe("principal approval panel", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("renders only when the signed-in user is the designated principal", async () => {
    const { mock, me, requisition } = pendingApprovalState(null);
    requisition.principalUserId = me.user.id;
    installClientPortalApiMock(mock);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    expect(
      await screen.findByText("Your approval is needed"),
    ).toBeInTheDocument();
    // The brief renders through the shared minimal renderer.
    expect(screen.getByText("We need a senior EA.")).toBeInTheDocument();
  });

  it("shows a 'job description is being finalised' card instead of the approve CTA when it is empty (UX 3.4)", async () => {
    // The word "brief" was retired with the admin-authored brief in migration
    // 0018 — what a client reads and approves is the job description. The copy
    // caught up with the data model here.
    const { mock, me, requisition } = pendingApprovalState(null);
    requisition.principalUserId = me.user.id;
    requisition.jobDescription = null;
    installClientPortalApiMock(mock);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    expect(
      await screen.findByText("The job description is being finalised"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Your approval is needed")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Approve brief" }),
    ).not.toBeInTheDocument();
  });

  it("stays hidden for a client user who is not the principal", async () => {
    const { mock, requisition } = pendingApprovalState(testUuid());
    installClientPortalApiMock(mock);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    await screen.findByText("We need a senior EA.");
    expect(screen.queryByText("Your approval is needed")).not.toBeInTheDocument();
  });

  it("approves through a confirm dialog and POSTs principal-approve", async () => {
    const user = userEvent.setup();
    const { mock, me, requisition } = pendingApprovalState(null);
    requisition.principalUserId = me.user.id;
    const { requests } = installClientPortalApiMock(mock);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    await user.click(
      await screen.findByRole("button", { name: "Approve brief" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/sourcing starts immediately/i),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Approve brief" }),
    );

    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.method === "POST" &&
            request.pathname ===
              `/api/v1/requisitions/${requisition.id}/principal-approve`,
        ),
      ).toBe(true);
    });
  });

  it("requires a comment before requesting changes, then POSTs it", async () => {
    const user = userEvent.setup();
    const { mock, me, requisition } = pendingApprovalState(null);
    requisition.principalUserId = me.user.id;
    const { requests } = installClientPortalApiMock(mock);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    await user.click(
      await screen.findByRole("button", { name: "Request changes" }),
    );
    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Send change request" }),
    );
    expect(
      within(dialog).getByText(/the comment is required/i),
    ).toBeInTheDocument();
    expect(
      requests.some((request) =>
        request.pathname.endsWith("/principal-request-changes"),
      ),
    ).toBe(false);

    await user.type(
      within(dialog).getByLabelText("What should change?"),
      "Please add the budget band.",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Send change request" }),
    );

    await waitFor(() => {
      const posted = requests.find(
        (request) =>
          request.method === "POST" &&
          request.pathname ===
            `/api/v1/requisitions/${requisition.id}/principal-request-changes`,
      );
      expect(posted?.body).toEqual({ comment: "Please add the budget band." });
    });
  });
});
