/**
 * P7 — the admin notification log (06 §4.3): list + status/event filters
 * drive the query string, the payload sheet pretty-prints the stored JSON,
 * and the Resend action posts to /admin/notifications/:id/resend — visible
 * only with settings.manage.
 */
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";
import type {
  AuthMeResponse,
  NotificationLogRow,
  PermissionKey,
} from "@sdb/contracts";

// useCan → useMe is enabled only while a session exists, so stub one.
vi.mock("@/lib/auth", () => ({
  useSession: () => ({
    session: {} as unknown as Session,
    isLoading: false,
  }),
  getAccessToken: async () => "test-token",
}));
import { NotificationsPage } from "@/features/notifications";
import {
  NOW,
  jsonResponse,
  testUuid,
  type Override,
  type RecordedRequest,
} from "../p3/helpers";
import { makeMe } from "../p5/helpers";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeRow(
  overrides?: Partial<NotificationLogRow>,
): NotificationLogRow {
  return {
    id: testUuid(),
    event: "candidates_presented",
    recipientEmail: "casey@acme.test",
    recipientUserId: testUuid(),
    entityType: "requisition",
    entityId: testUuid(),
    payload: {
      event: "candidates_presented",
      recipient: { email: "casey@acme.test" },
      context: { clientName: "Acme Corp" },
    },
    provider: "gohighlevel",
    providerResponse: null,
    status: "sent",
    attempts: 1,
    lastError: null,
    createdAt: NOW,
    sentAt: NOW,
    ...overrides,
  };
}

const ADMIN_PERMISSIONS: PermissionKey[] = [
  "event.view",
  "settings.manage",
];

function adminMe(permissions: PermissionKey[] = ADMIN_PERMISSIONS): AuthMeResponse {
  return makeMe({
    roles: ["super_admin"],
    permissions,
    clientId: null,
  });
}

// ---------------------------------------------------------------------------
// Fetch mock + rendering
// ---------------------------------------------------------------------------

interface NotificationsState {
  me: AuthMeResponse;
  rows: NotificationLogRow[];
}

interface NotificationsApiMock {
  requests: RecordedRequest[];
  state: NotificationsState;
}

function installNotificationsApiMock(
  state: NotificationsState,
  override?: Override,
): NotificationsApiMock {
  vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
  const requests: RecordedRequest[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body =
        init?.body !== undefined && init?.body !== null
          ? (JSON.parse(String(init.body)) as unknown)
          : undefined;
      const recorded: RecordedRequest = {
        method,
        pathname: url.pathname,
        search: url.searchParams,
        body,
      };
      requests.push(recorded);

      const custom = await override?.(recorded);
      if (custom !== undefined) return custom;

      const path = url.pathname.replace(/^\/api\/v1/, "");

      if (method === "GET" && path === "/auth/me") {
        return jsonResponse({ data: state.me });
      }
      if (method === "GET" && path === "/admin/notifications") {
        const status = url.searchParams.get("status");
        const event = url.searchParams.get("event");
        const data = state.rows.filter(
          (row) =>
            (status === null || row.status === status) &&
            (event === null || row.event === event),
        );
        return jsonResponse({
          data,
          meta: { count: data.length, nextCursor: null },
        });
      }
      const resend = path.match(
        /^\/admin\/notifications\/([0-9a-f-]{36})\/resend$/,
      );
      if (resend !== null && method === "POST") {
        const row = state.rows.find((entry) => entry.id === resend[1]);
        if (row === undefined) throw new Error("Unknown notification id");
        row.status = "sent";
        row.attempts += 1;
        row.lastError = null;
        row.sentAt = NOW;
        return jsonResponse({ data: row });
      }

      throw new Error(`Unhandled request: ${method} ${url.pathname}`);
    }),
  );

  return { requests, state };
}

function renderNotifications(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [{ path: "/admin/notifications", element: <NotificationsPage /> }],
    { initialEntries: ["/admin/notifications"] },
  );
  const ui: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  );
  return render(ui);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("notification log page", () => {
  it("lists notifications with status badge, event, recipient, attempts, and truncated error", async () => {
    const failed = makeRow({
      status: "failed",
      event: "portal_invitation",
      recipientEmail: "pat@client.test",
      attempts: 5,
      lastError: "HTTP 500 from GoHighLevel",
      sentAt: null,
    });
    installNotificationsApiMock({ me: adminMe(), rows: [makeRow(), failed] });
    renderNotifications();

    expect(await screen.findByText("casey@acme.test")).toBeInTheDocument();
    const table = within(
      screen.getByRole("table", { name: "Notification log" }),
    );
    expect(table.getByText("Sent")).toBeInTheDocument();
    expect(table.getByText("Failed")).toBeInTheDocument();
    expect(table.getByText("Candidates presented")).toBeInTheDocument();
    expect(table.getByText("Portal invitation")).toBeInTheDocument();
    expect(table.getByText("5")).toBeInTheDocument();
    const error = table.getByText("HTTP 500 from GoHighLevel");
    // Truncated with the full text on the title (hover) attribute.
    expect(error).toHaveAttribute("title", "HTTP 500 from GoHighLevel");
    expect(error.className).toContain("truncate");
  });

  it("filters by status and event via the query string", async () => {
    const mock = installNotificationsApiMock({
      me: adminMe(),
      rows: [
        makeRow(),
        makeRow({
          status: "failed",
          event: "portal_invitation",
          recipientEmail: "pat@client.test",
        }),
      ],
    });
    renderNotifications();
    const user = userEvent.setup();

    await screen.findByText("casey@acme.test");
    await user.selectOptions(screen.getByLabelText("Status"), "failed");

    await waitFor(() => {
      const call = mock.requests.find(
        (request) =>
          request.pathname === "/api/v1/admin/notifications" &&
          request.search.get("status") === "failed",
      );
      expect(call).toBeDefined();
    });
    expect(await screen.findByText("pat@client.test")).toBeInTheDocument();
    expect(screen.queryByText("casey@acme.test")).not.toBeInTheDocument();

    await user.selectOptions(
      screen.getByLabelText("Event"),
      "portal_invitation",
    );
    await waitFor(() => {
      const call = mock.requests.find(
        (request) =>
          request.pathname === "/api/v1/admin/notifications" &&
          request.search.get("status") === "failed" &&
          request.search.get("event") === "portal_invitation",
      );
      expect(call).toBeDefined();
    });
  });

  it("resends a failed notification via POST /admin/notifications/:id/resend", async () => {
    const failed = makeRow({
      status: "failed",
      lastError: "HTTP 500 from GoHighLevel",
      sentAt: null,
    });
    const mock = installNotificationsApiMock({
      me: adminMe(),
      rows: [failed],
    });
    renderNotifications();
    const user = userEvent.setup();

    await user.click(
      await screen.findByRole("button", { name: /^Resend/ }),
    );

    await waitFor(() => {
      const post = mock.requests.find((request) => request.method === "POST");
      expect(post?.pathname).toBe(
        `/api/v1/admin/notifications/${failed.id}/resend`,
      );
    });
    // The list refetches and the row now shows as sent.
    await waitFor(() => {
      const table = within(
        screen.getByRole("table", { name: "Notification log" }),
      );
      expect(table.getByText("Sent")).toBeInTheDocument();
    });
  });

  it("hides the Resend action without settings.manage", async () => {
    installNotificationsApiMock({
      me: adminMe(["event.view"]),
      rows: [
        makeRow({ status: "failed", lastError: "HTTP 500", sentAt: null }),
      ],
    });
    renderNotifications();

    expect(await screen.findByText("casey@acme.test")).toBeInTheDocument();
    // The payload action stays; resend never renders.
    expect(
      screen.getByRole("button", { name: /^Payload/ }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: /^Resend/ }),
      ).not.toBeInTheDocument();
    });
  });

  it("shows the stored payload pretty-printed in the sheet", async () => {
    const row = makeRow();
    installNotificationsApiMock({ me: adminMe(), rows: [row] });
    renderNotifications();
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /^Payload/ }));

    expect(
      await screen.findByText("Candidates presented payload"),
    ).toBeInTheDocument();
    const pre = document.querySelector("pre");
    expect(pre).not.toBeNull();
    expect(pre?.textContent).toBe(JSON.stringify(row.payload, null, 2));
  });
});
