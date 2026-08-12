/**
 * Disqualifier checklist: rows render per ACTIVE disqualifier and saving
 * PUTs the documented body shape { checks: [{ disqualifierId, result,
 * notes }] } — only for answered rows.
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installApiMock,
  makeCandidate,
  makeDetail,
  makeDisqualifier,
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

describe("disqualifier checklist", () => {
  it("PUTs the answered checks in the documented shape", async () => {
    const user = userEvent.setup();
    const candidate = makeCandidate({ firstName: "Maria", lastName: "Santos" });
    const noisy = makeDisqualifier({
      key: "noisy_environment",
      label: "Noisy work environment",
      sortOrder: 1,
    });
    const inactive = makeDisqualifier({
      key: "inactive_check",
      label: "Inactive check",
      isActive: false,
      sortOrder: 2,
    });
    const state = makeState({
      candidates: [candidate],
      detailsById: { [candidate.id]: makeDetail(candidate) },
      disqualifiers: [noisy, inactive],
    });
    const mock = installApiMock(state);
    renderCandidates(`/admin/candidates/${candidate.id}`);

    // Active disqualifiers render; inactive ones never appear.
    expect(await screen.findByText("Noisy work environment")).toBeInTheDocument();
    expect(screen.queryByText("Inactive check")).not.toBeInTheDocument();

    const group = screen.getByRole("radiogroup", {
      name: "Result for Noisy work environment",
    });
    await user.click(within(group).getByLabelText("Pass"));
    await user.type(
      screen.getByLabelText("Notes for Noisy work environment"),
      "Verified on video call",
    );
    await user.click(screen.getByRole("button", { name: "Save checks" }));

    await waitFor(() => {
      const put = mock.requests.find(
        (request) =>
          request.method === "PUT" &&
          request.pathname ===
            `/api/v1/candidates/${candidate.id}/disqualifier-checks`,
      );
      expect(put).toBeDefined();
      expect(put?.body).toEqual({
        checks: [
          {
            disqualifierId: noisy.id,
            result: "pass",
            notes: "Verified on video call",
          },
        ],
      });
    });
  });
});
