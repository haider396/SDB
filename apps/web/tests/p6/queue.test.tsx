/**
 * P6 — the admin attention queue (01 §6, AC-PL-14 spirit): all seven
 * buckets render with counts and per-entity deep links, empty buckets
 * collapse to a slim all-clear row, the Refresh button re-requests with
 * `?refresh=true`, and a fully clear queue celebrates instead of listing.
 */
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));
import { BUCKET_DISPLAY_ORDER } from "@/features/admin-dashboard/labels";
import { formatDateTime } from "@/lib/format";
import {
  installDashboardApiMock,
  makeDashboardState,
  makeQueue,
  makeQueueItem,
  renderDashboardPage,
  type DashboardApiMock,
} from "./helpers";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("attention queue page", () => {
  it("renders all seven buckets: counts on populated ones, all-clear rows on empty ones, most-urgent-first order", async () => {
    const intake = makeQueueItem("requisition", {
      reference: "REQ-000201",
      label: "REQ-000201 — Executive Assistant",
    });
    const payment = makeQueueItem("client", {
      reference: "Acme Corp",
      label: "Acme Corp",
    });
    installDashboardApiMock(
      makeDashboardState({
        queue: makeQueue({
          new_intake_submissions: [intake],
          payment_confirmed_access_not_granted: [payment],
        }),
      }),
    );
    renderDashboardPage("/admin");

    // Every bucket is present as a labelled section.
    const intakeSection = await screen.findByRole("region", {
      name: "New intake submissions",
    });
    for (const name of [
      "Awaiting approver sign-off",
      "Payment confirmed, access not granted",
      "No candidates presented",
      "Awaiting client feedback",
      "Interview without outcome",
      "Incomplete webhook candidates",
    ]) {
      expect(screen.getByRole("region", { name })).toBeInTheDocument();
    }

    // Populated buckets: heading, count badge, item row with a deep link.
    expect(within(intakeSection).getByText("1")).toBeInTheDocument();
    expect(
      within(intakeSection).getByRole("link", { name: /REQ-000201/ }),
    ).toHaveAttribute("href", `/admin/requisitions/${intake.entityId}`);

    // Empty buckets collapse: no count badge, an all-clear sentence instead.
    const principal = screen.getByRole("region", {
      name: "Awaiting approver sign-off",
    });
    expect(
      within(principal).getByText("No approvals have been waiting too long."),
    ).toBeInTheDocument();
    expect(within(principal).queryByRole("link")).not.toBeInTheDocument();

    // Display order is most-urgent-first (payment outranks principal).
    const sections = screen.getAllByRole("region");
    const names = sections.map(
      (section) => section.getAttribute("aria-label") ?? "",
    );
    expect(names.indexOf("Payment confirmed, access not granted")).toBeLessThan(
      names.indexOf("Awaiting approver sign-off"),
    );
    expect(BUCKET_DISPLAY_ORDER).toHaveLength(7);
  });

  it("deep-links each entity type to its object", async () => {
    const requisition = makeQueueItem("requisition");
    const client = makeQueueItem("client", {
      reference: "Acme Corp",
      label: "Acme Corp",
    });
    const candidate = makeQueueItem("candidate", {
      reference: "CAN-000031",
      label: "Maria G. — CAN-000031",
    });
    const assignment = makeQueueItem("assignment", {
      reference: "REQ-000300",
      label: "Maria G. — REQ-000300",
    });
    const interview = makeQueueItem("interview", {
      reference: "REQ-000301",
      label: "Maria G. — round 2 — REQ-000301",
    });
    installDashboardApiMock(
      makeDashboardState({
        queue: makeQueue({
          new_intake_submissions: [requisition],
          payment_confirmed_access_not_granted: [client],
          awaiting_client_feedback: [assignment],
          interview_without_outcome: [interview],
          incomplete_webhook_candidates: [candidate],
        }),
      }),
    );
    renderDashboardPage("/admin");

    expect(
      await screen.findByRole("link", { name: /REQ-000101/ }),
    ).toHaveAttribute("href", `/admin/requisitions/${requisition.entityId}`);
    expect(screen.getByRole("link", { name: /Acme Corp/ })).toHaveAttribute(
      "href",
      `/admin/clients/${client.entityId}`,
    );
    expect(screen.getByRole("link", { name: /CAN-000031/ })).toHaveAttribute(
      "href",
      `/admin/candidates/${candidate.entityId}`,
    );
    // Assignment/interview items carry the requisition's REFERENCE (not its
    // id), so they land on the requisitions list pre-filtered to it.
    expect(
      screen.getByRole("link", { name: /REQ-000300/ }),
    ).toHaveAttribute("href", "/admin/requisitions?search=REQ-000300");
    expect(
      screen.getByRole("link", { name: /round 2/ }),
    ).toHaveAttribute("href", "/admin/requisitions?search=REQ-000301");
  });

  it("links requisition items with the short public id when the API provides one", async () => {
    const withPublicId = makeQueueItem("requisition", {
      reference: "REQ-000401",
      label: "REQ-000401 — Ops Manager",
      requisitionPublicId: "lSbqRVXPbTmC",
    });
    installDashboardApiMock(
      makeDashboardState({
        queue: makeQueue({ new_intake_submissions: [withPublicId] }),
      }),
    );
    renderDashboardPage("/admin");

    expect(
      await screen.findByRole("link", { name: /REQ-000401/ }),
    ).toHaveAttribute("href", "/admin/requisitions/lSbqRVXPbTmC");
  });

  it("shows relative since-times with the absolute instant on hover", async () => {
    const item = makeQueueItem("requisition", {
      since: "2026-08-09T09:00:00+00:00",
    });
    installDashboardApiMock(
      makeDashboardState({
        queue: makeQueue({ new_intake_submissions: [item] }),
      }),
    );
    renderDashboardPage("/admin");

    const link = await screen.findByRole("link", { name: /REQ-000101/ });
    const time = link.querySelector("time");
    expect(time).not.toBeNull();
    expect(time?.textContent).toMatch(/ago/);
    // Absolute instant on hover, rendered by the shared formatter (the
    // machine's local zone decides the wall time, so compare via it).
    expect(time).toHaveAttribute("title", formatDateTime(item.since));
    expect(time).toHaveAttribute("datetime", item.since);
  });

  it("the Refresh button re-requests the queue with ?refresh=true", async () => {
    const mock: DashboardApiMock = installDashboardApiMock(
      makeDashboardState({
        queue: makeQueue({
          new_intake_submissions: [makeQueueItem("requisition")],
        }),
      }),
    );
    renderDashboardPage("/admin");
    await screen.findByRole("region", { name: "New intake submissions" });

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => {
      const refreshed = mock.requests.find(
        (request) =>
          request.pathname === "/api/v1/admin/attention-queue" &&
          request.search.get("refresh") === "true",
      );
      expect(refreshed).toBeDefined();
    });
    // The initial load did NOT pass refresh.
    expect(mock.requests[0]?.search.get("refresh")).toBeNull();
  });

  it("celebrates when all seven buckets are empty", async () => {
    installDashboardApiMock(makeDashboardState({ queue: makeQueue() }));
    renderDashboardPage("/admin");

    expect(
      await screen.findByText("Nothing needs attention"),
    ).toBeInTheDocument();
    // The seven collapsed rows give way to the single celebration state.
    expect(
      screen.queryByRole("region", { name: "New intake submissions" }),
    ).not.toBeInTheDocument();
  });
});
