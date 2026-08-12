/**
 * Board rendering + the 05 §4.7 disabled-during-drag requirement. Real
 * pointer drags are unreliable in jsdom, so (per the P4 brief) the DnD
 * legality lives in pure functions (stage-machine.test.ts) and the visual
 * contract is asserted here by rendering StageColumn with a simulated
 * drag state (`activeStage`), checking aria-disabled + disabled styling.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, within } from "@testing-library/react";
import { render } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import { StageColumn } from "@/features/pipeline/components/stage-column";
import {
  installPipelineApiMock,
  makeAssignment,
  makeCandidate,
  makeDetail,
  makePipelineState,
  makeRequisition,
  renderPipeline,
} from "./helpers";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("StageColumn drop states during a simulated drag", () => {
  it("visually disables a column unreachable from the dragged stage", () => {
    render(
      <DndContext>
        {/* Dragging a sourced card: offer is not reachable. */}
        <StageColumn stage="offer" activeStage="sourced" count={0}>
          <p>content</p>
        </StageColumn>
      </DndContext>,
    );
    const column = screen.getByRole("region", { name: "Offer column" });
    expect(column).toHaveAttribute("aria-disabled", "true");
    expect(column).toHaveAttribute("data-drop-state", "disabled");
    expect(column.className).toContain("opacity-40");
    expect(column.className).toContain("cursor-not-allowed");
  });

  it("highlights a legal target column and keeps it enabled", () => {
    render(
      <DndContext>
        <StageColumn stage="screened" activeStage="sourced" count={2}>
          <p>content</p>
        </StageColumn>
      </DndContext>,
    );
    const column = screen.getByRole("region", { name: "Screened column" });
    expect(column).toHaveAttribute("aria-disabled", "false");
    expect(column).toHaveAttribute("data-drop-state", "valid");
    expect(column.className).not.toContain("opacity-40");
  });

  it("renders neutrally when no drag is in progress", () => {
    render(
      <DndContext>
        <StageColumn stage="offer" activeStage={null} count={0}>
          <p>content</p>
        </StageColumn>
      </DndContext>,
    );
    const column = screen.getByRole("region", { name: "Offer column" });
    expect(column).toHaveAttribute("data-drop-state", "idle");
    expect(column).toHaveAttribute("aria-disabled", "false");
  });
});

describe("pipeline board", () => {
  const requisition = makeRequisition();

  beforeEach(() => {
    const vettedCandidate = makeCandidate({
      firstName: "Maria",
      lastName: "Gonzalez",
      country: "Philippines",
      currentTitle: "Executive Assistant",
      hasConsentToShareProfile: true,
    });
    const sourcedCandidate = makeCandidate({
      firstName: "Jon",
      lastName: "Reyes",
      hasConsentToShareProfile: false,
    });
    const noConsentVetted = makeCandidate({
      firstName: "Ana",
      lastName: "Cruz",
      hasConsentToShareProfile: false,
    });
    const rejectedCandidate = makeCandidate({
      firstName: "Leo",
      lastName: "Tan",
    });
    const state = makePipelineState({
      requisition,
      candidates: [
        vettedCandidate,
        sourcedCandidate,
        noConsentVetted,
        rejectedCandidate,
      ],
      detailsById: {
        [vettedCandidate.id]: makeDetail({
          ...vettedCandidate,
          englishSpokenLevel: "professional",
          accentStrength: "light",
        }),
        [sourcedCandidate.id]: makeDetail(sourcedCandidate),
        [noConsentVetted.id]: makeDetail(noConsentVetted),
        [rejectedCandidate.id]: makeDetail(rejectedCandidate),
      },
      assignments: [],
    });
    state.assignments = [
      makeAssignment({
        requisition,
        candidate: vettedCandidate,
        stage: "vetted",
      }),
      makeAssignment({
        requisition,
        candidate: sourcedCandidate,
        stage: "sourced",
      }),
      makeAssignment({
        requisition,
        candidate: noConsentVetted,
        stage: "vetted",
      }),
      makeAssignment({
        requisition,
        candidate: rejectedCandidate,
        stage: "rejected_by_admin",
      }),
    ];
    installPipelineApiMock(state);
  });

  it("renders all nine columns, cards with chips, and the terminal group with counts", async () => {
    renderPipeline(requisition.id);

    const vettedColumn = await screen.findByRole("region", {
      name: "Vetted column",
    });
    expect(await within(vettedColumn).findByText("Maria G.")).toBeInTheDocument();

    for (const name of [
      "Sourced column",
      "Screened column",
      "Vetted column",
      "Presented column",
      "Client reviewing column",
      "Interview scheduled column",
      "Interviewed column",
      "Offer column",
      "Placed column",
    ]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }

    // English + accent chips hydrate from the candidate detail.
    expect(
      await within(vettedColumn).findByText("Professional English"),
    ).toBeInTheDocument();
    expect(
      within(vettedColumn).getByText("Light accent"),
    ).toBeInTheDocument();
    // Country flag with accessible name.
    expect(
      within(vettedColumn).getByRole("img", { name: "Philippines" }),
    ).toBeInTheDocument();
    // Days-in-stage marker.
    expect(
      within(vettedColumn).getAllByText(/\d+d in stage/).length,
    ).toBeGreaterThan(0);

    // Consent-missing warning only on the unconsented vetted card.
    const consentWarnings = within(vettedColumn).getAllByText(
      "Consent missing — cannot be presented",
    );
    expect(consentWarnings).toHaveLength(1);

    // Terminal group is a collapsed side list with counts.
    const closed = screen.getByRole("complementary", {
      name: "Closed assignments",
    });
    const adminRejected = within(closed).getByRole("button", {
      name: /Rejected by admin/,
    });
    expect(within(adminRejected).getByText("1")).toBeInTheDocument();
    expect(within(closed).queryByText("Leo T.")).not.toBeInTheDocument();
  });

  it("card menu offers only machine-legal advance targets", async () => {
    renderPipeline(requisition.id);
    const vettedColumn = await screen.findByRole("region", {
      name: "Vetted column",
    });
    await within(vettedColumn).findByText("Maria G.");

    const menuButton = within(vettedColumn).getByRole("button", {
      name: "Actions for Maria G.",
    });
    menuButton.click();

    const menu = await screen.findByRole("menu", {
      name: "Actions for Maria G.",
    });
    const items = within(menu)
      .getAllByRole("menuitem")
      .map((item) => item.textContent);
    expect(items).toEqual([
      "View candidate",
      "Advance to Presented",
      "Advance to Withdrawn",
      "Add note",
      "Reject…",
    ]);
  });
});
