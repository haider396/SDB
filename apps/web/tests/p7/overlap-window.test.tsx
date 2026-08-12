/**
 * P7 — requisition overlap-window editability: the fields card exposes the
 * overlap window (two time inputs + IANA zone select) and the PATCH body
 * carries overlapStart/overlapEnd/overlapTimezone as 'HH:MM' strings, or
 * null when cleared.
 */
import { fireEvent, screen, waitFor } from "@testing-library/react";
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

describe("requisition overlap window (fields card)", () => {
  it("sends overlapStart/overlapEnd/overlapTimezone in the PATCH body", async () => {
    const user = userEvent.setup();
    const { requisition, mock } = setup();

    const start = await screen.findByLabelText("Overlap from");
    const end = screen.getByLabelText("Overlap until");
    fireEvent.change(start, { target: { value: "09:00" } });
    fireEvent.change(end, { target: { value: "14:00" } });
    await user.selectOptions(
      screen.getByLabelText("Overlap timezone"),
      "America/Chicago",
    );

    await user.click(screen.getByRole("button", { name: "Save fields" }));

    await waitFor(() => {
      const patch = mock.requests.find(
        (request) =>
          request.method === "PATCH" &&
          request.pathname === `/api/v1/requisitions/${requisition.id}`,
      );
      expect(patch).toBeDefined();
      expect(patch?.body).toMatchObject({
        overlapStart: "09:00",
        overlapEnd: "14:00",
        overlapTimezone: "America/Chicago",
      });
    });
  });

  it("prefills stored HH:MM:SS values as HH:MM and clears them to null", async () => {
    const user = userEvent.setup();
    const { requisition, mock } = setup({
      overlapStart: "09:00:00",
      overlapEnd: "14:30:00",
      overlapTimezone: "America/Chicago",
    });

    const start = await screen.findByLabelText("Overlap from");
    expect(start).toHaveValue("09:00");
    expect(screen.getByLabelText("Overlap until")).toHaveValue("14:30");
    expect(screen.getByLabelText("Overlap timezone")).toHaveValue(
      "America/Chicago",
    );

    fireEvent.change(start, { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Overlap until"), {
      target: { value: "" },
    });
    await user.selectOptions(screen.getByLabelText("Overlap timezone"), "");

    await user.click(screen.getByRole("button", { name: "Save fields" }));

    await waitFor(() => {
      const patch = mock.requests.find(
        (request) =>
          request.method === "PATCH" &&
          request.pathname === `/api/v1/requisitions/${requisition.id}`,
      );
      expect(patch?.body).toMatchObject({
        overlapStart: null,
        overlapEnd: null,
        overlapTimezone: null,
      });
    });
  });

  it("requires a timezone whenever an overlap time is set", async () => {
    const user = userEvent.setup();
    setup();

    fireEvent.change(await screen.findByLabelText("Overlap from"), {
      target: { value: "09:00" },
    });
    await user.click(screen.getByRole("button", { name: "Save fields" }));

    expect(
      await screen.findByText(
        "Pick a timezone — an overlap window without one is ambiguous.",
      ),
    ).toBeInTheDocument();
  });
});
