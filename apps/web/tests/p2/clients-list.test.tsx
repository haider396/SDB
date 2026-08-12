/**
 * /admin/clients list: filters drive the query parameters sent to
 * GET /clients (status, debounced search, hasPendingAccess), and cursor
 * pagination requests the next page with the returned cursor.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installApiMock,
  jsonResponse,
  makeClient,
  makeState,
  renderAdmin,
  type RecordedRequest,
} from "./helpers";

// The list page's New-client gate (useCan → useMe) needs a live session.
vi.mock("@/lib/auth", () => ({
  useSession: () => ({ session: {}, isLoading: false }),
  getAccessToken: async () => "test-token",
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function listRequests(requests: RecordedRequest[]): RecordedRequest[] {
  return requests.filter(
    (request) =>
      request.method === "GET" && request.pathname === "/api/v1/clients",
  );
}

describe("clients list", () => {
  it("renders rows and sends the status filter as a query param", async () => {
    const user = userEvent.setup();
    const state = makeState({
      clients: [
        makeClient({ companyName: "Acme Corp" }),
        makeClient({ companyName: "Globex", status: "active" }),
      ],
    });
    const mock = installApiMock(state);
    renderAdmin("/admin/clients");

    expect(await screen.findByText("Acme Corp")).toBeInTheDocument();
    const first = listRequests(mock.requests)[0];
    expect(first?.search.get("status")).toBeNull();

    await user.selectOptions(screen.getByLabelText("Status"), "active");
    await waitFor(() => {
      const latest = listRequests(mock.requests).at(-1);
      expect(latest?.search.get("status")).toBe("active");
    });
  });

  it("debounces search input into the search query param", async () => {
    const user = userEvent.setup();
    const state = makeState({
      clients: [makeClient({ companyName: "Acme Corp" })],
    });
    const mock = installApiMock(state);
    renderAdmin("/admin/clients");
    await screen.findByText("Acme Corp");

    await user.type(screen.getByLabelText("Search"), "acme");
    // Debounce: no immediate request carrying the search term.
    expect(
      listRequests(mock.requests).some(
        (request) => request.search.get("search") === "acme",
      ),
    ).toBe(false);

    await waitFor(() => {
      const latest = listRequests(mock.requests).at(-1);
      expect(latest?.search.get("search")).toBe("acme");
    });
    // Intermediate keystrokes ("a", "ac", "acm") never hit the API.
    expect(
      listRequests(mock.requests).some((request) =>
        ["a", "ac", "acm"].includes(request.search.get("search") ?? ""),
      ),
    ).toBe(false);
  });

  it("sends hasPendingAccess=true when the toggle is on", async () => {
    const user = userEvent.setup();
    const state = makeState({
      clients: [makeClient({ companyName: "Acme Corp" })],
    });
    const mock = installApiMock(state);
    renderAdmin("/admin/clients");
    await screen.findByText("Acme Corp");

    await user.click(screen.getByLabelText("Pending access only"));
    await waitFor(() => {
      const latest = listRequests(mock.requests).at(-1);
      expect(latest?.search.get("hasPendingAccess")).toBe("true");
    });
  });

  it("loads the next page with the returned cursor", async () => {
    const user = userEvent.setup();
    const pageOne = makeClient({ companyName: "Page One Co" });
    const pageTwo = makeClient({ companyName: "Page Two Co" });
    const state = makeState();
    const mock = installApiMock(state, (request) => {
      if (request.method !== "GET" || request.pathname !== "/api/v1/clients") {
        return undefined;
      }
      if (request.search.get("cursor") === "cursor-1") {
        return jsonResponse({
          data: [pageTwo],
          meta: { count: 1, nextCursor: null },
        });
      }
      return jsonResponse({
        data: [pageOne],
        meta: { count: 1, nextCursor: "cursor-1" },
      });
    });
    renderAdmin("/admin/clients");

    expect(await screen.findByText("Page One Co")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Load more" }));

    expect(await screen.findByText("Page Two Co")).toBeInTheDocument();
    expect(screen.getByText("Page One Co")).toBeInTheDocument();
    const latest = listRequests(mock.requests).at(-1);
    expect(latest?.search.get("cursor")).toBe("cursor-1");
    // Both pages loaded, no further cursor → Load more disappears.
    expect(
      screen.queryByRole("button", { name: "Load more" }),
    ).not.toBeInTheDocument();
  });
});
