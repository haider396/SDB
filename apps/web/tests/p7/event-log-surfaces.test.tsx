/**
 * P7 — event-log surfacing beyond the requisition detail (06 §7):
 *  - candidate detail right rail  → GET /events?entityType=candidate&entityId=…
 *  - client detail right rail     → GET /events?entityType=client&entityId=…
 *  - pipeline card "View history" → GET /assignments/:id/events in a sheet
 * One test per surface: the query the card issues, and the timeline render.
 */
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EntityEvent } from "@sdb/contracts";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));
import {
  installApiMock as installCandidatesApiMock,
  jsonResponse,
  makeCandidate,
  makeDetail as makeCandidateDetail,
  makeState as makeCandidatesState,
  renderCandidates,
  testUuid,
  NOW,
} from "../p3/helpers";
import {
  installApiMock as installClientsApiMock,
  makeClient,
  makeState as makeClientsState,
  renderAdmin,
} from "../p2/helpers";
import {
  installPipelineApiMock,
  makeAssignment,
  makePipelineState,
  makeRequisition as makePipelineRequisition,
  renderPipeline,
} from "../p4/helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function makeEvent(
  overrides: Partial<EntityEvent> &
    Pick<EntityEvent, "entityType" | "entityId" | "eventType">,
): EntityEvent {
  return {
    id: testUuid(),
    actorId: testUuid(),
    actorRole: "admin",
    fromValue: null,
    toValue: null,
    metadata: {},
    occurredAt: NOW,
    ...overrides,
  };
}

const eventsCollection = (data: EntityEvent[]) =>
  jsonResponse({ data, meta: { count: data.length, nextCursor: null } });

describe("event log surfacing", () => {
  it("candidate detail rail queries /events for the candidate and renders the timeline", async () => {
    const candidate = makeCandidate({ firstName: "Maria", lastName: "Garcia" });
    const event = makeEvent({
      entityType: "candidate",
      entityId: candidate.id,
      eventType: "vetting_status_changed",
      fromValue: "not_started",
      toValue: "passed",
    });
    const mock = installCandidatesApiMock(
      makeCandidatesState({
        candidates: [candidate],
        detailsById: { [candidate.id]: makeCandidateDetail(candidate) },
      }),
      (request) =>
        request.method === "GET" && request.pathname === "/api/v1/events"
          ? eventsCollection([event])
          : undefined,
    );
    renderCandidates(`/admin/candidates/${candidate.id}`);

    const title = await screen.findByText("Vetting status changed");
    const entry = title.closest("li");
    expect(entry).not.toBeNull();
    expect(entry?.textContent).toContain("Not started");
    expect(entry?.textContent).toContain("Passed");

    const call = mock.requests.find(
      (request) => request.pathname === "/api/v1/events",
    );
    expect(call).toBeDefined();
    expect(call?.search.get("entityType")).toBe("candidate");
    expect(call?.search.get("entityId")).toBe(candidate.id);
  });

  it("client detail rail queries /events for the client and renders the timeline", async () => {
    const client = makeClient({ companyName: "Acme Corp" });
    const event = makeEvent({
      entityType: "client",
      entityId: client.id,
      eventType: "payment_confirmed",
    });
    const mock = installClientsApiMock(
      makeClientsState({ clients: [client] }),
      (request) =>
        request.method === "GET" && request.pathname === "/api/v1/events"
          ? eventsCollection([event])
          : undefined,
    );
    renderAdmin(`/admin/clients/${client.id}`);

    expect(await screen.findByText("Payment confirmed")).toBeInTheDocument();

    const call = mock.requests.find(
      (request) => request.pathname === "/api/v1/events",
    );
    expect(call).toBeDefined();
    expect(call?.search.get("entityType")).toBe("client");
    expect(call?.search.get("entityId")).toBe(client.id);
  });

  it("pipeline card 'View history' opens a sheet backed by GET /assignments/:id/events", async () => {
    const requisition = makePipelineRequisition();
    const candidate = makeCandidate({ firstName: "Maria", lastName: "Garcia" });
    const assignment = makeAssignment({
      requisition,
      candidate,
      stage: "vetted",
    });
    const event = makeEvent({
      entityType: "assignment",
      entityId: assignment.id,
      eventType: "stage_changed",
      fromValue: "screened",
      toValue: "vetted",
    });
    const mock = installPipelineApiMock(
      makePipelineState({
        requisition,
        assignments: [assignment],
        detailsById: { [candidate.id]: makeCandidateDetail(candidate) },
      }),
      (request) =>
        request.method === "GET" &&
        request.pathname === `/api/v1/assignments/${assignment.id}/events`
          ? eventsCollection([event])
          : undefined,
    );
    renderPipeline(requisition.id);
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "Actions for Maria G." }),
    );
    const menu = screen.getByRole("menu", { name: "Actions for Maria G." });
    await user.click(within(menu).getByRole("menuitem", { name: "View history" }));

    const sheet = await screen.findByRole("dialog", {
      name: "Assignment history",
    });
    expect(
      await within(sheet).findByText("Stage changed"),
    ).toBeInTheDocument();
    expect(within(sheet).getByText(/Screened/)).toBeInTheDocument();
    expect(within(sheet).getByText(/Vetted/)).toBeInTheDocument();

    await waitFor(() => {
      const call = mock.requests.find(
        (request) =>
          request.pathname === `/api/v1/assignments/${assignment.id}/events`,
      );
      expect(call).toBeDefined();
    });
  });
});
