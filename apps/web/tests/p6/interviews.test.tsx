/**
 * P6 — interview management on the pipeline board (04 §10, J7):
 * - Schedule dialog on client_reviewing cards posts the exact
 *   CreateInterviewBody with the viewer's timezone as the default, and
 *   surfaces a 409 INVALID_TRANSITION inline.
 * - interview_scheduled cards show the pending round in the viewer's
 *   timezone (NFR-11 label) with the meeting link.
 * - The outcome dialog posts the exact OutcomeBody; `rescheduled` keeps the
 *   card at Interview scheduled with NO outcome chip; `passed` moves it to
 *   Interviewed with a chip.
 * - Cancel posts to /interviews/:id/cancel and never moves the card.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { AdminAssignmentRow, Interview } from "@sdb/contracts";
import {
  viewerTimezone,
  zonedWallTimeToIso,
} from "@/features/pipeline/interview-time";
import {
  NOW,
  errorResponse,
  installPipelineApiMock,
  jsonResponse,
  makeAssignment,
  makeCandidate,
  makeDetail,
  makePipelineState,
  makeRequisition,
  renderPipeline,
  testUuid,
  type PipelineApiMock,
  type PipelineServerState,
  type RecordedRequest,
} from "../p4/helpers";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

function makeInterview(
  assignmentId: string,
  overrides?: Partial<Interview>,
): Interview {
  return {
    id: testUuid(),
    assignmentId,
    roundNumber: 1,
    scheduledAt: "2026-08-20T14:30:00.000Z",
    timezone: "UTC",
    durationMinutes: 45,
    meetingUrl: "https://meet.example.com/abc",
    interviewerNames: "Rebecca, Sam",
    requestedBy: null,
    createdBy: testUuid(),
    outcome: "pending",
    outcomeNotes: null,
    outcomeRecordedBy: null,
    outcomeRecordedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

/**
 * Interview routes on top of the p4 pipeline mock: an in-memory interviews
 * table whose writes also move the assignment stage the way the API does.
 */
function interviewOverride(
  state: PipelineServerState,
  interviews: Interview[],
  options?: { failCreateWith409?: boolean },
) {
  return (request: RecordedRequest): Response | undefined => {
    const path = request.pathname.replace(/^\/api\/v1/, "");
    const collection = (data: unknown[]) =>
      jsonResponse({ data, meta: { count: data.length, nextCursor: null } });

    const listMatch = path.match(/^\/assignments\/([0-9a-f-]{36})\/interviews$/);
    if (listMatch !== null && request.method === "GET") {
      return collection(
        interviews.filter((entry) => entry.assignmentId === listMatch[1]),
      );
    }
    if (listMatch !== null && request.method === "POST") {
      if (options?.failCreateWith409 === true) {
        return errorResponse(
          "INVALID_TRANSITION",
          "Assignment is not at client_reviewing.",
          409,
        );
      }
      const assignment = state.assignments.find(
        (entry) => entry.id === listMatch[1],
      ) as AdminAssignmentRow;
      const body = request.body as {
        scheduledAt: string;
        timezone: string;
        durationMinutes?: number;
        meetingUrl?: string;
        interviewerNames?: string;
      };
      const created = makeInterview(assignment.id, {
        scheduledAt: body.scheduledAt,
        timezone: body.timezone,
        durationMinutes: body.durationMinutes ?? null,
        meetingUrl: body.meetingUrl ?? null,
        interviewerNames: body.interviewerNames ?? null,
        roundNumber:
          interviews.filter((entry) => entry.assignmentId === assignment.id)
            .length + 1,
      });
      interviews.push(created);
      assignment.stage = "interview_scheduled";
      return jsonResponse({ data: created }, 201);
    }

    const actionMatch = path.match(
      /^\/interviews\/([0-9a-f-]{36})\/(outcome|cancel)$/,
    );
    if (actionMatch !== null && request.method === "POST") {
      const interview = interviews.find(
        (entry) => entry.id === actionMatch[1],
      ) as Interview;
      const assignment = state.assignments.find(
        (entry) => entry.id === interview.assignmentId,
      ) as AdminAssignmentRow;
      if (actionMatch[2] === "cancel") {
        interview.outcome = "cancelled";
        return jsonResponse({ data: interview });
      }
      const body = request.body as { outcome: Interview["outcome"] };
      interview.outcome = body.outcome;
      interview.outcomeRecordedAt = NOW;
      if (body.outcome !== "rescheduled") assignment.stage = "interviewed";
      return jsonResponse({ data: interview });
    }

    return undefined;
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("schedule-interview dialog", () => {
  const requisition = makeRequisition();
  let mock: PipelineApiMock;
  let interviews: Interview[];

  function setUp(options?: { failCreateWith409?: boolean }) {
    const candidate = makeCandidate({
      firstName: "Maria",
      lastName: "Gonzalez",
      hasConsentToShareProfile: true,
    });
    const state = makePipelineState({
      requisition,
      candidates: [candidate],
      detailsById: { [candidate.id]: makeDetail(candidate) },
    });
    state.assignments = [
      makeAssignment({ requisition, candidate, stage: "client_reviewing" }),
    ];
    interviews = [];
    mock = installPipelineApiMock(
      state,
      interviewOverride(state, interviews, options),
    );
  }

  async function openScheduleDialog() {
    renderPipeline(requisition.id);
    const user = userEvent.setup();
    const column = await screen.findByRole("region", {
      name: "Client reviewing column",
    });
    await within(column).findByText("Maria G.");
    await user.click(
      within(column).getByRole("button", { name: "Actions for Maria G." }),
    );
    await screen.findByRole("menu");
    await user.click(
      screen.getByRole("menuitem", { name: "Schedule interview…" }),
    );
    return { user, dialog: await screen.findByRole("dialog") };
  }

  it("posts the exact body with the viewer timezone as default", async () => {
    setUp();
    const { user, dialog } = await openScheduleDialog();

    // Timezone defaults to the viewer's zone (NFR-11).
    expect(within(dialog).getByLabelText("Timezone")).toHaveValue(
      viewerTimezone(),
    );

    // Requires a date/time before posting.
    await user.click(
      within(dialog).getByRole("button", { name: "Schedule interview" }),
    );
    expect(
      within(dialog).getByText("A date and time are required."),
    ).toBeInTheDocument();
    expect(
      mock.requests.some((request) => request.pathname.endsWith("/interviews")),
    ).toBe(false);

    fireEvent.change(within(dialog).getByLabelText("Date & time"), {
      target: { value: "2026-08-20T14:30" },
    });
    await user.type(
      within(dialog).getByLabelText("Duration, minutes (optional)"),
      "45",
    );
    await user.type(
      within(dialog).getByLabelText("Meeting link (optional)"),
      "https://meet.example.com/abc",
    );
    await user.type(
      within(dialog).getByLabelText("Interviewer names (optional)"),
      "Rebecca, Sam",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Schedule interview" }),
    );

    await waitFor(() => {
      const post = mock.requests.find(
        (request) =>
          request.method === "POST" &&
          request.pathname.endsWith("/interviews"),
      );
      expect(post).toBeDefined();
      // The wall time is read in the default (viewer) zone; the conversion
      // itself is pinned zone-by-zone in the zonedWallTimeToIso suite below.
      // No roundNumber: the API assigns the next round itself.
      expect(post?.body).toEqual({
        scheduledAt: zonedWallTimeToIso("2026-08-20T14:30", viewerTimezone()),
        timezone: viewerTimezone(),
        durationMinutes: 45,
        meetingUrl: "https://meet.example.com/abc",
        interviewerNames: "Rebecca, Sam",
      });
    });

    // The card lands in Interview scheduled showing the pending round.
    const column = await screen.findByRole("region", {
      name: "Interview scheduled column",
    });
    await within(column).findByText("Maria G.");
    expect(within(column).getByText(/Round 1/)).toBeInTheDocument();
    expect(
      within(column).getByText(new RegExp(`Your timezone \\(${viewerTimezone()}\\)`)),
    ).toBeInTheDocument();
    expect(
      within(column).getByRole("link", { name: /Join meeting/ }),
    ).toHaveAttribute("href", "https://meet.example.com/abc");
  });

  it("surfaces a 409 INVALID_TRANSITION inline when the stage moved on", async () => {
    setUp({ failCreateWith409: true });
    const { user, dialog } = await openScheduleDialog();

    fireEvent.change(within(dialog).getByLabelText("Date & time"), {
      target: { value: "2026-08-20T14:30" },
    });
    await user.click(
      within(dialog).getByRole("button", { name: "Schedule interview" }),
    );

    expect(
      await within(dialog).findByText(/no longer at Client reviewing/),
    ).toBeInTheDocument();

    // Close the dialog (it aria-hides the board while open): the card did
    // not move.
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(
      within(
        await screen.findByRole("region", { name: "Client reviewing column" }),
      ).getByText("Maria G."),
    ).toBeInTheDocument();
  });
});

describe("zonedWallTimeToIso", () => {
  it("converts wall times from explicit zones to UTC instants", () => {
    expect(zonedWallTimeToIso("2026-08-20T14:30", "UTC")).toBe(
      "2026-08-20T14:30:00.000Z",
    );
    // EDT (UTC-4) in August, EST (UTC-5) in January — DST handled.
    expect(zonedWallTimeToIso("2026-08-20T14:30", "America/New_York")).toBe(
      "2026-08-20T18:30:00.000Z",
    );
    expect(zonedWallTimeToIso("2026-01-20T14:30", "America/New_York")).toBe(
      "2026-01-20T19:30:00.000Z",
    );
    // Karachi has no DST: UTC+5 year-round.
    expect(zonedWallTimeToIso("2026-08-20T14:30", "Asia/Karachi")).toBe(
      "2026-08-20T09:30:00.000Z",
    );
  });
});

describe("outcome and cancel on interview_scheduled cards", () => {
  const requisition = makeRequisition();
  let mock: PipelineApiMock;
  let interviews: Interview[];
  let pending: Interview;

  beforeEach(() => {
    const candidate = makeCandidate({
      firstName: "Maria",
      lastName: "Gonzalez",
      hasConsentToShareProfile: true,
    });
    const state = makePipelineState({
      requisition,
      candidates: [candidate],
      detailsById: { [candidate.id]: makeDetail(candidate) },
    });
    state.assignments = [
      makeAssignment({
        requisition,
        candidate,
        stage: "interview_scheduled",
      }),
    ];
    const assignment = state.assignments[0] as AdminAssignmentRow;
    pending = makeInterview(assignment.id);
    interviews = [pending];
    mock = installPipelineApiMock(state, interviewOverride(state, interviews));
  });

  async function openMenu() {
    renderPipeline(requisition.id);
    const user = userEvent.setup();
    const column = await screen.findByRole("region", {
      name: "Interview scheduled column",
    });
    await within(column).findByText("Maria G.");
    // The pending round renders on the card before acting on it.
    await within(column).findByText(/Round 1/);
    await user.click(
      within(column).getByRole("button", { name: "Actions for Maria G." }),
    );
    await screen.findByRole("menu");
    return user;
  }

  it("records `passed` with notes — exact body — and the card shows the outcome chip at Interviewed", async () => {
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Record outcome…" }));
    const dialog = await screen.findByRole("dialog");

    // Outcome is required.
    await user.click(
      within(dialog).getByRole("button", { name: "Record outcome" }),
    );
    expect(within(dialog).getByText("Choose an outcome.")).toBeInTheDocument();

    await user.click(within(dialog).getByRole("radio", { name: /Passed/ }));
    await user.type(
      within(dialog).getByLabelText("Notes (optional)"),
      "Great fit",
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Record outcome" }),
    );

    await waitFor(() => {
      const post = mock.requests.find((request) =>
        request.pathname.endsWith(`/interviews/${pending.id}/outcome`),
      );
      expect(post).toBeDefined();
      expect(post?.body).toEqual({ outcome: "passed", outcomeNotes: "Great fit" });
    });

    const column = await screen.findByRole("region", {
      name: "Interviewed column",
    });
    await within(column).findByText("Maria G.");
    expect(within(column).getByText("Round 1: Passed")).toBeInTheDocument();
  });

  it("`rescheduled` keeps the card at Interview scheduled with no outcome chip", async () => {
    const user = await openMenu();
    await user.click(screen.getByRole("menuitem", { name: "Record outcome…" }));
    const dialog = await screen.findByRole("dialog");

    await user.click(
      within(dialog).getByRole("radio", { name: /Rescheduled/ }),
    );
    await user.click(
      within(dialog).getByRole("button", { name: "Record outcome" }),
    );

    await waitFor(() => {
      const post = mock.requests.find((request) =>
        request.pathname.endsWith(`/interviews/${pending.id}/outcome`),
      );
      expect(post?.body).toEqual({ outcome: "rescheduled" });
    });

    // Stage semantics: still Interview scheduled, never an Interviewed chip.
    const column = await screen.findByRole("region", {
      name: "Interview scheduled column",
    });
    await within(column).findByText("Maria G.");
    expect(screen.queryByText(/Round 1: /)).not.toBeInTheDocument();
    expect(
      within(
        screen.getByRole("region", { name: "Interviewed column" }),
      ).queryByText("Maria G."),
    ).not.toBeInTheDocument();
  });

  it("cancels the pending round via /interviews/:id/cancel and the card stays put", async () => {
    const user = await openMenu();
    await user.click(
      screen.getByRole("menuitem", { name: "Cancel interview…" }),
    );
    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByText(/stays at Interview scheduled/),
    ).toBeInTheDocument();
    await user.click(
      within(dialog).getByRole("button", { name: "Cancel interview" }),
    );

    await waitFor(() => {
      const post = mock.requests.find((request) =>
        request.pathname.endsWith(`/interviews/${pending.id}/cancel`),
      );
      expect(post).toBeDefined();
    });
    expect(
      within(
        screen.getByRole("region", { name: "Interview scheduled column" }),
      ).getByText("Maria G."),
    ).toBeInTheDocument();
  });
});
