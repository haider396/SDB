/**
 * The sticky unsaved-changes bar (UX 2.5): appears once ≥1 section is
 * dirty, names each dirty section as a jump link, and "Save all" flushes
 * every dirty card's own form sequentially through the registry.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installApiMock,
  makeCandidate,
  makeDetail,
  makeState,
  renderCandidates,
} from "./helpers";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("save-all bar", () => {
  it("lists dirty sections and saves each one's own PATCH in order", async () => {
    const user = userEvent.setup();
    const candidate = makeCandidate({ firstName: "Maria", lastName: "Santos" });
    const state = makeState({
      candidates: [candidate],
      detailsById: { [candidate.id]: makeDetail(candidate) },
    });
    const mock = installApiMock(state);
    renderCandidates(`/admin/candidates/${candidate.id}`);

    // No bar while everything is clean.
    expect(
      screen.queryByRole("region", { name: "Unsaved changes" }),
    ).not.toBeInTheDocument();

    // Dirty two sections: Identity (city) and Compensation (rate + unit).
    await user.type(await screen.findByLabelText("City"), "Manila");
    await user.type(screen.getByLabelText("Expected rate"), "1500");
    await user.selectOptions(screen.getByLabelText("Rate unit"), "hourly");

    const bar = await screen.findByRole("region", { name: "Unsaved changes" });
    expect(
      within(bar).getByText("2 sections have unsaved changes"),
    ).toBeInTheDocument();
    expect(
      within(bar).getByRole("link", { name: "Identity & location" }),
    ).toBeInTheDocument();
    expect(
      within(bar).getByRole("link", { name: "Compensation & availability" }),
    ).toBeInTheDocument();

    await user.click(within(bar).getByRole("button", { name: "Save all" }));

    // Both cards submitted their OWN scoped PATCH.
    await waitFor(() => {
      const patches = mock.requests.filter(
        (request) =>
          request.method === "PATCH" &&
          request.pathname === `/api/v1/candidates/${candidate.id}`,
      );
      expect(patches).toHaveLength(2);
      const bodies = patches.map(
        (request) => request.body as Record<string, unknown>,
      );
      expect(bodies[0]).toHaveProperty("city", "Manila");
      expect(bodies[0]).not.toHaveProperty("expectedRateAmount");
      expect(bodies[1]).toHaveProperty("expectedRateAmount", 1500);
      expect(bodies[1]).not.toHaveProperty("city");
    });

    // Everything saved — the bar goes away.
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: "Unsaved changes" }),
      ).not.toBeInTheDocument();
    });
  });
});
