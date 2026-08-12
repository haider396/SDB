/**
 * The PII gate as rendered (CLAUDE.md rule 4, 02 §11, AC-E2E-04/06):
 * null gated fields → the lock panel listing withheld field NAMES and no
 * contact block, no empty labels; non-null gated fields → the contact
 * block. Muted terminal cards carry no actions.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
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
  makeClientAssignment,
  makeRequisition,
  makeState,
  renderClientPortal,
  withUnlockedPii,
} from "./helpers";

describe("gated PII rendering", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("locked (presented): lock panel lists withheld names; no contact block, no PII values", async () => {
    const requisition = makeRequisition({ status: "candidates_presented" });
    const locked = makeClientAssignment({
      requisitionId: requisition.id,
      displayName: "Maria G.",
    });
    const state = makeState({
      requisitionDetail: requisition,
      assignmentsByRequisitionId: { [requisition.id]: [locked] },
    });
    installClientPortalApiMock(state);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    const card = await screen.findByRole("article", {
      name: "Candidate Maria G.",
    });
    expect(
      within(card).getByText(
        "Full contact details unlock once an interview is scheduled",
      ),
    ).toBeInTheDocument();

    // Every withheld field is listed BY NAME…
    const withheld = within(card).getByRole("list", {
      name: "Details withheld for Maria G.",
    });
    for (const label of [
      "Last name",
      "Email",
      "Phone",
      "WhatsApp",
      "LinkedIn",
      "Current employer",
    ]) {
      expect(within(withheld).getByText(label)).toBeInTheDocument();
    }

    // …and no contact block, no empty labels, no PII values anywhere.
    expect(within(card).queryByText("Contact details")).not.toBeInTheDocument();
    expect(within(card).queryByText("Full name")).not.toBeInTheDocument();
    expect(screen.queryByText(/maria@example\.test/)).not.toBeInTheDocument();
    expect(screen.queryByText("Legacy BPO Inc")).not.toBeInTheDocument();
    expect(screen.queryByText("Maria Gonzales")).not.toBeInTheDocument();

    // Always-visible profile facts still render.
    expect(within(card).getByText("Executive Assistant")).toBeInTheDocument();
    expect(within(card).getByText("SDB recommendation")).toBeInTheDocument();
  });

  it("unlocked (interview_scheduled): the contact block renders every non-null field", async () => {
    const requisition = makeRequisition({ status: "interviewing" });
    const unlocked = withUnlockedPii(
      makeClientAssignment({
        requisitionId: requisition.id,
        displayName: "Maria G.",
      }),
    );
    const state = makeState({
      requisitionDetail: requisition,
      assignmentsByRequisitionId: { [requisition.id]: [unlocked] },
    });
    installClientPortalApiMock(state);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    const card = await screen.findByRole("article", {
      name: "Candidate Maria G.",
    });
    expect(within(card).getByText("Contact details")).toBeInTheDocument();
    expect(within(card).getByText("Maria Gonzales")).toBeInTheDocument();
    expect(
      within(card).getByRole("link", { name: "maria@example.test" }),
    ).toHaveAttribute("href", "mailto:maria@example.test");
    expect(
      within(card).getByRole("link", { name: "+63 900 123 4567" }),
    ).toHaveAttribute("href", "tel:+63 900 123 4567");
    expect(
      within(card).getByRole("link", { name: "LinkedIn profile" }),
    ).toHaveAttribute("href", "https://linkedin.example/in/maria");
    expect(within(card).getByText("Legacy BPO Inc")).toBeInTheDocument();

    // The lock panel is gone.
    expect(
      within(card).queryByText(
        "Full contact details unlock once an interview is scheduled",
      ),
    ).not.toBeInTheDocument();
  });

  it("muted cards: declined shows the state, filled shows position filled, neither offers actions", async () => {
    const requisition = makeRequisition({ status: "placed" });
    const rejected = makeClientAssignment({
      requisitionId: requisition.id,
      displayName: "Rita R.",
      stage: "rejected_by_client",
    });
    const closed = makeClientAssignment({
      requisitionId: requisition.id,
      displayName: "Carlos C.",
      stage: "closed_not_selected",
    });
    const state = makeState({
      requisitionDetail: requisition,
      assignmentsByRequisitionId: { [requisition.id]: [rejected, closed] },
    });
    installClientPortalApiMock(state);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    const rejectedCard = await screen.findByRole("article", {
      name: "Candidate Rita R.",
    });
    expect(
      within(rejectedCard).getByText(/you declined this candidate/i),
    ).toBeInTheDocument();

    const closedCard = screen.getByRole("article", {
      name: "Candidate Carlos C.",
    });
    expect(
      within(closedCard).getByText("This position has been filled."),
    ).toBeInTheDocument();

    for (const card of [rejectedCard, closedCard]) {
      expect(
        within(card).queryByRole("button", { name: /approve for interview/i }),
      ).not.toBeInTheDocument();
      expect(
        within(card).queryByRole("button", { name: /request interview/i }),
      ).not.toBeInTheDocument();
      expect(
        within(card).queryByRole("button", { name: /decline/i }),
      ).not.toBeInTheDocument();
    }
  });
});
