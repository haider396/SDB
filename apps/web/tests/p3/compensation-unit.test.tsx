/**
 * Money safety on the Compensation card (UX 1.9, 02 §7): an expected or
 * current rate AMOUNT cannot be saved without its UNIT — the inline error
 * lands on the unit field and no PATCH leaves the page. A unit without an
 * amount stays fine.
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

const UNIT_ERROR = "Pick a unit — an amount without a unit is ambiguous.";

function setup() {
  const candidate = makeCandidate({ firstName: "Maria", lastName: "Santos" });
  const state = makeState({
    candidates: [candidate],
    detailsById: { [candidate.id]: makeDetail(candidate) },
  });
  const mock = installApiMock(state);
  renderCandidates(`/admin/candidates/${candidate.id}`);
  return { candidate, mock };
}

function patchRequests(mock: ReturnType<typeof installApiMock>, id: string) {
  return mock.requests.filter(
    (request) =>
      request.method === "PATCH" &&
      request.pathname === `/api/v1/candidates/${id}`,
  );
}

describe("compensation amount ⇒ unit", () => {
  it("refuses an expected rate amount without a unit, then saves with one", async () => {
    const user = userEvent.setup();
    const { candidate, mock } = setup();

    const amount = await screen.findByLabelText("Expected rate");
    await user.type(amount, "1500");
    const form = amount.closest("form") as HTMLElement;
    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(await within(form).findByText(UNIT_ERROR)).toBeInTheDocument();
    expect(patchRequests(mock, candidate.id)).toHaveLength(0);

    await user.selectOptions(
      within(form).getByLabelText("Rate unit"),
      "hourly",
    );
    await user.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const patch = patchRequests(mock, candidate.id)[0];
      expect(patch).toBeDefined();
      const body = patch?.body as Record<string, unknown>;
      expect(body.expectedRateAmount).toBe(1500);
      expect(body.expectedRateUnit).toBe("hourly");
    });
  });

  it("enforces the same pairing for the current rate", async () => {
    const user = userEvent.setup();
    const { candidate, mock } = setup();

    const amount = await screen.findByLabelText("Current rate");
    await user.type(amount, "900");
    const form = amount.closest("form") as HTMLElement;
    await user.click(within(form).getByRole("button", { name: "Save" }));

    expect(await within(form).findByText(UNIT_ERROR)).toBeInTheDocument();
    expect(patchRequests(mock, candidate.id)).toHaveLength(0);

    await user.selectOptions(
      within(form).getByLabelText("Current rate unit"),
      "monthly",
    );
    await user.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      const body = patchRequests(mock, candidate.id)[0]?.body as
        | Record<string, unknown>
        | undefined;
      expect(body?.currentRateAmount).toBe(900);
      expect(body?.currentRateUnit).toBe("monthly");
    });
  });

  it("a unit without an amount saves without complaint", async () => {
    const user = userEvent.setup();
    const { candidate, mock } = setup();

    const unit = await screen.findByLabelText("Rate unit");
    await user.selectOptions(unit, "hourly");
    const form = unit.closest("form") as HTMLElement;
    await user.click(within(form).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(patchRequests(mock, candidate.id)).toHaveLength(1);
    });
    expect(within(form).queryByText(UNIT_ERROR)).not.toBeInTheDocument();
  });
});
