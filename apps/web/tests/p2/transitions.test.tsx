/**
 * StageTracker: transition buttons render ONLY the statuses allowed from the
 * current state by the 01 §4 adjacency map, and a server 409
 * INVALID_TRANSITION surfaces with its from/to detail.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RequisitionStatus } from "@sdb/contracts";
import { RequisitionStatusSchema } from "@sdb/contracts";
import { REQUISITION_STATUS_META } from "@/components/patterns/status-badge";
import { allowedTransitions } from "@/features/requisitions/status-machine";
import {
  errorResponse,
  installApiMock,
  makeClient,
  makeDetail,
  makeEvent,
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

function setup(status: RequisitionStatus) {
  const client = makeClient({ companyName: "Acme Corp" });
  const requisition = makeRequisition({
    clientId: client.id,
    clientName: client.companyName,
    status,
  });
  const detail = makeDetail(requisition);
  const state = makeState({
    clients: [client],
    requisitions: [requisition],
    detailsById: { [requisition.id]: detail },
  });
  return { client, requisition, state };
}

async function moveToButtons(): Promise<string[]> {
  const heading = await screen.findByText("Move to");
  const container = heading.closest("div");
  if (container === null) throw new Error("No transition container");
  return within(container)
    .getAllByRole("button")
    .map((button) => button.textContent ?? "");
}

describe("stage tracker transitions", () => {
  // Non-terminal, non-on_hold statuses: buttons must equal the local map.
  const cases = RequisitionStatusSchema.options.filter(
    (status) =>
      status !== "placed" && status !== "closed_unfilled" && status !== "on_hold",
  );

  it.each(cases)("renders only the allowed targets from %s", async (status) => {
    const { state } = setup(status);
    installApiMock(state);
    // ?tab=overview pins the Overview tab: active-phase statuses now
    // default to the Pipeline tab (UX 2.3), and the tracker lives here.
    renderAdmin(
      `/admin/requisitions/${state.requisitions[0]?.id ?? ""}?tab=overview`,
    );

    const labels = await moveToButtons();
    const expected = allowedTransitions(status).map(
      (target) => REQUISITION_STATUS_META[target].label,
    );
    expect(labels).toEqual(expected);
  });

  it("offers no transitions from a terminal status (AC-RQ-03)", async () => {
    const { state } = setup("placed");
    installApiMock(state);
    renderAdmin(`/admin/requisitions/${state.requisitions[0]?.id ?? ""}`);

    expect(
      await screen.findByText(/terminal status — no further transitions/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Move to")).not.toBeInTheDocument();
  });

  it("derives the on_hold resume target from the event log", async () => {
    const { state, requisition } = setup("on_hold");
    state.eventsByRequisitionId[requisition.id] = [
      makeEvent({
        entityId: requisition.id,
        fromValue: "sourcing",
        toValue: "on_hold",
        occurredAt: "2026-08-10T09:00:00+00:00",
      }),
    ];
    installApiMock(state);
    renderAdmin(`/admin/requisitions/${requisition.id}`);

    const labels = await moveToButtons();
    expect(labels).toEqual(["Sourcing", "Closed unfilled"]);
  });

  it("surfaces a 409 INVALID_TRANSITION with the server's from/to", async () => {
    const user = userEvent.setup();
    const { state, requisition } = setup("sourcing");
    installApiMock(state, (request) =>
      request.pathname.endsWith("/transition")
        ? errorResponse(
            "INVALID_TRANSITION",
            "Invalid transition.",
            409,
            { from: "candidates_presented", to: "sourcing" },
          )
        : undefined,
    );
    renderAdmin(`/admin/requisitions/${requisition.id}?tab=overview`);

    await user.click(
      await screen.findByRole("button", { name: "Candidates presented" }),
    );
    expect(
      await screen.findByText(
        /candidates_presented → sourcing is not allowed/i,
      ),
    ).toBeInTheDocument();
  });

  it("closed_unfilled goes through the typed-name confirm (UX 2.2)", async () => {
    const user = userEvent.setup();
    const { state, requisition } = setup("sourcing");
    const mock = installApiMock(state);
    renderAdmin(`/admin/requisitions/${requisition.id}?tab=overview`);

    await user.click(
      await screen.findByRole("button", { name: "Closed unfilled" }),
    );
    // No transition yet — the typed confirm intercepts.
    expect(
      mock.requests.some((request) => request.pathname.endsWith("/transition")),
    ).toBe(false);

    const dialog = await screen.findByRole("dialog");
    const confirm = within(dialog).getByRole("button", {
      name: "Close unfilled",
    });
    expect(confirm).toBeDisabled();

    await user.type(
      within(dialog).getByLabelText(/Type/),
      requisition.reference,
    );
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => {
      const post = mock.requests.find((request) =>
        request.pathname.endsWith("/transition"),
      );
      expect(post?.body).toEqual({ toStatus: "closed_unfilled" });
    });
  });

  it("applies a successful transition and updates the badge", async () => {
    const user = userEvent.setup();
    const { state, requisition } = setup("sourcing");
    const mock = installApiMock(state);
    renderAdmin(`/admin/requisitions/${requisition.id}?tab=overview`);

    await user.click(
      await screen.findByRole("button", { name: "Candidates presented" }),
    );
    // Badge + tracker reflect the new status after the refetch.
    expect(
      await screen.findAllByText("Candidates presented"),
    ).not.toHaveLength(0);
    const transition = mock.requests.find((request) =>
      request.pathname.endsWith("/transition"),
    );
    expect(transition?.body).toEqual({ toStatus: "candidates_presented" });
  });
});
