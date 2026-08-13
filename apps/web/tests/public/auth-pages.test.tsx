/**
 * Public auth surfaces (UX 1.1 + 1.6):
 *  - accept-invitation: token from URL, form → POST /auth/accept-invitation,
 *    → /login with a success banner; expired/used token → clear explanation;
 *    missing token → guidance instead of a dead form.
 *  - forgot-password: always the same neutral confirmation (no enumeration).
 *  - login: show-password toggle + forgot-password link.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
// Plain MemoryRouter (not the data router): jsdom's AbortSignal is
// incompatible with the data router's internal Request construction, and
// these pages use no data-router features.
import { MemoryRouter, Route, Routes } from "react-router-dom";

const resetPasswordForEmail = vi.fn<(email: string) => Promise<void>>();

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    resetPasswordForEmail: (email: string) => resetPasswordForEmail(email),
  };
});

import { AcceptInvitationPage } from "@/routes/public/accept-invitation-page";
import { ForgotPasswordPage } from "@/routes/public/forgot-password-page";
import { LoginPage } from "@/routes/public/login-page";

function renderAt(initialPath: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialPath]}>
        <Routes>
          <Route path="/accept-invitation" element={<AcceptInvitationPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/login" element={<LoginPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

interface Recorded {
  pathname: string;
  method: string;
  body: unknown;
}

function installFetchMock(respond: () => Response): Recorded[] {
  vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
  const requests: Recorded[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({
        pathname: new URL(String(input)).pathname,
        method: init?.method ?? "GET",
        body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined,
      });
      return respond();
    }),
  );
  return requests;
}

async function fillInvitationForm(
  user: ReturnType<typeof userEvent.setup>,
  confirm = "hunter2hunter2",
) {
  await user.type(screen.getByLabelText("Full name"), "Priya Principal");
  await user.type(screen.getByLabelText("Password"), "hunter2hunter2");
  await user.type(screen.getByLabelText("Confirm password"), confirm);
}

describe("accept-invitation page (UX 1.1)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("posts the token + profile, then lands on /login with a success banner", async () => {
    const user = userEvent.setup();
    const requests = installFetchMock(() =>
      jsonResponse({ data: { accepted: true } }),
    );
    renderAt("/accept-invitation?token=tok_abc123");

    await fillInvitationForm(user);
    await user.click(
      screen.getByRole("button", { name: "Create my account" }),
    );

    await waitFor(() => {
      expect(requests).toHaveLength(1);
    });
    const posted = requests[0];
    expect(posted?.pathname).toBe("/api/v1/auth/accept-invitation");
    expect(posted?.method).toBe("POST");
    expect(posted?.body).toMatchObject({
      token: "tok_abc123",
      fullName: "Priya Principal",
      password: "hunter2hunter2",
    });
    expect(
      (posted?.body as { timezone: string }).timezone.length,
    ).toBeGreaterThan(0);

    // Landed on the login page with the ready banner.
    expect(
      await screen.findByRole("heading", { name: "Sign in" }),
    ).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(
      "Your account is ready — sign in with your email and new password.",
    );
  });

  it("blocks mismatched passwords before any request", async () => {
    const user = userEvent.setup();
    const requests = installFetchMock(() =>
      jsonResponse({ data: { accepted: true } }),
    );
    renderAt("/accept-invitation?token=tok_abc123");

    await fillInvitationForm(user, "different-password");
    await user.click(
      screen.getByRole("button", { name: "Create my account" }),
    );

    expect(
      await screen.findByText("Passwords do not match"),
    ).toBeInTheDocument();
    expect(requests).toHaveLength(0);
  });

  it("explains an expired/used token and points at the SDB contact", async () => {
    const user = userEvent.setup();
    installFetchMock(() =>
      jsonResponse(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "Invalid or expired invitation token.",
          },
        },
        422,
      ),
    );
    renderAt("/accept-invitation?token=tok_expired");

    await fillInvitationForm(user);
    await user.click(
      screen.getByRole("button", { name: "Create my account" }),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/no longer valid/i);
    expect(alert).toHaveTextContent(/re-invite you/i);
  });

  it("handles a missing token with guidance instead of a dead form", () => {
    installFetchMock(() => jsonResponse({ data: { accepted: true } }));
    renderAt("/accept-invitation");

    expect(
      screen.getByText("This invitation link is incomplete"),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Full name")).not.toBeInTheDocument();
  });
});

describe("forgot password (UX 1.6)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("sends the reset email and shows the neutral confirmation", async () => {
    resetPasswordForEmail.mockResolvedValueOnce(undefined);
    const user = userEvent.setup();
    renderAt("/forgot-password");

    await user.type(screen.getByLabelText("Email"), "casey@acme.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(
      await screen.findByText(/if that address exists, a reset link is on its way/i),
    ).toBeInTheDocument();
    expect(resetPasswordForEmail).toHaveBeenCalledWith("casey@acme.test");
  });

  it("shows the SAME confirmation when the reset call fails (no enumeration)", async () => {
    resetPasswordForEmail.mockRejectedValueOnce(new Error("no such user"));
    const user = userEvent.setup();
    renderAt("/forgot-password");

    await user.type(screen.getByLabelText("Email"), "nobody@nowhere.test");
    await user.click(screen.getByRole("button", { name: "Send reset link" }));

    expect(
      await screen.findByText(/if that address exists, a reset link is on its way/i),
    ).toBeInTheDocument();
  });
});

describe("login page extras (UX 1.6)", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("links to forgot-password and toggles password visibility", async () => {
    const user = userEvent.setup();
    renderAt("/login");

    expect(
      screen.getByRole("link", { name: "Forgot password?" }),
    ).toHaveAttribute("href", "/forgot-password");

    const passwordInput = screen.getByLabelText("Password");
    expect(passwordInput).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: "Show password" }));
    expect(passwordInput).toHaveAttribute("type", "text");
    await user.click(screen.getByRole("button", { name: "Hide password" }));
    expect(passwordInput).toHaveAttribute("type", "password");
  });
});
