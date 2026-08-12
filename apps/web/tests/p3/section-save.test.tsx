/**
 * Per-card saves: each section PATCHes ONLY its own field group — editing
 * the Identity card must not send vetting, compensation, or pool fields.
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

const IDENTITY_KEYS = [
  "firstName",
  "lastName",
  "preferredName",
  "email",
  "phone",
  "whatsapp",
  "linkedinUrl",
  "portfolioUrl",
  "country",
  "regionState",
  "city",
  "timezone",
  "nationality",
  "relocationStatus",
];

describe("per-card section saves", () => {
  it("sends only the Identity card's fields on save", async () => {
    const user = userEvent.setup();
    const candidate = makeCandidate({
      firstName: "Maria",
      lastName: "Santos",
      vettingStatus: "in_progress",
      recruiterRating: 4,
    });
    const state = makeState({
      candidates: [candidate],
      detailsById: { [candidate.id]: makeDetail(candidate) },
    });
    const mock = installApiMock(state);
    renderCandidates(`/admin/candidates/${candidate.id}`);

    const city = await screen.findByLabelText("City");
    await user.type(city, "Manila");

    const identityCard = city.closest("form");
    expect(identityCard).not.toBeNull();
    await user.click(
      within(identityCard as HTMLElement).getByRole("button", { name: "Save" }),
    );

    await waitFor(() => {
      const patch = mock.requests.find(
        (request) =>
          request.method === "PATCH" &&
          request.pathname === `/api/v1/candidates/${candidate.id}`,
      );
      expect(patch).toBeDefined();
      const body = patch?.body as Record<string, unknown>;
      expect(body.city).toBe("Manila");
      expect(body.firstName).toBe("Maria");
      // Exactly the identity group — nothing from other cards.
      expect(Object.keys(body).sort()).toEqual([...IDENTITY_KEYS].sort());
      expect(body).not.toHaveProperty("vettingStatus");
      expect(body).not.toHaveProperty("expectedRateAmount");
      expect(body).not.toHaveProperty("poolStatus");
    });
  });

  it("sends only the Vetting card's fields, with numeric ratings", async () => {
    const user = userEvent.setup();
    const candidate = makeCandidate({ firstName: "Maria", lastName: "Santos" });
    const state = makeState({
      candidates: [candidate],
      detailsById: { [candidate.id]: makeDetail(candidate) },
    });
    const mock = installApiMock(state);
    renderCandidates(`/admin/candidates/${candidate.id}`);

    const vettingStatus = await screen.findByLabelText("Vetting status");
    await user.selectOptions(vettingStatus, "in_progress");

    const vettingCard = vettingStatus.closest("form");
    expect(vettingCard).not.toBeNull();
    const scoped = within(vettingCard as HTMLElement);

    // Rating 1–5 via the segmented radio control.
    const ratingGroup = scoped.getAllByRole("radiogroup")[0];
    expect(ratingGroup).toBeDefined();
    await user.click(within(ratingGroup as HTMLElement).getByLabelText("4"));

    await user.click(scoped.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = mock.requests.find(
        (request) =>
          request.method === "PATCH" &&
          request.pathname === `/api/v1/candidates/${candidate.id}`,
      );
      expect(patch).toBeDefined();
      const body = patch?.body as Record<string, unknown>;
      expect(body.vettingStatus).toBe("in_progress");
      expect(body.recruiterRating).toBe(4);
      expect(body).not.toHaveProperty("firstName");
      expect(body).not.toHaveProperty("city");
    });
  });
});
