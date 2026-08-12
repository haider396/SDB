/**
 * P7 — manual client creation from the clients list (04 §6 POST /clients):
 * the dialog posts the exact CreateClientBody and navigates to the new
 * client's workspace on success.
 */
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  useSession: () => ({ session: {}, isLoading: false }),
  getAccessToken: async () => "test-token",
}));
import {
  installApiMock,
  jsonResponse,
  makeClient,
  makeState,
  renderAdmin,
} from "../p2/helpers";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("new client action", () => {
  it("posts the exact body and navigates to the created client's detail", async () => {
    const created = makeClient({
      companyName: "Globex Corp",
      website: "https://globex.test",
      industry: "Manufacturing",
      teamSizeBand: "11-50",
      companyTimezone: "America/Chicago",
    });
    const state = makeState();
    const mock = installApiMock(state, (request) => {
      if (request.method === "POST" && request.pathname === "/api/v1/clients") {
        // The in-memory server "persists" it so the detail page resolves.
        state.clients.push(created);
        return jsonResponse({ data: created }, 201);
      }
      return undefined;
    });
    renderAdmin("/admin/clients");
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "New client" }),
    );
    await user.type(screen.getByLabelText("Company name"), "Globex Corp");
    await user.type(screen.getByLabelText(/Website/), "https://globex.test");
    await user.type(screen.getByLabelText(/Industry/), "Manufacturing");
    await user.type(screen.getByLabelText(/Team size/), "11-50");
    await user.type(
      screen.getByLabelText(/Company timezone/),
      "America/Chicago",
    );
    await user.click(screen.getByRole("button", { name: "Create client" }));

    await waitFor(() => {
      const post = mock.requests.find(
        (request) =>
          request.method === "POST" &&
          request.pathname === "/api/v1/clients",
      );
      expect(post).toBeDefined();
      expect(post?.body).toEqual({
        companyName: "Globex Corp",
        website: "https://globex.test",
        industry: "Manufacturing",
        teamSizeBand: "11-50",
        companyTimezone: "America/Chicago",
      });
    });

    // Navigated to /admin/clients/:id — the workspace heading renders.
    expect(
      await screen.findByRole("heading", { name: "Globex Corp" }),
    ).toBeInTheDocument();
  });

  it("requires a company name and posts optional fields as null when blank", async () => {
    const created = makeClient({ companyName: "Solo LLC" });
    const state = makeState();
    const mock = installApiMock(state, (request) => {
      if (request.method === "POST" && request.pathname === "/api/v1/clients") {
        state.clients.push(created);
        return jsonResponse({ data: created }, 201);
      }
      return undefined;
    });
    renderAdmin("/admin/clients");
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: "New client" }),
    );
    await user.click(screen.getByRole("button", { name: "Create client" }));
    expect(
      await screen.findByText("Enter the company name."),
    ).toBeInTheDocument();
    expect(
      mock.requests.find((request) => request.method === "POST"),
    ).toBeUndefined();

    await user.type(screen.getByLabelText("Company name"), "Solo LLC");
    await user.click(screen.getByRole("button", { name: "Create client" }));

    await waitFor(() => {
      const post = mock.requests.find(
        (request) => request.method === "POST",
      );
      expect(post?.body).toEqual({
        companyName: "Solo LLC",
        website: null,
        industry: null,
        teamSizeBand: null,
        companyTimezone: null,
      });
    });
  });
});
