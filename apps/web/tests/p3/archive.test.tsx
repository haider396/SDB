/**
 * Archiving is a typed-name destructive confirm (05 §4.4): the button stays
 * disabled until the exact full name is typed, then POSTs /archive.
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
} from "./helpers";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("archive candidate", () => {
  it("requires the exact name before POSTing /archive", async () => {
    const user = userEvent.setup();
    const candidate = makeCandidate({ firstName: "Maria", lastName: "Santos" });
    const state = makeState({
      candidates: [candidate],
      detailsById: { [candidate.id]: makeDetail(candidate) },
    });
    const mock = installApiMock(state);
    renderCandidates(`/admin/candidates/${candidate.id}`);

    await user.click(
      await screen.findByRole("button", { name: "Archive candidate" }),
    );

    // Dialog open: the confirm submit is disarmed until the name matches.
    const submit = screen
      .getAllByRole("button", { name: "Archive candidate" })
      .at(-1);
    expect(submit).toBeDisabled();

    await user.type(
      screen.getByLabelText(/Type/, { exact: false }),
      "Maria Wrong",
    );
    expect(submit).toBeDisabled();
    expect(
      mock.requests.some((request) => request.pathname.endsWith("/archive")),
    ).toBe(false);

    await user.clear(screen.getByLabelText(/Type/, { exact: false }));
    await user.type(
      screen.getByLabelText(/Type/, { exact: false }),
      "Maria Santos",
    );
    expect(submit).toBeEnabled();
    await user.click(submit as HTMLElement);

    await waitFor(() => {
      const archive = mock.requests.find(
        (request) =>
          request.method === "POST" &&
          request.pathname === `/api/v1/candidates/${candidate.id}/archive`,
      );
      expect(archive).toBeDefined();
    });
  });
});
