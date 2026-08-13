/**
 * /admin/clients list: filters drive the query parameters sent to
 * GET /clients (status, debounced search, hasPendingAccess), and the footer's
 * Prev/Next controls walk the cursor pages (page-size changes reset to
 * page 1 and travel as ?limit=).
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

  it("walks pages with Next/Prev using the returned cursor", async () => {
    const user = userEvent.setup();
    // A realistic cursor feed: a full first page (25 rows) + a 1-row tail.
    const pageOneRows = [
      makeClient({ companyName: "Page One Co" }),
      ...Array.from({ length: 24 }, (_, index) =>
        makeClient({ companyName: `Filler ${index + 1} Co` }),
      ),
    ];
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
      // First (un-cursored) page carries the filtered total (04 §1).
      return jsonResponse({
        data: pageOneRows,
        meta: { count: 25, nextCursor: "cursor-1", total: 26 },
      });
    });
    renderAdmin("/admin/clients");

    expect(await screen.findByText("Page One Co")).toBeInTheDocument();
    expect(screen.getByText("1–25 of 26")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Previous page" }),
    ).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Next page" }));

    // Page 2 REPLACES page 1 — real pagination, not an appending list.
    expect(await screen.findByText("Page Two Co")).toBeInTheDocument();
    expect(screen.queryByText("Page One Co")).not.toBeInTheDocument();
    const latest = listRequests(mock.requests).at(-1);
    expect(latest?.search.get("cursor")).toBe("cursor-1");
    // The first page's total survives while paginating.
    expect(screen.getByText("26–26 of 26")).toBeInTheDocument();
    expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
    // nextCursor null → last page.
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
    });

    // Prev pops the cursor stack and returns to the un-cursored page.
    await user.click(screen.getByRole("button", { name: "Previous page" }));
    expect(await screen.findByText("Page One Co")).toBeInTheDocument();
    expect(screen.queryByText("Page Two Co")).not.toBeInTheDocument();
  });

  it("sends the page size as ?limit= and resets to page 1 when it changes", async () => {
    const user = userEvent.setup();
    const pageOne = makeClient({ companyName: "Page One Co" });
    const pageTwo = makeClient({ companyName: "Page Two Co" });
    const mock = installApiMock(makeState(), (request) => {
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
        meta: { count: 1, nextCursor: "cursor-1", total: 2 },
      });
    });
    renderAdmin("/admin/clients");

    expect(await screen.findByText("Page One Co")).toBeInTheDocument();
    expect(listRequests(mock.requests).at(-1)?.search.get("limit")).toBe("25");

    // Walk to page 2, then change the page size …
    await user.click(screen.getByRole("button", { name: "Next page" }));
    await screen.findByText("Page Two Co");
    await user.selectOptions(screen.getByLabelText("Rows per page"), "50");

    // … the cursor stack resets: back to the un-cursored page with limit=50.
    expect(await screen.findByText("Page One Co")).toBeInTheDocument();
    await waitFor(() => {
      const latest = listRequests(mock.requests).at(-1);
      expect(latest?.search.get("limit")).toBe("50");
      expect(latest?.search.get("cursor")).toBeNull();
    });
  });

  it("row activation navigates to the client's short public-id URL, never the UUID", async () => {
    const user = userEvent.setup();
    const client = makeClient({ companyName: "Acme Corp" });
    const state = makeState({ clients: [client] });
    const mock = installApiMock(state);
    renderAdmin("/admin/clients");

    await user.click(await screen.findByText("Acme Corp"));

    // The detail page keys and fetches by the route param — the public id.
    await waitFor(() => {
      expect(
        mock.requests.some(
          (request) =>
            request.method === "GET" &&
            request.pathname === `/api/v1/clients/${client.publicId}`,
        ),
      ).toBe(true);
    });
    expect(
      mock.requests.some(
        (request) =>
          request.method === "GET" &&
          request.pathname === `/api/v1/clients/${client.id}`,
      ),
    ).toBe(false);
  });
});
