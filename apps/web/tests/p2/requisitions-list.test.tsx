/**
 * /admin/requisitions list: row activation must use the requisition's short
 * public id in the URL — never the UUID (0015 short-public-id rollout).
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installApiMock,
  makeClient,
  makeDetail,
  makeRequisition,
  makeState,
  renderAdmin,
  withCommercials,
} from "./helpers";

vi.mock("@/lib/auth", () => ({
  useSession: () => ({ session: {}, isLoading: false }),
  getAccessToken: async () => "test-token",
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("requisitions list", () => {
  it("row activation navigates to the requisition's short public-id URL, never the UUID", async () => {
    const user = userEvent.setup();
    const client = makeClient({ companyName: "Acme Corp" });
    const requisition = withCommercials(
      makeRequisition({ clientId: client.id, clientName: client.companyName }),
    );
    const state = makeState({
      clients: [client],
      requisitions: [requisition],
      detailsById: { [requisition.id]: makeDetail(requisition) },
    });
    const mock = installApiMock(state);
    renderAdmin("/admin/requisitions");

    await user.click(await screen.findByText("Executive Assistant"));

    // The detail page keys and fetches by the route param — the public id.
    await waitFor(() => {
      expect(
        mock.requests.some(
          (request) =>
            request.method === "GET" &&
            request.pathname === `/api/v1/requisitions/${requisition.publicId}`,
        ),
      ).toBe(true);
    });
    expect(
      mock.requests.some(
        (request) =>
          request.method === "GET" &&
          request.pathname === `/api/v1/requisitions/${requisition.id}`,
      ),
    ).toBe(false);
  });
});
