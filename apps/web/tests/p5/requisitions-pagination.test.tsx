/**
 * The positions list must show ALL of a client's positions.
 *
 * `ListRequisitionsQuerySchema` caps `limit` at 100, and this list used to ask
 * for exactly 100 and keep whatever came back. A client with 101 positions saw
 * 100 — no counter, no "load more", nothing to suggest anything was missing.
 * Silent truncation on the screen someone uses to check on their hires is the
 * worst shape a bug can take, because it looks like it worked.
 *
 * These tests drive the cursor from the fetch layer, so they fail if the hook
 * ever stops following it.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
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

import {
  installClientPortalApiMock,
  makeRequisition,
  makeState,
  renderClientPortal,
} from "./helpers";

/** Two pages of positions, joined by a cursor the hook has to follow. */
function pagedState() {
  const first = makeRequisition({ advertisedTitle: "Executive Assistant" });
  const second = makeRequisition({ advertisedTitle: "Bookkeeper" });
  return { state: makeState({ requisitions: [first] }), first, second };
}

describe("the positions list is complete", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("follows the cursor, so a position on page two is not lost", async () => {
    const { state, second } = pagedState();

    const { requests } = installClientPortalApiMock(state, (request) => {
      if (request.method !== "GET" || !request.pathname.endsWith("/requisitions")) {
        return undefined;
      }
      // Page one hands back a cursor; page two ends the list.
      if (request.search.get("cursor") === null) {
        return new Response(
          JSON.stringify({
            data: state.requisitions,
            meta: { count: 1, nextCursor: "cursor-page-2" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({
          data: [second],
          meta: { count: 1, nextCursor: null },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    renderClientPortal("/client/requisitions");

    // The second page's position must reach the screen.
    expect(await screen.findByText("Bookkeeper")).toBeInTheDocument();
    expect(screen.getByText("Executive Assistant")).toBeInTheDocument();

    // And it must have asked for page two rather than guessed at it.
    await waitFor(() => {
      expect(
        requests.some(
          (entry) =>
            entry.pathname.endsWith("/requisitions") &&
            entry.search.get("cursor") === "cursor-page-2",
        ),
      ).toBe(true);
    });
  });

  it("stops after one request when there is no next page", async () => {
    // The common case, and the one a runaway loop would break: a single page
    // must not trigger a second call.
    const { state } = pagedState();
    const { requests } = installClientPortalApiMock(state);

    renderClientPortal("/client/requisitions");
    await screen.findByText("Executive Assistant");

    const listCalls = requests.filter(
      (entry) =>
        entry.method === "GET" && entry.pathname.endsWith("/requisitions"),
    );
    expect(listCalls).toHaveLength(1);
  });
});
