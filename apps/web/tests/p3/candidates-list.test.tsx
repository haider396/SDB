/**
 * /admin/candidates list: filters drive the query parameters sent to
 * GET /candidates (04 §8), the rate ceiling never fires without its unit,
 * and the data-completeness badge renders per row.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installApiMock,
  makeCandidate,
  makeDetail,
  makeState,
  renderCandidates,
  type RecordedRequest,
} from "./helpers";

vi.mock("@/lib/auth", () => ({
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
      request.method === "GET" && request.pathname === "/api/v1/candidates",
  );
}

describe("candidates list", () => {
  it("renders rows and sends pool status + vetting filters as query params", async () => {
    const user = userEvent.setup();
    const state = makeState({
      candidates: [
        makeCandidate({ firstName: "Maria", lastName: "Santos" }),
        makeCandidate({
          firstName: "Jose",
          lastName: "Reyes",
          poolStatus: "passive",
        }),
      ],
    });
    const mock = installApiMock(state);
    renderCandidates("/admin/candidates");

    expect(await screen.findByText("Maria S.")).toBeInTheDocument();
    const first = listRequests(mock.requests)[0];
    expect(first?.search.get("poolStatus")).toBeNull();

    await user.selectOptions(screen.getByLabelText("Pool status"), "passive");
    await waitFor(() => {
      const latest = listRequests(mock.requests).at(-1);
      expect(latest?.search.get("poolStatus")).toBe("passive");
    });

    await user.selectOptions(screen.getByLabelText("Vetting"), "passed");
    await waitFor(() => {
      const latest = listRequests(mock.requests).at(-1);
      expect(latest?.search.get("vettingStatus")).toBe("passed");
      expect(latest?.search.get("poolStatus")).toBe("passive");
    });
  });

  it("debounces search into the search query param", async () => {
    const user = userEvent.setup();
    const state = makeState({
      candidates: [makeCandidate({ firstName: "Maria", lastName: "Santos" })],
    });
    const mock = installApiMock(state);
    renderCandidates("/admin/candidates");
    await screen.findByText("Maria S.");

    await user.type(screen.getByLabelText("Search"), "maria");
    expect(
      listRequests(mock.requests).some(
        (request) => request.search.get("search") === "maria",
      ),
    ).toBe(false);

    await waitFor(() => {
      const latest = listRequests(mock.requests).at(-1);
      expect(latest?.search.get("search")).toBe("maria");
    });
  });

  it("holds back the rate ceiling until its mandatory unit is chosen", async () => {
    const user = userEvent.setup();
    const state = makeState({
      candidates: [makeCandidate({ firstName: "Maria", lastName: "Santos" })],
    });
    const mock = installApiMock(state);
    renderCandidates("/admin/candidates");
    await screen.findByText("Maria S.");

    await user.type(screen.getByLabelText("Rate ceiling"), "2500");
    expect(
      await screen.findByText("Pick a unit to apply the rate ceiling."),
    ).toBeInTheDocument();
    // No request may carry rateMax without rateUnit (04 §8 constraint).
    expect(
      listRequests(mock.requests).some(
        (request) =>
          request.search.get("rateMax") !== null &&
          request.search.get("rateUnit") === null,
      ),
    ).toBe(false);

    await user.selectOptions(screen.getByLabelText("Rate unit"), "monthly");
    await waitFor(() => {
      const latest = listRequests(mock.requests).at(-1);
      expect(latest?.search.get("rateMax")).toBe("2500");
      expect(latest?.search.get("rateUnit")).toBe("monthly");
    });
  });

  it("sends dataCompleteness=incomplete when the toggle is on", async () => {
    const user = userEvent.setup();
    const state = makeState({
      candidates: [makeCandidate({ firstName: "Maria", lastName: "Santos" })],
    });
    const mock = installApiMock(state);
    renderCandidates("/admin/candidates");
    await screen.findByText("Maria S.");

    await user.click(screen.getByLabelText("Incomplete data only"));
    await waitFor(() => {
      const latest = listRequests(mock.requests).at(-1);
      expect(latest?.search.get("dataCompleteness")).toBe("incomplete");
    });
  });

  it("renders a warning badge only for incomplete records", async () => {
    const state = makeState({
      candidates: [
        makeCandidate({ firstName: "Maria", lastName: "Santos" }),
        makeCandidate({
          firstName: "Jose",
          lastName: "Reyes",
          dataCompleteness: "incomplete",
        }),
      ],
    });
    installApiMock(state);
    renderCandidates("/admin/candidates");

    expect(await screen.findByText("Maria S.")).toBeInTheDocument();
    const incomplete = screen.getByText("Incomplete");
    expect(incomplete).toBeInTheDocument();
    expect(incomplete.className).toContain("bg-warning-subtle");
    const complete = screen.getByText("Complete");
    expect(complete.className).not.toContain("bg-warning-subtle");
  });

  it("row activation navigates to the candidate's short public-id URL, never the UUID", async () => {
    const user = userEvent.setup();
    const candidate = makeCandidate({ firstName: "Maria", lastName: "Santos" });
    const state = makeState({
      candidates: [candidate],
      detailsById: { [candidate.id]: makeDetail(candidate) },
    });
    const mock = installApiMock(state);
    renderCandidates("/admin/candidates");

    await user.click(await screen.findByText("Maria S."));

    // The detail page keys and fetches by the route param — the public id.
    await waitFor(() => {
      expect(
        mock.requests.some(
          (request) =>
            request.method === "GET" &&
            request.pathname === `/api/v1/candidates/${candidate.publicId}`,
        ),
      ).toBe(true);
    });
    expect(
      mock.requests.some(
        (request) =>
          request.method === "GET" &&
          request.pathname === `/api/v1/candidates/${candidate.id}`,
      ),
    ).toBe(false);
  });
});
