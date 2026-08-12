/**
 * Client detail access actions:
 * - grant-access dialog is disabled with an explanation until payment is
 *   confirmed, and surfaces the API's 422 PAYMENT_NOT_CONFIRMED on a race
 * - revoke access requires typing the company name (AC-UI-10)
 */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  errorResponse,
  installApiMock,
  makeClient,
  makeState,
  renderAdmin,
} from "./helpers";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("grant access", () => {
  it("disables the submit with an explanation while payment is unconfirmed", async () => {
    const user = userEvent.setup();
    const client = makeClient({ companyName: "Acme Corp" });
    installApiMock(makeState({ clients: [client] }));
    renderAdmin(`/admin/clients/${client.id}`);

    await user.click(
      await screen.findByRole("button", { name: /grant access/i }),
    );
    const dialog = screen.getByRole("dialog");
    const submit = within(dialog).getByRole("button", { name: "Grant access" });
    expect(submit).toBeDisabled();
    expect(
      within(dialog).getByText(/payment has not been confirmed/i),
    ).toBeInTheDocument();
  });

  it("submits when payment is confirmed and surfaces a 422 race", async () => {
    const user = userEvent.setup();
    const client = makeClient({
      companyName: "Acme Corp",
      paymentConfirmedAt: "2026-08-01T00:00:00+00:00",
      serviceTier: "standard_placement",
    });
    installApiMock(makeState({ clients: [client] }), (request) =>
      request.pathname.endsWith("/grant-access")
        ? errorResponse(
            "PAYMENT_NOT_CONFIRMED",
            "Payment must be confirmed first.",
            422,
          )
        : undefined,
    );
    renderAdmin(`/admin/clients/${client.id}`);

    await user.click(
      await screen.findByRole("button", { name: /grant access/i }),
    );
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Primary contact name"),
      "Jane Principal",
    );
    await user.type(
      within(dialog).getByLabelText("Primary contact email"),
      "jane@acme.test",
    );
    const submit = within(dialog).getByRole("button", { name: "Grant access" });
    expect(submit).toBeEnabled();
    await user.click(submit);

    expect(
      await within(dialog).findByText(
        /payment has not been confirmed for this client/i,
      ),
    ).toBeInTheDocument();
  });

  it("grants access on the happy path and refreshes the client", async () => {
    const user = userEvent.setup();
    const client = makeClient({
      companyName: "Acme Corp",
      paymentConfirmedAt: "2026-08-01T00:00:00+00:00",
      serviceTier: "standard_placement",
    });
    const mock = installApiMock(makeState({ clients: [client] }));
    renderAdmin(`/admin/clients/${client.id}`);

    await user.click(
      await screen.findByRole("button", { name: /grant access/i }),
    );
    const dialog = screen.getByRole("dialog");
    await user.type(
      within(dialog).getByLabelText("Primary contact name"),
      "Jane Principal",
    );
    await user.type(
      within(dialog).getByLabelText("Primary contact email"),
      "jane@acme.test",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Grant access" }),
    );

    // The access card flips to enabled and the member list gains the contact.
    expect(await screen.findByText(/^Enabled /)).toBeInTheDocument();
    expect(await screen.findByText("Jane Principal")).toBeInTheDocument();
    const grant = mock.requests.find((request) =>
      request.pathname.endsWith("/grant-access"),
    );
    expect(grant?.body).toEqual({
      primaryContactEmail: "jane@acme.test",
      primaryContactName: "Jane Principal",
      isPrincipal: true,
    });
  });
});

describe("revoke access", () => {
  it("requires typing the company name before revoking (AC-UI-10)", async () => {
    const user = userEvent.setup();
    const client = makeClient({
      companyName: "Acme Corp",
      status: "active",
      paymentConfirmedAt: "2026-08-01T00:00:00+00:00",
      portalAccessEnabledAt: "2026-08-02T00:00:00+00:00",
    });
    const mock = installApiMock(makeState({ clients: [client] }));
    renderAdmin(`/admin/clients/${client.id}`);

    await user.click(
      await screen.findByRole("button", { name: /revoke access/i }),
    );
    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", {
      name: "Revoke access",
    });
    expect(confirm).toBeDisabled();

    // A wrong name keeps it disarmed.
    const input = within(dialog).getByLabelText(/type/i);
    await user.type(input, "Acme");
    expect(confirm).toBeDisabled();

    await user.clear(input);
    await user.type(input, "Acme Corp");
    expect(confirm).toBeEnabled();
    await user.click(confirm);

    await waitFor(() => {
      expect(
        mock.requests.some((request) =>
          request.pathname.endsWith("/revoke-access"),
        ),
      ).toBe(true);
    });
  });
});
