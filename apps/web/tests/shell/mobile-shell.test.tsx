/**
 * UX 1.5 mobile shell: below lg the sidebar becomes an off-canvas drawer —
 * hidden by default, opened from the top bar's hamburger, Escape closes,
 * and a nav click both navigates and closes it. The client drawer also
 * carries the "Contact your SDB team" mailto block (UX 3.7).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import type { Session } from "@supabase/supabase-js";

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    useSession: () => ({
      session: {} as unknown as Session,
      isLoading: false,
    }),
    getAccessToken: async () => "test-token",
  };
});

import { ClientLayout } from "@/components/layout/client-layout";

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetchMock() {
  vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const path = new URL(String(input)).pathname;
      if (path === "/api/v1/auth/me") {
        return jsonResponse({
          data: {
            user: {
              id: "00000000-0000-4000-8000-000000000001",
              email: "casey@acme.test",
              fullName: "Casey Client",
              phone: null,
              avatarPath: null,
              timezone: "America/New_York",
              isActive: true,
              lastLoginAt: null,
            },
            roles: ["client_admin"],
            permissions: ["requisition.view"],
            clientId: "00000000-0000-4000-8000-000000000002",
          },
        });
      }
      if (path === "/api/v1/client/dashboard") {
        return jsonResponse({
          data: {
            requisitions: [],
            pendingActions: {
              principalApprovals: [],
              candidatesAwaitingReview: [],
            },
            recentEvents: [],
          },
        });
      }
      throw new Error(`Unhandled request: ${path}`);
    }),
  );
}

/**
 * The data router builds an internal Request({signal}) on every navigation;
 * jsdom's AbortSignal is not undici's, which throws. Loaders are unused
 * here, so a Request that drops the signal is behaviour-identical.
 */
function installLenientRequest() {
  const OriginalRequest = globalThis.Request;
  class LenientRequest extends OriginalRequest {
    constructor(input: RequestInfo | URL, init?: RequestInit) {
      if (init && "signal" in init) {
        const { signal: _signal, ...rest } = init;
        super(input, rest);
      } else {
        super(input, init);
      }
    }
  }
  vi.stubGlobal("Request", LenientRequest);
}

function renderShell() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      {
        path: "/client",
        element: <ClientLayout />,
        children: [
          { index: true, element: <div>Dashboard page body</div> },
          { path: "requisitions", element: <div>Requisitions page body</div> },
        ],
      },
    ],
    { initialEntries: ["/client"] },
  );
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe("mobile navigation drawer (UX 1.5)", () => {
  beforeEach(() => {
    installFetchMock();
    installLenientRequest();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("is hidden by default and opens from the hamburger", async () => {
    const user = userEvent.setup();
    renderShell();
    await screen.findByText("Dashboard page body");

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Open navigation" }));

    const drawer = await screen.findByRole("dialog", { name: "Navigation" });
    expect(
      within(drawer).getByRole("link", { name: /my placements/i }),
    ).toBeInTheDocument();
    // Contact block (UX 3.7) with the mailto link.
    expect(within(drawer).getByText("Questions?")).toBeInTheDocument();
    expect(
      within(drawer).getByRole("link", { name: /contact your sdb team/i }),
    ).toHaveAttribute("href", "mailto:rebecca@teamdonebetter.com");
  });

  it("closes on Escape", async () => {
    const user = userEvent.setup();
    renderShell();
    await screen.findByText("Dashboard page body");

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    await screen.findByRole("dialog", { name: "Navigation" });
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("navigates AND closes when a nav item is clicked", async () => {
    const user = userEvent.setup();
    renderShell();
    await screen.findByText("Dashboard page body");

    await user.click(screen.getByRole("button", { name: "Open navigation" }));
    const drawer = await screen.findByRole("dialog", { name: "Navigation" });
    await user.click(
      within(drawer).getByRole("link", { name: /my placements/i }),
    );

    await screen.findByText("Requisitions page body");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });
});
