/**
 * Status-aware default tab on the requisition workspace (UX 2.3): with no
 * ?tab param, requisitions in an active sourcing/interviewing phase land on
 * the Pipeline tab; everything else lands on Overview. An explicit ?tab in
 * the URL always wins.
 */
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RequisitionStatus } from "@sdb/contracts";
import {
  installApiMock,
  jsonResponse,
  makeClient,
  makeDetail,
  makeRequisition,
  makeState,
  renderAdmin,
  type Override,
} from "./helpers";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** The pipeline tab loads the board — serve it an empty assignment list. */
const emptyAssignments: Override = (request) =>
  request.method === "GET" && request.pathname.endsWith("/assignments")
    ? jsonResponse({ data: [], meta: { count: 0, nextCursor: null } })
    : undefined;

function setup(status: RequisitionStatus) {
  const client = makeClient({ companyName: "Acme Corp" });
  const requisition = makeRequisition({
    clientId: client.id,
    clientName: client.companyName,
    status,
  });
  const state = makeState({
    clients: [client],
    requisitions: [requisition],
    detailsById: { [requisition.id]: makeDetail(requisition) },
  });
  installApiMock(state, emptyAssignments);
  return requisition;
}

async function activeTabName(): Promise<string | undefined> {
  const tabs = await screen.findAllByRole("tab");
  return tabs
    .find((tab) => tab.getAttribute("aria-selected") === "true")
    ?.textContent?.trim();
}

describe("status-aware default tab", () => {
  it("defaults to Pipeline while sourcing", async () => {
    const requisition = setup("sourcing");
    renderAdmin(`/admin/requisitions/${requisition.id}`);
    expect(await activeTabName()).toBe("Pipeline");
  });

  it("defaults to Overview before sourcing starts", async () => {
    const requisition = setup("submitted");
    renderAdmin(`/admin/requisitions/${requisition.id}`);
    expect(await activeTabName()).toBe("Overview");
  });

  it("the URL param always wins over the status default", async () => {
    const requisition = setup("sourcing");
    renderAdmin(`/admin/requisitions/${requisition.id}?tab=overview`);
    expect(await activeTabName()).toBe("Overview");
  });
});
