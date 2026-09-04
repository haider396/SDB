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

/**
 * Since T4/T21 the forward move and the detours live in different places: the
 * forward action is the primary button in NextStepCard (main column, under the
 * brief) and only the pause/close detours remain in the rail's tracker.
 *
 * These helpers assert the SPLIT is right, and the tests below assert the
 * adjacency map is still respected — by checking the status actually POSTed,
 * not the button's wording, which is deliberately friendly copy now.
 */
async function detourButtons(): Promise<string[]> {
  const heading = await screen.findByText(/not moving forward/i);
  const container = heading.closest("div");
  if (container === null) throw new Error("No detour container");
  return within(container)
    .getAllByRole("button")
    .map((button) => button.textContent ?? "");
}

/** The single primary forward action, or null when the status is terminal. */
function nextStepButton(): HTMLElement | null {
  const heading = screen.queryByText("Next step");
  const card = heading?.closest("div")?.parentElement ?? null;
  if (card === null) return null;
  const buttons = within(card).queryAllByRole("button");
  return buttons[0] ?? null;
}

describe("stage tracker transitions", () => {
  // Non-terminal, non-on_hold statuses: buttons must equal the local map.
  const cases = RequisitionStatusSchema.options.filter(
    (status) =>
      status !== "placed" && status !== "closed_unfilled" && status !== "on_hold",
  );

  it.each(cases)(
    "offers exactly the map's detours in the rail from %s",
    async (status) => {
      const { state } = setup(status);
      installApiMock(state);
      // ?tab=overview pins the Overview tab: active-phase statuses now
      // default to the Pipeline tab (UX 2.3), and the tracker lives here.
      renderAdmin(
        `/admin/requisitions/${state.requisitions[0]?.id ?? ""}?tab=overview`,
      );

      const labels = await detourButtons();
      const expected = allowedTransitions(status)
        .filter((target) => target === "on_hold" || target === "closed_unfilled")
        .map((target) => REQUISITION_STATUS_META[target].label);
      expect(labels).toEqual(expected);
    },
  );

  it.each(cases)(
    "posts the map's forward target from %s when the next step is clicked",
    async (status) => {
      const user = userEvent.setup();
      const { state } = setup(status);
      const mock = installApiMock(state);
      renderAdmin(
        `/admin/requisitions/${state.requisitions[0]?.id ?? ""}?tab=overview`,
      );

      // The forward target from the local adjacency map — the one status that
      // is neither a pause nor a close.
      const forward = allowedTransitions(status).find(
        (target) => target !== "on_hold" && target !== "closed_unfilled",
      );

      const button = await waitFor(() => {
        const found = nextStepButton();
        if (found === null) throw new Error("Next step button not rendered");
        return found;
      });
      await user.click(button);

      await waitFor(() => {
        const posted = mock.requests.find((request) =>
          request.pathname.endsWith("/transition"),
        );
        expect(posted?.body).toEqual({ toStatus: forward });
      });
    },
  );

  it("offers no transitions from a terminal status (AC-RQ-03)", async () => {
    const { state } = setup("placed");
    installApiMock(state);
    renderAdmin(`/admin/requisitions/${state.requisitions[0]?.id ?? ""}`);

    expect(
      await screen.findByText(/terminal status — no further transitions/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/not moving forward/i)).not.toBeInTheDocument();
    // No forward action either — a terminal placement offers nothing.
    expect(nextStepButton()).toBeNull();
  });

  it("derives the on_hold resume target from the event log", async () => {
    const user = userEvent.setup();
    const { state, requisition } = setup("on_hold");
    state.eventsByRequisitionId[requisition.id] = [
      makeEvent({
        entityId: requisition.id,
        fromValue: "sourcing",
        toValue: "on_hold",
        occurredAt: "2026-08-10T09:00:00+00:00",
      }),
    ];
    const mock = installApiMock(state);
    renderAdmin(`/admin/requisitions/${requisition.id}?tab=overview`);

    // Resuming from on_hold is the FORWARD move, so it is the next step; only
    // "Closed unfilled" remains as a detour.
    expect(await detourButtons()).toEqual(["Closed unfilled"]);

    const button = await waitFor(() => {
      const found = nextStepButton();
      if (found === null) throw new Error("Next step button not rendered");
      return found;
    });
    await user.click(button);
    await waitFor(() => {
      const posted = mock.requests.find((request) =>
        request.pathname.endsWith("/transition"),
      );
      // Resumes to the status it was paused from, per the event log.
      expect(posted?.body).toEqual({ toStatus: "sourcing" });
    });
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

    const button = await waitFor(() => {
      const found = nextStepButton();
      if (found === null) throw new Error("Next step button not rendered");
      return found;
    });
    await user.click(button);
    expect(
      await screen.findByText(/has moved since the page loaded/i),
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

    const button = await waitFor(() => {
      const found = nextStepButton();
      if (found === null) throw new Error("Next step button not rendered");
      return found;
    });
    await user.click(button);
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
