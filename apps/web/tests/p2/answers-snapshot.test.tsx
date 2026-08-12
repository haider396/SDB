/**
 * Intake answers render FROM SNAPSHOTS (03 §1.4): the label shown is the
 * snapshot's label even when the live question has since been renamed, and
 * grouping comes from the snapshot's categoryKey. No live-question endpoint
 * is ever called.
 */
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installApiMock,
  makeAnswer,
  makeClient,
  makeDetail,
  makeRequisition,
  makeState,
  renderAdmin,
} from "./helpers";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("answers from snapshots", () => {
  it("renders the snapshot label and options, grouped by snapshot category", async () => {
    const client = makeClient({ companyName: "Acme Corp" });
    const requisition = makeRequisition({
      clientId: client.id,
      clientName: client.companyName,
    });
    const detail = makeDetail(requisition, {
      answers: [
        makeAnswer({
          questionKey: "english_spoken_required",
          // The API lifts a label from the snapshot; make it deliberately
          // DIFFERENT from the snapshot to prove the snapshot wins.
          label: "Live renamed label",
          questionType: "single_select",
          valueText: "professional",
          selectedOptions: [
            { value: "professional", label: "Professional (snapshot label)" },
          ],
          questionSnapshot: {
            questionKey: "english_spoken_required",
            label: "Spoken English requirement",
            questionType: "single_select",
            categoryKey: "requirements",
            capturedAt: "2026-08-01T00:00:00Z",
          },
        }),
        makeAnswer({
          questionKey: "team_size",
          label: "Team size",
          questionType: "number",
          valueNumber: 12,
          questionSnapshot: {
            questionKey: "team_size",
            label: "Team size",
            questionType: "number",
            categoryKey: "company_profile",
            capturedAt: "2026-08-01T00:00:00Z",
          },
        }),
        makeAnswer({
          questionKey: "needs_overlap",
          label: "Overlap needed",
          questionType: "yes_no",
          valueBoolean: true,
          questionSnapshot: {
            questionKey: "needs_overlap",
            label: "Overlap needed",
            questionType: "yes_no",
            categoryKey: "requirements",
            capturedAt: "2026-08-01T00:00:00Z",
          },
        }),
      ],
    });
    const mock = installApiMock(
      makeState({
        clients: [client],
        requisitions: [requisition],
        detailsById: { [requisition.id]: detail },
      }),
    );
    renderAdmin(`/admin/requisitions/${requisition.id}`);

    // Snapshot label wins over the (renamed) lifted label.
    expect(
      await screen.findByText("Spoken English requirement"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Live renamed label")).not.toBeInTheDocument();

    // Values render from the typed columns / snapshot option labels.
    expect(
      screen.getByText("Professional (snapshot label)"),
    ).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
    expect(screen.getByText("Yes")).toBeInTheDocument();

    // Category grouping comes from the snapshot's categoryKey, humanized.
    expect(screen.getByText("Requirements")).toBeInTheDocument();
    expect(screen.getByText("Company profile")).toBeInTheDocument();

    // No live-question endpoint is consulted to render history.
    expect(
      mock.requests.some((request) =>
        request.pathname.startsWith("/api/v1/questions"),
      ),
    ).toBe(false);
  });
});
