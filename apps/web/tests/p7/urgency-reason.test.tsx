/**
 * Urgency reason is asked for only at `urgent` — and hiding it must not erase it.
 *
 * Rebecca, 21 Sep: "honestly, I think it's only needed if it's urgent. So this
 * would disappear unless it's urgent and then it's urgency reason."
 *
 * The risk this pins down is the second half of that. `urgency` holds what the
 * CLIENT told us at intake, and migration 0030 is explicit that it is not the
 * same field as `priority` — it is also frozen in their answer snapshot. So a
 * position dropped from `urgent` back to `normal` must keep what the client
 * said; the field simply stops being offered.
 *
 * That only holds because react-hook-form defaults `shouldUnregister` to false
 * and this form seeds from `values:`. Both are easy to change without noticing
 * what they were load-bearing for — flip either and an admin lowering a
 * priority silently destroys the client's own words. Hence a test rather than
 * a comment.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Requisition } from "@sdb/contracts";
import {
  installApiMock,
  makeClient,
  makeDetail,
  makeRequisition,
  makeState,
  renderAdmin,
} from "../p2/helpers";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

function setup(overrides?: Partial<Requisition>) {
  const client = makeClient({ companyName: "Acme Corp" });
  const requisition = makeRequisition({
    clientId: client.id,
    clientName: client.companyName,
    ...overrides,
  });
  const detail = makeDetail(requisition);
  const mock = installApiMock(
    makeState({
      clients: [client],
      requisitions: [requisition],
      detailsById: { [requisition.id]: detail },
    }),
  );
  renderAdmin(`/admin/requisitions/${requisition.id}`);
  return { requisition, mock };
}

describe("urgency reason (fields card)", () => {
  it("is hidden at normal priority", async () => {
    setup({ priority: "normal", urgency: "Backfill before Q4" });
    // Priority itself is always offered; the reason for it is not.
    expect(await screen.findByLabelText("Priority")).toBeInTheDocument();
    expect(screen.queryByLabelText("Urgency reason")).not.toBeInTheDocument();
  });

  it("appears once priority is urgent", async () => {
    setup({ priority: "urgent", urgency: "Backfill before Q4" });
    expect(await screen.findByLabelText("Urgency reason")).toHaveValue(
      "Backfill before Q4",
    );
  });

  it("does NOT appear at high — urgent only", async () => {
    // "above normal" was said once and then corrected to "only if it's urgent".
    setup({ priority: "high", urgency: "Backfill before Q4" });
    expect(await screen.findByLabelText("Priority")).toBeInTheDocument();
    expect(screen.queryByLabelText("Urgency reason")).not.toBeInTheDocument();
  });

  it("keeps the client's stored reason when priority drops off urgent", async () => {
    const user = userEvent.setup();
    const { mock } = setup({ priority: "urgent", urgency: "Backfill before Q4" });

    // Confirm it is on screen, then lower the priority so it unmounts.
    expect(await screen.findByLabelText("Urgency reason")).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText("Priority"), "normal");
    await waitFor(() =>
      expect(screen.queryByLabelText("Urgency reason")).not.toBeInTheDocument(),
    );

    await user.click(screen.getByRole("button", { name: "Save fields" }));

    const patch = await waitFor(() => {
      const found = mock.requests.find((request) => request.method === "PATCH");
      if (found === undefined) throw new Error("no PATCH issued");
      return found;
    });
    const body = patch.body as { priority?: string; urgency?: string | null };
    expect(body.priority).toBe("normal");
    // The field vanished from the form; the client's words did not.
    expect(body.urgency).toBe("Backfill before Q4");
  });
});
