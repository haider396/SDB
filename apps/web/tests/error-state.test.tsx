/**
 * ErrorState: Retry is only offered where repeating the request could actually
 * succeed. On 401/403/404/410 it is suppressed in favour of a real router link
 * back to the parent list, so a bad id is not a dead end (AC-UI-04).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  ErrorState,
  type ErrorStateProps,
} from "@/components/patterns/error-state";
import { ApiError } from "@/lib/api-client";

/**
 * Same shim as tests/p2/helpers.tsx: jsdom's AbortController produces signals
 * that Node's undici Request rejects, and React Router's data router builds
 * such a Request on every navigation — which is exactly what the back link
 * does. Retry without the signal; nothing here aborts a navigation.
 */
const NativeRequest = globalThis.Request;
globalThis.Request = new Proxy(NativeRequest, {
  construct(target, args: [RequestInfo | URL, RequestInit?]) {
    const [input, init] = args;
    try {
      return new target(input, init);
    } catch {
      return new target(input, { ...init, signal: undefined });
    }
  },
});

const backTo = { to: "/admin/candidates", label: "Candidates" };

/**
 * The back link is a <Link>, so it needs a router. Routing to a real list
 * route as well proves the link navigates rather than just rendering.
 */
function renderErrorState(props: ErrorStateProps) {
  const router = createMemoryRouter(
    [
      { path: "/admin/candidates/:id", element: <ErrorState {...props} /> },
      { path: "/admin/candidates", element: <h1>Candidates list</h1> },
    ],
    { initialEntries: ["/admin/candidates/does-not-exist"] },
  );
  return render(<RouterProvider router={router} />);
}

function makeError(
  status: number,
  code:
    | "NOT_FOUND"
    | "FORBIDDEN"
    | "UNAUTHENTICATED"
    | "INTERNAL_ERROR"
    | "NETWORK_ERROR"
    | "UNPARSEABLE_RESPONSE",
  message = "Boom.",
): ApiError {
  return new ApiError({ code, message, status, requestId: "req_123" });
}

describe("ErrorState — retry is suppressed where it cannot succeed", () => {
  it("404: offers the back link and no Retry", async () => {
    const onRetry = vi.fn();
    renderErrorState({
      error: makeError(404, "NOT_FOUND"),
      onRetry,
      backTo,
    });

    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();

    const link = screen.getByRole("link", { name: "Back to Candidates" });
    expect(link).toHaveAttribute("href", "/admin/candidates");
    expect(screen.getByText("Not found")).toBeInTheDocument();

    // A real link, so keyboard alone gets out of the dead end (AC-UI-04).
    await userEvent.tab();
    expect(link).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(
      screen.getByRole("heading", { name: "Candidates list" }),
    ).toBeInTheDocument();
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("403: says the viewer lacks access without describing the record", () => {
    renderErrorState({
      // A server message that names the row must not reach the page: echoing it
      // confirms the record to someone who is not allowed to know it exists.
      error: makeError(403, "FORBIDDEN", "Candidate Jane Doe is not yours."),
      message: "Could not load this candidate.",
      onRetry: vi.fn(),
      backTo,
    });

    expect(screen.getByText("You do not have access")).toBeInTheDocument();
    expect(screen.queryByText(/Jane Doe/)).not.toBeInTheDocument();
    expect(
      screen.queryByText("Could not load this candidate."),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Back to Candidates" }),
    ).toBeInTheDocument();
  });

  it("401 and 410 also drop Retry", () => {
    const { unmount } = renderErrorState({
      error: makeError(401, "UNAUTHENTICATED"),
      onRetry: vi.fn(),
      backTo,
    });
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
    unmount();

    renderErrorState({
      // A 410 arrives without an enveloped code when the body is not JSON.
      error: makeError(410, "UNPARSEABLE_RESPONSE"),
      onRetry: vi.fn(),
      backTo,
    });
    expect(
      screen.queryByRole("button", { name: "Retry" }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("No longer available")).toBeInTheDocument();
  });
});

describe("ErrorState — retry is kept where it might work", () => {
  it("500: keeps Retry and still calls back", async () => {
    const onRetry = vi.fn();
    renderErrorState({
      error: makeError(500, "INTERNAL_ERROR"),
      onRetry,
      backTo,
    });

    const retry = screen.getByRole("button", { name: "Retry" });
    await userEvent.click(retry);
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Could not load this")).toBeInTheDocument();
  });

  it.each([502, 503])("%i: keeps Retry", (status) => {
    renderErrorState({
      error: makeError(status, "INTERNAL_ERROR"),
      onRetry: vi.fn(),
      backTo,
    });
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("a network failure with no status keeps Retry", () => {
    // api-client builds this with status 0 when fetch itself rejects.
    renderErrorState({
      error: makeError(0, "NETWORK_ERROR", "Could not reach the server."),
      onRetry: vi.fn(),
      backTo,
    });

    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.getByText("Could not reach the server.")).toBeInTheDocument();
  });

  it("a plain Error carrying no status at all keeps Retry", () => {
    renderErrorState({
      error: new Error("This form has no editable version."),
      onRetry: vi.fn(),
    });
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("ErrorState — existing call sites are unaffected", () => {
  it("renders without a router when no backTo is passed", async () => {
    const onRetry = vi.fn();
    render(<ErrorState error={makeError(500, "INTERNAL_ERROR")} onRetry={onRetry} />);

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Request ID: req_123")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
});
