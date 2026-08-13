/**
 * /client dashboard (04 §12): pending actions surface FIRST and link
 * straight to the work; brand-new clients get the reassuring empty state;
 * errors render the standard error state (AC-UI-02).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  errorResponse,
  installClientPortalApiMock,
  makeDashboard,
  makeRequisition,
  makeState,
  renderClientPortal,
  testPublicId,
  testUuid,
  NOW,
} from "./helpers";

describe("client dashboard", () => {
  beforeEach(() => {
    vi.useRealTimers();
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("renders pending actions first, each linking straight to the work", async () => {
    const requisitionId = testUuid();
    const state = makeState({
      dashboard: makeDashboard({
        pendingActions: {
          principalApprovals: [
            {
              requisitionId,
              reference: "REQ-000101",
              advertisedTitle: "Executive Assistant",
              since: NOW,
            },
          ],
          candidatesAwaitingReview: [
            {
              assignmentId: testUuid(),
              requisitionId,
              requisitionReference: "REQ-000101",
              displayName: "Maria G.",
              presentedAt: NOW,
            },
          ],
        },
      }),
    });
    installClientPortalApiMock(state);
    renderClientPortal("/client");

    expect(
      await screen.findByRole("heading", { name: "Needs your attention" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Brief awaiting your approval"),
    ).toBeInTheDocument();
    expect(
      screen.getByText("Maria G. is ready for your review"),
    ).toBeInTheDocument();

    expect(
      screen.getByRole("link", { name: /review brief/i }),
    ).toHaveAttribute("href", `/client/requisitions/${requisitionId}`);
    expect(
      screen.getByRole("link", { name: /review candidate/i }),
    ).toHaveAttribute("href", `/client/requisitions/${requisitionId}#candidates`);
  });

  it("shows the being-reviewed empty state for a brand-new client", async () => {
    const requisition = makeRequisition({ status: "submitted" });
    const state = makeState({
      dashboard: makeDashboard({
        requisitions: [
          {
            id: requisition.id,
            publicId: testPublicId(),
            reference: requisition.reference,
            advertisedTitle: requisition.advertisedTitle,
            status: "submitted",
            submittedAt: NOW,
            updatedAt: NOW,
            stageCounts: {},
          },
        ],
      }),
    });
    installClientPortalApiMock(state);
    renderClientPortal("/client");

    expect(
      await screen.findByText("Your hire request is being reviewed"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("heading", { name: "Needs your attention" }),
    ).not.toBeInTheDocument();
    // The summary card renders its stage strip's empty wording.
    expect(screen.getByText("No candidates presented yet")).toBeInTheDocument();
  });

  it("greets the signed-in user by first name and offers another hire", async () => {
    const state = makeState();
    installClientPortalApiMock(state);
    renderClientPortal("/client");

    expect(
      await screen.findByRole("heading", { name: "Welcome back, Casey" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /request another hire/i }),
    ).toHaveAttribute("href", "/client/requisitions/new");
  });

  it("humanizes the activity feed: title, client-language from→to, actor, link (UX 3.3)", async () => {
    const requisitionId = testUuid();
    const state = makeState({
      dashboard: makeDashboard({
        recentEvents: [
          {
            id: testUuid(),
            entityType: "requisition",
            entityId: requisitionId,
            eventType: "status_changed",
            actorId: testUuid(),
            actorName: "Rebecca K.",
            actorRole: "admin",
            fromValue: "submitted",
            toValue: "sourcing",
            metadata: {},
            occurredAt: NOW,
            requisitionReference: "REQ-000101",
            requisitionTitle: "Executive Assistant",
          },
        ],
      }),
    });
    installClientPortalApiMock(state);
    renderClientPortal("/client");

    // Title links to the requisition; the sentence is client wording —
    // never the raw enum values.
    const link = await screen.findByRole("link", {
      name: "Executive Assistant",
    });
    expect(link).toHaveAttribute("href", `/client/requisitions/${requisitionId}`);
    expect(
      screen.getByText(/moved from being reviewed to sourcing candidates/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/by rebecca k\./i)).toBeInTheDocument();
    expect(screen.queryByText("sourcing")).not.toBeInTheDocument();
    expect(screen.queryByText("status_changed")).not.toBeInTheDocument();
    // The feed header carries a visible absolute "as of" line (UX 3.7).
    expect(screen.getByText(/as of /)).toBeInTheDocument();
  });

  it("frames active sourcing with elapsed days instead of an empty line (UX 3.3)", async () => {
    const requisition = makeRequisition({ status: "sourcing" });
    const state = makeState({
      dashboard: makeDashboard({
        requisitions: [
          {
            id: requisition.id,
            publicId: testPublicId(),
            reference: requisition.reference,
            advertisedTitle: requisition.advertisedTitle,
            status: "sourcing",
            submittedAt: NOW,
            updatedAt: NOW,
            stageCounts: {},
          },
        ],
      }),
    });
    installClientPortalApiMock(state);
    renderClientPortal("/client");

    expect(
      await screen.findByText(/we’re sourcing candidates — day/i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/typical first candidates within ~21 days/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("No candidates presented yet"),
    ).not.toBeInTheDocument();
  });

  it("suppresses review-candidate prompts for placed/closed requisitions (UX 3.3)", async () => {
    const placedId = testUuid();
    const openId = testUuid();
    const state = makeState({
      dashboard: makeDashboard({
        requisitions: [
          {
            id: placedId,
            publicId: testPublicId(),
            reference: "REQ-000201",
            advertisedTitle: "Filled role",
            status: "placed",
            submittedAt: NOW,
            updatedAt: NOW,
            stageCounts: { placed: 1 },
          },
          {
            id: openId,
            publicId: testPublicId(),
            reference: "REQ-000202",
            advertisedTitle: "Open role",
            status: "candidates_presented",
            submittedAt: NOW,
            updatedAt: NOW,
            stageCounts: { presented: 1 },
          },
        ],
        pendingActions: {
          principalApprovals: [],
          candidatesAwaitingReview: [
            {
              assignmentId: testUuid(),
              requisitionId: placedId,
              requisitionReference: "REQ-000201",
              displayName: "Stale S.",
              presentedAt: NOW,
            },
            {
              assignmentId: testUuid(),
              requisitionId: openId,
              requisitionReference: "REQ-000202",
              displayName: "Active A.",
              presentedAt: NOW,
            },
          ],
        },
      }),
    });
    installClientPortalApiMock(state);
    renderClientPortal("/client");

    expect(
      await screen.findByText("Active A. is ready for your review"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Stale S. is ready for your review"),
    ).not.toBeInTheDocument();
  });

  it("renders the error state when the dashboard fails", async () => {
    const state = makeState();
    installClientPortalApiMock(state, (request) =>
      request.pathname.endsWith("/client/dashboard")
        ? errorResponse("INTERNAL", "Boom.", 500)
        : undefined,
    );
    renderClientPortal("/client");

    await waitFor(() => {
      expect(screen.getByText("Could not load this")).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});
