/**
 * P6 — the Reject dialog now runs on the REAL GET /rejection-reasons
 * taxonomy: options come from the endpoint (actor=admin, isActive=true) and
 * submit posts the row's `reasonId`. The seeded fallback (label as
 * `reasonOther`) remains only for taxonomy outages — pinned by the p4 suite.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RejectionReason } from "@sdb/contracts";
import {
  installPipelineApiMock,
  jsonResponse,
  makeAssignment,
  makeCandidate,
  makeDetail,
  makePipelineState,
  makeRequisition,
  renderPipeline,
  testUuid,
  type PipelineApiMock,
  type RecordedRequest,
} from "../p4/helpers";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

const REASONS: RejectionReason[] = [
  {
    id: testUuid(),
    key: "failed_vetting",
    label: "Failed vetting",
    actor: "admin",
    sortOrder: 1,
    isActive: true,
  },
  {
    id: testUuid(),
    key: "other_admin",
    label: "Other",
    actor: "admin",
    sortOrder: 99,
    isActive: true,
  },
];

describe("reject dialog with the live rejection-reasons taxonomy", () => {
  const requisition = makeRequisition();
  let mock: PipelineApiMock;

  beforeEach(() => {
    const candidate = makeCandidate({
      firstName: "Maria",
      lastName: "Gonzalez",
    });
    const state = makePipelineState({
      requisition,
      candidates: [candidate],
      detailsById: { [candidate.id]: makeDetail(candidate) },
    });
    state.assignments = [
      makeAssignment({ requisition, candidate, stage: "offer" }),
    ];
    mock = installPipelineApiMock(state, (request: RecordedRequest) => {
      if (
        request.method === "GET" &&
        request.pathname === "/api/v1/rejection-reasons"
      ) {
        return jsonResponse({
          data: REASONS,
          meta: { count: REASONS.length, nextCursor: null },
        });
      }
      return undefined;
    });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("fetches actor=admin reasons and posts the chosen row's reasonId", async () => {
    renderPipeline(requisition.id);
    const user = userEvent.setup();
    const column = await screen.findByRole("region", { name: "Offer column" });
    await within(column).findByText("Maria G.");
    await user.click(
      within(column).getByRole("button", { name: "Actions for Maria G." }),
    );
    await screen.findByRole("menu");
    await user.click(screen.getByRole("menuitem", { name: "Reject…" }));
    const dialog = await screen.findByRole("dialog");

    // The listing call carried the admin-actor filter.
    await waitFor(() => {
      const listing = mock.requests.find(
        (request) => request.pathname === "/api/v1/rejection-reasons",
      );
      expect(listing).toBeDefined();
      expect(listing?.search.get("actor")).toBe("admin");
      expect(listing?.search.get("isActive")).toBe("true");
    });

    await user.selectOptions(
      within(dialog).getByLabelText("Reason"),
      "failed_vetting",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Reject candidate" }),
    );

    // The body carries the REAL row id — not the label as reasonOther.
    await waitFor(() => {
      const post = mock.requests.find((request) =>
        request.pathname.endsWith("/reject"),
      );
      expect(post).toBeDefined();
      expect(post?.body).toEqual({ reasonId: REASONS[0]?.id });
    });
  });

  it("an endpoint 'Other' row requires text and posts reasonId AND the text as reasonOther", async () => {
    renderPipeline(requisition.id);
    const user = userEvent.setup();
    const column = await screen.findByRole("region", { name: "Offer column" });
    await within(column).findByText("Maria G.");
    await user.click(
      within(column).getByRole("button", { name: "Actions for Maria G." }),
    );
    await screen.findByRole("menu");
    await user.click(screen.getByRole("menuitem", { name: "Reject…" }));
    const dialog = await screen.findByRole("dialog");

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

    await user.type(
      within(dialog).getByLabelText("Describe the reason"),
      "Profile withdrawn",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Reject candidate" }),
    );

    await waitFor(() => {
      const post = mock.requests.find((request) =>
        request.pathname.endsWith("/reject"),
      );
      // Both fields: the row id for grouping, the text for the report's
      // expandable free-text list.
      expect(post?.body).toEqual({
        reasonId: REASONS[1]?.id,
        reasonOther: "Profile withdrawn",
      });
    });
  });
});
