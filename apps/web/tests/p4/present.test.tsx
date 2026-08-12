/**
 * The present flow (05 §4.7 "Candidate presentation", AC-PL-05, AC-UI-04):
 * multi-select on the vetted column → review sheet rendering exactly the
 * client-visible fields with gated PII listed as withheld → one confirm →
 * POST /assignments/present with the exact body. A consent gap blocks the
 * confirm; a server-side 422 CONSENT_MISSING maps offender ids to names.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Candidate } from "@sdb/contracts";
import {
  installPipelineApiMock,
  makeAssignment,
  makeCandidate,
  makeDetail,
  makeFileDetail,
  makePipelineState,
  makeRequisition,
  renderPipeline,
  type PipelineApiMock,
} from "./helpers";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

describe("present flow", () => {
  const requisition = makeRequisition();
  let mock: PipelineApiMock;
  let consented: Candidate;
  let unconsented: Candidate;

  function setup(includeUnconsented: boolean): void {
    consented = makeCandidate({
      firstName: "Maria",
      lastName: "Gonzalez",
      country: "Philippines",
      currentTitle: "Executive Assistant",
      hasConsentToShareProfile: true,
    });
    unconsented = makeCandidate({
      firstName: "Ana",
      lastName: "Cruz",
      hasConsentToShareProfile: false,
    });
    const candidates = includeUnconsented
      ? [consented, unconsented]
      : [consented];
    const state = makePipelineState({
      requisition,
      candidates,
      detailsById: {
        [consented.id]: makeDetail(
          {
            ...consented,
            englishSpokenLevel: "professional",
            englishWrittenLevel: "native_equivalent",
            accentStrength: "light",
            yearsExperienceTotal: 8,
            currentTitle: "Executive Assistant",
            seniorityLevel: "senior",
            hasUsClientExperience: true,
            recruiterRecommendation: "Excellent communicator.",
            strengths: "Calendar mastery.",
            city: "Manila",
          },
          {
            files: [
              makeFileDetail(consented.id, "cv.pdf", true),
              makeFileDetail(consented.id, "internal-notes.pdf", false),
            ],
          },
        ),
        [unconsented.id]: makeDetail(unconsented),
      },
    });
    state.assignments = candidates.map((candidate) =>
      makeAssignment({ requisition, candidate, stage: "vetted" }),
    );
    mock = installPipelineApiMock(state);
  }

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  async function enterSelectModeAndSelectAll(): Promise<
    ReturnType<typeof userEvent.setup>
  > {
    const user = userEvent.setup();
    const vettedColumn = await screen.findByRole("region", {
      name: "Vetted column",
    });
    await within(vettedColumn).findByText("Maria G.");
    await user.click(
      screen.getByRole("button", { name: "Select to present" }),
    );
    for (const checkbox of within(vettedColumn).getAllByRole("checkbox")) {
      await user.click(checkbox);
    }
    return user;
  }

  it("renders the exact client preview: visible fields, withheld PII, files", async () => {
    setup(false);
    renderPipeline(requisition.id);
    const user = await enterSelectModeAndSelectAll();

    await user.click(
      screen.getByRole("button", { name: "Present 1 candidate" }),
    );

    const preview = await screen.findByLabelText(
      "Client preview for Maria G.",
    );

    // Always-visible fields from ClientVisibleAssignmentSchema.
    expect(within(preview).getByText(/Maria G\./)).toBeInTheDocument();
    expect(within(preview).getByText("Professional")).toBeInTheDocument();
    expect(within(preview).getByText("Native-equivalent")).toBeInTheDocument();
    expect(within(preview).getByText("Light accent")).toBeInTheDocument();
    expect(within(preview).getByText("8 years")).toBeInTheDocument();
    expect(
      within(preview).getByText("Executive Assistant"),
    ).toBeInTheDocument();
    expect(within(preview).getByText("Senior")).toBeInTheDocument();
    expect(
      within(preview).getByText("Excellent communicator."),
    ).toBeInTheDocument();
    expect(within(preview).getByText("Calendar mastery.")).toBeInTheDocument();
    expect(within(preview).getByText(/Manila/)).toBeInTheDocument();

    // Only client-visible files appear.
    expect(within(preview).getByText(/cv\.pdf/)).toBeInTheDocument();
    expect(
      within(preview).queryByText(/internal-notes\.pdf/),
    ).not.toBeInTheDocument();

    // All six gated PII fields are listed as withheld — never with values.
    const withheld = within(preview).getByRole("list", {
      name: "Fields withheld from the client for Maria G.",
    });
    const chips = within(withheld)
      .getAllByRole("listitem")
      .map((item) => item.textContent ?? "");
    for (const label of [
      "Last name",
      "Email",
      "Phone",
      "WhatsApp",
      "LinkedIn",
      "Current employer",
    ]) {
      expect(chips.some((chip) => chip.includes(label))).toBe(true);
    }
    expect(chips).toHaveLength(6);
    // The real last name never leaks into the preview.
    expect(within(preview).queryByText(/Gonzalez/)).not.toBeInTheDocument();

    expect(within(preview).getByText("Consent on file")).toBeInTheDocument();
  });

  it("one confirm posts the exact body and presents", async () => {
    setup(false);
    renderPipeline(requisition.id);
    const user = await enterSelectModeAndSelectAll();
    await user.click(
      screen.getByRole("button", { name: "Present 1 candidate" }),
    );

    await screen.findByLabelText("Client preview for Maria G.");
    await user.type(
      screen.getByLabelText("Note to the client (optional)"),
      "Two strong options",
    );

    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Present 1 candidate" }),
    );

    await waitFor(() => {
      const post = mock.requests.find(
        (request) =>
          request.method === "POST" &&
          request.pathname === "/api/v1/assignments/present",
      );
      expect(post).toBeDefined();
      expect(post?.body).toEqual({
        assignmentIds: [mock.state.assignments[0]?.id],
        clientNote: "Two strong options",
      });
    });

    // Board refresh: the card is now in the presented column.
    await waitFor(() => {
      const presented = screen.getByRole("region", {
        name: "Presented column",
      });
      expect(within(presented).getByText("Maria G.")).toBeInTheDocument();
    });
  });

  it("blocks the confirm while any selected candidate lacks consent", async () => {
    setup(true);
    renderPipeline(requisition.id);
    const user = await enterSelectModeAndSelectAll();
    await user.click(
      screen.getByRole("button", { name: "Present 2 candidates" }),
    );

    await screen.findByLabelText("Client preview for Maria G.");
    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByRole("button", { name: "Present 2 candidates" }),
    ).toBeDisabled();
    const alerts = within(dialog).getAllByRole("alert");
    expect(
      alerts.some((alert) => alert.textContent?.includes("Ana C.")),
    ).toBe(true);

    // No present request was made.
    expect(
      mock.requests.some(
        (request) =>
          request.method === "POST" &&
          request.pathname === "/api/v1/assignments/present",
      ),
    ).toBe(false);
  });

  it("maps a server-side 422 CONSENT_MISSING to offender names inline", async () => {
    setup(false);
    renderPipeline(requisition.id);
    // Force the server to reject despite the local consent flag: reinstall
    // the mock with an override that 422s the present call.
    const user = await enterSelectModeAndSelectAll();
    const state = mock.state;
    mock = installPipelineApiMock(state, (request) => {
      if (
        request.method === "POST" &&
        request.pathname === "/api/v1/assignments/present"
      ) {
        return new Response(
          JSON.stringify({
            error: {
              code: "CONSENT_MISSING",
              message: "One or more candidates have not consented.",
              details: { candidateIds: [consented.id] },
              requestId: "req-test-422",
            },
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        );
      }
      return undefined;
    });

    await user.click(
      screen.getByRole("button", { name: "Present 1 candidate" }),
    );
    await screen.findByLabelText("Client preview for Maria G.");
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Present 1 candidate" }),
    );

    await waitFor(() => {
      const alerts = within(dialog).getAllByRole("alert");
      expect(
        alerts.some((alert) =>
          alert.textContent?.includes("Consent is missing for: Maria G."),
        ),
      ).toBe(true);
    });
  });
});
