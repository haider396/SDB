/**
 * Interview details render in the VIEWER's timezone with an explicit label
 * (NFR-11); client-visible files fetch a fresh signed URL per access
 * (04 §8.1) — documents via window.open, media via an inline player.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  makeClientAssignment,
  makeInterview,
  makeRequisition,
  makeState,
  renderClientPortal,
  testUuid,
  withUnlockedPii,
} from "./helpers";

describe("interviews and files", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("renders interview details in the viewer's timezone with an explicit label", async () => {
    const requisition = makeRequisition({ status: "interviewing" });
    const row = withUnlockedPii(
      makeClientAssignment({
        requisitionId: requisition.id,
        displayName: "Maria G.",
      }),
    );
    const interview = makeInterview(row.assignmentId);
    const state = makeState({
      requisitionDetail: requisition,
      assignmentsByRequisitionId: { [requisition.id]: [row] },
      interviewsByAssignmentId: { [row.assignmentId]: [interview] },
    });
    installClientPortalApiMock(state);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    const card = await screen.findByRole("article", {
      name: "Candidate Maria G.",
    });
    expect(await within(card).findByText(/round 1/i)).toBeInTheDocument();

    // NFR-11: the scheduled instant, formatted for the VIEWING user's zone
    // in the browser's own locale (UX 3.7 — no hard-coded en-GB)…
    const viewerZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const expected = new Intl.DateTimeFormat(undefined, {
      day: "numeric",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: viewerZone,
    }).format(new Date("2026-08-20T15:00:00+00:00"));
    expect(within(card).getByText(new RegExp(expected))).toBeInTheDocument();
    // …with the zone named explicitly.
    expect(
      within(card).getByText(
        new RegExp(`Shown in your timezone \\(${viewerZone}\\)`),
      ),
    ).toBeInTheDocument();

    expect(
      within(card).getByRole("link", { name: /join meeting/i }),
    ).toHaveAttribute("href", "https://meet.example/sdb-round-1");
    expect(
      within(card).getByText("Casey Client, Robin Ops"),
    ).toBeInTheDocument();
    // Reject stays available while interviewing.
    expect(
      within(card).getByRole("button", { name: "Decline" }),
    ).toBeInTheDocument();
  });

  it("downloads a document via a freshly fetched signed URL", async () => {
    const user = userEvent.setup();
    const fileId = testUuid();
    const requisition = makeRequisition({ status: "candidates_presented" });
    const row = makeClientAssignment({
      requisitionId: requisition.id,
      files: [
        {
          id: fileId,
          fileType: "cv",
          originalFilename: "maria-cv.pdf",
          mimeType: "application/pdf",
          sizeBytes: 34567,
        },
      ],
    });
    const state = makeState({
      requisitionDetail: requisition,
      assignmentsByRequisitionId: { [requisition.id]: [row] },
    });
    const { requests } = installClientPortalApiMock(state);
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    const card = await screen.findByRole("article", {
      name: "Candidate Maria G.",
    });
    expect(within(card).getByText("maria-cv.pdf")).toBeInTheDocument();
    await user.click(within(card).getByRole("button", { name: "Download" }));

    await waitFor(() => {
      expect(
        requests.some(
          (request) =>
            request.method === "GET" &&
            request.pathname === `/api/v1/files/${fileId}/download-url`,
        ),
      ).toBe(true);
      expect(openSpy).toHaveBeenCalledWith(
        `https://signed.example/${fileId}`,
        "_blank",
        "noopener,noreferrer",
      );
    });
  });

  it("plays media inline through a signed URL instead of opening a tab", async () => {
    const user = userEvent.setup();
    const fileId = testUuid();
    const requisition = makeRequisition({ status: "candidates_presented" });
    const row = makeClientAssignment({
      requisitionId: requisition.id,
      files: [
        {
          id: fileId,
          fileType: "voice_sample",
          originalFilename: "maria-voice.mp3",
          mimeType: "audio/mpeg",
          sizeBytes: 123456,
        },
      ],
    });
    const state = makeState({
      requisitionDetail: requisition,
      assignmentsByRequisitionId: { [requisition.id]: [row] },
    });
    installClientPortalApiMock(state);
    const openSpy = vi.fn();
    vi.stubGlobal("open", openSpy);
    renderClientPortal(`/client/requisitions/${requisition.id}`);

    const card = await screen.findByRole("article", {
      name: "Candidate Maria G.",
    });
    await user.click(within(card).getByRole("button", { name: "Play" }));

    const player = await within(card).findByLabelText(
      "Audio player for maria-voice.mp3",
    );
    expect(player).toHaveAttribute("src", `https://signed.example/${fileId}`);
    expect(openSpy).not.toHaveBeenCalled();
  });
});
