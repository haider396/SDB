/**
 * Invite member dialog: inline validation (name, email) and the invite body
 * sent to POST /clients/:id/members/invite.
 */
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
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

describe("invite member", () => {
  it("shows inline validation errors and never calls the API", async () => {
    const user = userEvent.setup();
    const client = makeClient({ companyName: "Acme Corp" });
    const mock = installApiMock(makeState({ clients: [client] }));
    renderAdmin(`/admin/clients/${client.id}`);

    // Two triggers exist while the list is empty (card header + empty state).
    const [inviteTrigger] = await screen.findAllByRole("button", {
      name: /invite member/i,
    });
    if (inviteTrigger === undefined) throw new Error("No invite trigger");
    await user.click(inviteTrigger);
    const dialog = screen.getByRole("dialog");
    await user.click(
      within(dialog).getByRole("button", { name: "Send invitation" }),
    );

    expect(
      await within(dialog).findByText("Enter the member's full name."),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText("Enter the member's email."),
    ).toBeInTheDocument();

    // Bad email caught client-side too.
    await user.type(within(dialog).getByLabelText("Email"), "not-an-email");
    await user.click(
      within(dialog).getByRole("button", { name: "Send invitation" }),
    );
    expect(
      await within(dialog).findByText("Enter a valid email address."),
    ).toBeInTheDocument();

    expect(
      mock.requests.some((request) =>
        request.pathname.endsWith("/members/invite"),
      ),
    ).toBe(false);
  });

  it("sends the invitation with the chosen role and principal flag", async () => {
    const user = userEvent.setup();
    const client = makeClient({ companyName: "Acme Corp" });
    const mock = installApiMock(makeState({ clients: [client] }));
    renderAdmin(`/admin/clients/${client.id}`);

    // Two triggers exist while the list is empty (card header + empty state).
    const [inviteTrigger] = await screen.findAllByRole("button", {
      name: /invite member/i,
    });
    if (inviteTrigger === undefined) throw new Error("No invite trigger");
    await user.click(inviteTrigger);
    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Full name"), "Ops Olivia");
    await user.type(within(dialog).getByLabelText("Email"), "olivia@acme.test");
    await user.type(within(dialog).getByLabelText(/job title/i), "Head of Ops");
    await user.selectOptions(
      within(dialog).getByLabelText("Access"),
      "client_admin",
    );
    await user.click(
      within(dialog).getByLabelText(/authority to approve the brief/i),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Send invitation" }),
    );

    // Member appears in the list after the invalidation refetch.
    expect(await screen.findByText("Ops Olivia")).toBeInTheDocument();
    const invite = mock.requests.find((request) =>
      request.pathname.endsWith("/members/invite"),
    );
    expect(invite?.body).toEqual({
      email: "olivia@acme.test",
      fullName: "Ops Olivia",
      jobTitle: "Head of Ops",
      role: "client_admin",
      isPrincipal: true,
    });
  });
});
