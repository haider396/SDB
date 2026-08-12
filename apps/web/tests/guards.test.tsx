import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequireAuth } from "@/components/guards/require-auth";
import { RequirePermission } from "@/components/guards/require-permission";
import type { AuthMeResponse, PermissionKey } from "@sdb/contracts";
import type { SessionState } from "@/lib/auth";
import { useMe } from "@/lib/permissions";

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, useSession: vi.fn() };
});

vi.mock("@/lib/permissions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/permissions")>();
  return { ...actual, useMe: vi.fn() };
});

const { useSession } = await import("@/lib/auth");
const mockedUseSession = vi.mocked(useSession);
const mockedUseMe = vi.mocked(useMe);

function meWith(permissions: PermissionKey[]): AuthMeResponse {
  return {
    user: {
      id: "3f0e8a1c-0000-4000-8000-000000000001",
      email: "user@example.com",
      fullName: "Test User",
      phone: null,
      avatarPath: null,
      timezone: "UTC",
      isActive: true,
      lastLoginAt: null,
    },
    roles: ["admin"],
    permissions,
    clientId: null,
  };
}

function meQueryResult(me: AuthMeResponse): ReturnType<typeof useMe> {
  return {
    data: me,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useMe>;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("RequireAuth", () => {
  it("redirects unauthenticated users to /login", () => {
    mockedUseSession.mockReturnValue({
      session: null,
      isLoading: false,
    } satisfies SessionState);

    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/login" element={<div>Login page</div>} />
          <Route
            path="/admin"
            element={
              <RequireAuth>
                <div>Admin area</div>
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Login page")).toBeInTheDocument();
    expect(screen.queryByText("Admin area")).not.toBeInTheDocument();
  });

  it("renders children when a session exists", () => {
    mockedUseSession.mockReturnValue({
      session: { access_token: "t" } as unknown as SessionState["session"],
      isLoading: false,
    });

    render(
      <MemoryRouter initialEntries={["/admin"]}>
        <Routes>
          <Route path="/login" element={<div>Login page</div>} />
          <Route
            path="/admin"
            element={
              <RequireAuth>
                <div>Admin area</div>
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByText("Admin area")).toBeInTheDocument();
  });
});

describe("RequirePermission", () => {
  it("renders a 403 page (no redirect) when the permission is missing", () => {
    mockedUseMe.mockReturnValue(meQueryResult(meWith(["candidate.view"])));

    render(
      <RequirePermission permission="settings.manage">
        <div>Settings page</div>
      </RequirePermission>,
    );

    expect(
      screen.getByText(/403 — You do not have access to this page/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Settings page")).not.toBeInTheDocument();
  });

  it("renders children when the permission is present", () => {
    mockedUseMe.mockReturnValue(meQueryResult(meWith(["settings.manage"])));

    render(
      <RequirePermission permission="settings.manage">
        <div>Settings page</div>
      </RequirePermission>,
    );

    expect(screen.getByText("Settings page")).toBeInTheDocument();
  });
});
