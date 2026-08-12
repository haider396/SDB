/**
 * Reject dialog (AC-PL-10/11: reason-or-other required, actor never sent)
 * and Place dialog (AC-PL-13: start date required, exact body, success
 * state explaining sibling closure).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

describe("reject and place dialogs", () => {
  const requisition = makeRequisition();
  let mock: PipelineApiMock;

  beforeEach(() => {
    const offerCandidate = makeCandidate({
      firstName: "Maria",
      lastName: "Gonzalez",
      hasConsentToShareProfile: true,
    });
    const siblingCandidate = makeCandidate({
      firstName: "Ana",
      lastName: "Cruz",
    });
    const state = makePipelineState({
      requisition,
      candidates: [offerCandidate, siblingCandidate],
      detailsById: {
        [offerCandidate.id]: makeDetail(offerCandidate),
        [siblingCandidate.id]: makeDetail(siblingCandidate),
      },
    });
    state.assignments = [
      makeAssignment({ requisition, candidate: offerCandidate, stage: "offer" }),
      makeAssignment({
        requisition,
        candidate: siblingCandidate,
        stage: "screened",
      }),
    ];
    mock = installPipelineApiMock(state);
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function openMenu(columnName: string, actionsName: string) {
    const user = userEvent.setup();
    const column = await screen.findByRole("region", { name: columnName });
    await within(column).findByText("Maria G.");
    await user.click(
      within(column).getByRole("button", { name: actionsName }),
    );
    await screen.findByRole("menu");
    return user;
  }

  it("reject requires a reason or Other text before submitting", async () => {
    const user = await openMenuAfterRender("Offer column");
    await user.click(screen.getByRole("menuitem", { name: "Reject…" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Reject candidate" }),
    );
    expect(
      within(dialog).getByText("Choose a rejection reason."),
    ).toBeInTheDocument();
    expect(
      mock.requests.some((request) => request.pathname.endsWith("/reject")),
    ).toBe(false);

    // Choosing "Other" without text is also rejected.
    await user.selectOptions(
      within(dialog).getByLabelText("Reason"),
      "other_admin",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Reject candidate" }),
    );
    expect(
      within(dialog).getByText("Describe the reason when choosing Other."),
    ).toBeInTheDocument();

    // With text it submits reasonOther + optional detail, no actor field.
    await user.type(
      within(dialog).getByLabelText("Describe the reason"),
      "Portfolio mismatch",
    );
    await user.type(
      within(dialog).getByLabelText("Detail (optional)"),
      "Notes here",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Reject candidate" }),
    );

    await waitFor(() => {
      const post = mock.requests.find((request) =>
        request.pathname.endsWith("/reject"),
      );
      expect(post).toBeDefined();
      expect(post?.body).toEqual({
        reasonOther: "Portfolio mismatch",
        detail: "Notes here",
      });
    });

    // The card lands in the terminal group.
    await waitFor(() => {
      const closed = screen.getByRole("complementary", {
        name: "Closed assignments",
      });
      const adminRejected = within(closed).getByRole("button", {
        name: /Rejected by admin/,
      });
      expect(within(adminRejected).getByText("1")).toBeInTheDocument();
    });
  });

  it("a taxonomy reason submits its label as reasonOther (no seeded ids yet)", async () => {
    const user = await openMenuAfterRender("Offer column");
    await user.click(screen.getByRole("menuitem", { name: "Reject…" }));
    const dialog = await screen.findByRole("dialog");

    await user.selectOptions(
      within(dialog).getByLabelText("Reason"),
      "failed_vetting",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Reject candidate" }),
    );

    await waitFor(() => {
      const post = mock.requests.find((request) =>
        request.pathname.endsWith("/reject"),
      );
      expect(post?.body).toEqual({ reasonOther: "Failed vetting" });
    });
  });

  it("place requires a start date, posts the body, and explains sibling closure", async () => {
    const user = await openMenuAfterRender("Offer column");
    await user.click(screen.getByRole("menuitem", { name: "Place…" }));

    const dialog = await screen.findByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Place candidate" }),
    );
    expect(
      within(dialog).getByText("A start date is required."),
    ).toBeInTheDocument();
    expect(
      mock.requests.some((request) => request.pathname.endsWith("/place")),
    ).toBe(false);

    await user.type(
      within(dialog).getByLabelText("Start date"),
      "2026-09-01",
    );
    await user.type(within(dialog).getByLabelText("Rate"), "1500");
    await user.selectOptions(within(dialog).getByLabelText("Per"), "monthly");
    await user.type(within(dialog).getByLabelText("Hours / week"), "40");
    await user.selectOptions(
      within(dialog).getByLabelText("Service tier"),
      "standard_placement",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Place candidate" }),
    );

    await waitFor(() => {
      const post = mock.requests.find((request) =>
        request.pathname.endsWith("/place"),
      );
      expect(post).toBeDefined();
      expect(post?.body).toEqual({
        startDate: "2026-09-01",
        rateAmount: 1500,
        rateUnit: "monthly",
        rateCurrency: "USD",
        hoursPerWeek: 40,
        serviceTier: "standard_placement",
      });
    });

    // Success state names the sibling closure.
    expect(
      await within(dialog).findByText("Placement created"),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/closed as/i).textContent,
    ).toContain("Not selected");

    // Board refresh: sibling shows in the terminal group as not selected.
    const user2 = user;
    await user2.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => {
      const closed = screen.getByRole("complementary", {
        name: "Closed assignments",
      });
      const notSelected = within(closed).getByRole("button", {
        name: /Not selected/,
      });
      expect(within(notSelected).getByText("1")).toBeInTheDocument();
    });
  });

  async function openMenuAfterRender(columnName: string) {
    renderPipeline(requisition.id);
    return openMenu(columnName, "Actions for Maria G.");
  }
});
