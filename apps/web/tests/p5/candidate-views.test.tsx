/**
 * Collapsed and expanded candidate views (T22).
 *
 * Rebecca, 13 Aug: *"there could be a potential where you have one title of a
 * position, but you're hiring three of that position… you might have 12 to 20
 * candidates here. And to be able to see all of those is a little bit
 * overwhelming with the expanded cards."*
 *
 * The two things these tests exist to stop:
 *
 * 1. **The list becoming a second implementation of the card.** Every decision
 *    must still come from the one CandidateCard, opened in a sheet. If the row
 *    ever grows its own Decline button, the two views drift and a client sees
 *    different choices depending on which one they happen to be in.
 * 2. **The row leaking a field the client-visible view withheld.** The card is
 *    documented as rendering the 02 §11 view shape and nothing else; the row
 *    has to obey the same rule, because it is the same PII gate.
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
  makeClientAssignment,
  makeRequisition,
  makeState,
  renderClientPortal,
} from "./helpers";
import { useUiStore } from "@/stores/ui-store";

/** A position with `count` presented candidates. */
function stateWith(count: number) {
  const requisition = makeRequisition({ status: "candidates_presented" });
  const rows = Array.from({ length: count }, (_, index) =>
    makeClientAssignment({
      requisitionId: requisition.id,
      displayName: `Candidate ${String(index + 1)}`,
    }),
  );
  return {
    state: makeState({
      requisitionDetail: requisition,
      assignmentsByRequisitionId: { [requisition.id]: rows },
    }),
    requisition,
    rows,
  };
}

function resetView(): void {
  useUiStore.setState({ candidateView: null });
}

describe("candidate views", () => {
  afterEach(() => {
    cleanup();
    resetView();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("shows full cards for a small position, with no preference set", async () => {
    const { state, requisition } = stateWith(3);
    installClientPortalApiMock(state);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    // A card is an <article>; a collapsed row is a button in a list.
    expect(
      await screen.findByRole("article", { name: "Candidate Candidate 1" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Review Candidate 1" }),
    ).not.toBeInTheDocument();
  });

  it("collapses to a list once a position gets large", async () => {
    // Rebecca's case: one title, three hires, twelve people to look at.
    const { state, requisition } = stateWith(12);
    installClientPortalApiMock(state);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    expect(
      await screen.findByRole("button", { name: "Review Candidate 1" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("article", { name: "Candidate Candidate 1" }),
    ).not.toBeInTheDocument();
  });

  it("an explicit choice beats the size default, and is remembered", async () => {
    const user = userEvent.setup();
    const { state, requisition } = stateWith(12);
    installClientPortalApiMock(state);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    await screen.findByRole("button", { name: "Review Candidate 1" });
    await user.click(screen.getByRole("button", { name: /Cards/ }));

    // Twelve candidates, but the client asked for cards — they get cards.
    expect(
      await screen.findByRole("article", { name: "Candidate Candidate 1" }),
    ).toBeInTheDocument();
    // And the choice outlives this page, which is the point of storing it.
    expect(useUiStore.getState().candidateView).toBe("cards");
  });

  it("opens the FULL card in a sheet, so decisions never live on the row", async () => {
    const user = userEvent.setup();
    const { state, requisition } = stateWith(12);
    installClientPortalApiMock(state);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    const row = await screen.findByRole("button", {
      name: "Review Candidate 1",
    });
    // The row itself offers no decision — that is the whole design.
    expect(
      screen.queryByRole("button", { name: "Move forward to interview" }),
    ).not.toBeInTheDocument();

    await user.click(row);

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("article", { name: "Candidate Candidate 1" }),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: "Move forward to interview" }),
    ).toBeInTheDocument();
  });

  it("is operable from the keyboard alone, and returns focus to the row", async () => {
    // AC-UI-04. The row is a real button, so Enter opens it — and Radix hands
    // focus back on close, which is what stops a keyboard user losing their
    // place halfway down a list of twenty.
    const user = userEvent.setup();
    const { state, requisition } = stateWith(12);
    installClientPortalApiMock(state);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    const row = await screen.findByRole("button", {
      name: "Review Candidate 1",
    });
    row.focus();
    await user.keyboard("{Enter}");
    await screen.findByRole("dialog");

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(document.activeElement).toBe(row);
  });

  it("the collapsed row shows nothing the card does not", async () => {
    // The row reads ClientVisibleAssignment and only that. This asserts the
    // gate holds in the new view: at `presented`, last name / email / phone
    // are NULL in the SQL view, so they cannot appear here either.
    const { state, requisition } = stateWith(12);
    installClientPortalApiMock(state);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    const row = await screen.findByRole("button", {
      name: "Review Candidate 1",
    });
    expect(row.textContent).not.toMatch(/@/);
    expect(row.textContent).not.toMatch(/\+?\d{7,}/);
  });
});
