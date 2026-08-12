/**
 * Consent capture goes through POST /candidates/:id/consent with a consent
 * source — never PATCH — and the optimistic toggle rolls back on failure.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  errorResponse,
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

function seededState() {
  const candidate = makeCandidate({ firstName: "Maria", lastName: "Santos" });
  const state = makeState({
    candidates: [candidate],
    detailsById: { [candidate.id]: makeDetail(candidate) },
  });
  return { candidate, state };
}

describe("consent capture", () => {
  it("posts to the consent endpoint with the source, never PATCH", async () => {
    const user = userEvent.setup();
    const { candidate, state } = seededState();
    const mock = installApiMock(state);
    renderCandidates(`/admin/candidates/${candidate.id}`);

    const toggle = await screen.findByLabelText(
      "Has consent to share profile with clients",
    );
    expect(toggle).not.toBeChecked();

    await user.type(
      screen.getByLabelText("Consent source"),
      "screening call 12 Aug",
    );
    await user.click(toggle);

    await waitFor(() => {
      const consentPost = mock.requests.find(
        (request) =>
          request.method === "POST" &&
          request.pathname === `/api/v1/candidates/${candidate.id}/consent`,
      );
      expect(consentPost).toBeDefined();
      expect(consentPost?.body).toEqual({
        hasConsentToShareProfile: true,
        consentSource: "screening call 12 Aug",
      });
    });

    // Consent never travels through PATCH (contracts rule).
    const patches = mock.requests.filter(
      (request) => request.method === "PATCH",
    );
    expect(
      patches.some(
        (request) =>
          typeof request.body === "object" &&
          request.body !== null &&
          "hasConsentToShareProfile" in request.body,
      ),
    ).toBe(false);

    await waitFor(() => {
      expect(
        screen.getByLabelText("Has consent to share profile with clients"),
      ).toBeChecked();
    });
  });

  it("requires a consent source before toggling", async () => {
    const user = userEvent.setup();
    const { candidate, state } = seededState();
    const mock = installApiMock(state);
    renderCandidates(`/admin/candidates/${candidate.id}`);

    const toggle = await screen.findByLabelText(
      "Has consent to share profile with clients",
    );
    await user.click(toggle);

    expect(
      await screen.findByText(
        "Enter where this consent was captured (e.g. intake call, email) first.",
      ),
    ).toBeInTheDocument();
    expect(
      mock.requests.some((request) =>
        request.pathname.endsWith("/consent"),
      ),
    ).toBe(false);
  });

  it("rolls the optimistic toggle back when the endpoint fails", async () => {
    const user = userEvent.setup();
    const { candidate, state } = seededState();
    installApiMock(state, (request) => {
      if (
        request.method === "POST" &&
        request.pathname === `/api/v1/candidates/${candidate.id}/consent`
      ) {
        return errorResponse("VALIDATION_ERROR", "Consent rejected.", 422);
      }
      return undefined;
    });
    renderCandidates(`/admin/candidates/${candidate.id}`);

    const toggle = await screen.findByLabelText(
      "Has consent to share profile with clients",
    );
    await user.type(screen.getByLabelText("Consent source"), "email thread");
    await user.click(toggle);

    await waitFor(() => {
      expect(
        screen.getByLabelText("Has consent to share profile with clients"),
      ).not.toBeChecked();
    });
  });
});
