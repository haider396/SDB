/**
 * Shared harness for the P4 pipeline tests — same approach as tests/p3:
 * fetch-layer mock with a tiny in-memory server (mutations mutate state so
 * invalidation → refetch observes them), an `override` hook for forcing
 * specific responses, and fixtures for assignments + requisition detail.
 * Candidate fixtures are reused from tests/p3/helpers.
 */
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { vi } from "vitest";
import type {
  AdminAssignmentRow,
  AssignmentStage,
  Candidate,
  CandidateDetail,
  RequisitionDetail,
} from "@sdb/contracts";
import { RequisitionDetailPage } from "@/features/requisitions";
import {
  NOW,
  jsonResponse,
  errorResponse,
  makeCandidate,
  makeDetail,
  makeFile,
  testPublicId,
  testUuid,
  type Override,
  type RecordedRequest,
} from "../p3/helpers";
import type { CandidateFile } from "@sdb/contracts";

export {
  NOW,
  jsonResponse,
  errorResponse,
  makeCandidate,
  makeDetail,
  testPublicId,
  testUuid,
};
export type { Override, RecordedRequest };

/** Candidate file with an explicit client-visibility flag. */
export function makeFileDetail(
  candidateId: string,
  originalFilename: string,
  isClientVisible: boolean,
): CandidateFile {
  return makeFile({ candidateId, originalFilename, isClientVisible });
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function makeRequisition(
  overrides?: Partial<RequisitionDetail>,
): RequisitionDetail {
  const id = testUuid();
  return {
    id,
    publicId: testPublicId(),
    reference: "REQ-000101",
    clientId: testUuid(),
    clientName: "Acme Corp",
    engineId: null,
    departmentId: null,
    roleCategoryId: null,
    advertisedTitle: "Executive Assistant",
    headcount: 1,
    status: "sourcing",
    seniorityLevel: null,
    engagementType: null,
    hoursPerWeek: null,
    overlapStart: null,
    overlapEnd: null,
    overlapTimezone: null,
    targetStartDate: null,
    urgency: null,
    principalUserId: null,
    principalApprovedAt: null,
    submittedAt: NOW,
    sourcingStartedAt: null,
    closedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    regionPreference: null,
    briefMarkdown: null,
    principalChangeRequest: null,
    intakeContactName: null,
    intakeContactEmail: null,
    taxonomy: { engine: null, department: null, roleCategory: null },
    answers: [],
    countsByStage: {},
    ...overrides,
  };
}

export interface MakeAssignmentArgs {
  requisition: RequisitionDetail;
  candidate: Candidate;
  stage: AssignmentStage;
  overrides?: Partial<AdminAssignmentRow>;
}

export function makeAssignment({
  requisition,
  candidate,
  stage,
  overrides,
}: MakeAssignmentArgs): AdminAssignmentRow {
  return {
    id: testUuid(),
    requisitionId: requisition.id,
    candidateId: candidate.id,
    stage,
    presentedAt: null,
    clientDecisionAt: null,
    assignedBy: testUuid(),
    presentedBy: null,
    adminNote: null,
    clientNote: null,
    sortOrder: 0,
    createdAt: NOW,
    updatedAt: NOW,
    requisitionReference: requisition.reference,
    clientId: requisition.clientId,
    candidate: {
      id: candidate.id,
      publicId: candidate.publicId,
      reference: candidate.reference,
      photoPath: null,
      photoUrl: null,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
      displayName: candidate.displayName,
      email: candidate.email,
      currentTitle: candidate.currentTitle,
      country: candidate.country,
      seniorityLevel: candidate.seniorityLevel,
      vettingStatus: candidate.vettingStatus,
      recruiterRating: candidate.recruiterRating,
      poolStatus: candidate.poolStatus,
      dataCompleteness: candidate.dataCompleteness,
      hasConsentToShareProfile: candidate.hasConsentToShareProfile,
    },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fetch mock
// ---------------------------------------------------------------------------

export interface PipelineServerState {
  requisition: RequisitionDetail;
  assignments: AdminAssignmentRow[];
  /** Pool candidates served by GET /candidates (the add picker). */
  candidates: Candidate[];
  /** Details served by GET /candidates/:id (card + review hydration). */
  detailsById: Record<string, CandidateDetail>;
}

export function makePipelineState(
  partial: Pick<PipelineServerState, "requisition"> &
    Partial<PipelineServerState>,
): PipelineServerState {
  return {
    assignments: [],
    candidates: [],
    detailsById: {},
    ...partial,
  };
}

export interface PipelineApiMock {
  requests: RecordedRequest[];
  state: PipelineServerState;
}

const UUID = "[0-9a-f-]{36}";

export function installPipelineApiMock(
  state: PipelineServerState,
  override?: Override,
): PipelineApiMock {
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

      const collection = (data: unknown[]) =>
        jsonResponse({ data, meta: { count: data.length, nextCursor: null } });
      const path = url.pathname.replace(/^\/api\/v1/, "");

      // ----- requisition detail + events -----
      if (method === "GET" && path === `/requisitions/${state.requisition.id}`) {
        return jsonResponse({ data: state.requisition });
      }
      if (
        method === "GET" &&
        path === `/requisitions/${state.requisition.id}/events`
      ) {
        return collection([]);
      }

      // ----- assignments listing + creation -----
      if (path === `/requisitions/${state.requisition.id}/assignments`) {
        if (method === "GET") return collection(state.assignments);
        if (method === "POST") {
          const payload = body as { candidateIds: string[] };
          const created = payload.candidateIds.map((candidateId) => {
            const candidate = state.candidates.find(
              (entry) => entry.id === candidateId,
            );
            if (candidate === undefined) {
              throw new Error(`Unknown candidate ${candidateId}`);
            }
            return makeAssignment({
              requisition: state.requisition,
              candidate,
              stage: "sourced",
            });
          });
          state.assignments = [...state.assignments, ...created];
          return jsonResponse(
            { data: created, meta: { count: created.length, nextCursor: null } },
            201,
          );
        }
      }

      // ----- bulk present -----
      if (method === "POST" && path === "/assignments/present") {
        const payload = body as { assignmentIds: string[] };
        const updated: AdminAssignmentRow[] = [];
        for (const assignment of state.assignments) {
          if (payload.assignmentIds.includes(assignment.id)) {
            assignment.stage = "presented";
            assignment.presentedAt = NOW;
            updated.push(assignment);
          }
        }
        return collection(updated);
      }

      // ----- single-assignment actions -----
      const assignmentAction = path.match(
        new RegExp(`^/assignments/(${UUID})(?:/(advance|reject|place|events))?$`),
      );
      if (assignmentAction !== null) {
        const [, assignmentId = "", action] = assignmentAction;
        const assignment = state.assignments.find(
          (entry) => entry.id === assignmentId,
        );
        if (assignment === undefined) {
          return errorResponse("NOT_FOUND", "Assignment not found.", 404);
        }
        if (method === "GET" && action === "events") return collection([]);
        if (method === "GET" && action === undefined) {
          return jsonResponse({ data: assignment });
        }
        if (method === "PATCH" && action === undefined) {
          Object.assign(assignment, body);
          return jsonResponse({ data: assignment });
        }
        if (method === "POST" && action === "advance") {
          const payload = body as { toStage: AssignmentStage };
          assignment.stage = payload.toStage;
          assignment.updatedAt = NOW;
          return jsonResponse({ data: assignment });
        }
        if (method === "POST" && action === "reject") {
          assignment.stage = "rejected_by_admin";
          return jsonResponse({ data: assignment });
        }
        if (method === "POST" && action === "place") {
          assignment.stage = "placed";
          for (const sibling of state.assignments) {
            if (sibling.id !== assignment.id && sibling.stage !== "placed") {
              sibling.stage = "closed_not_selected";
            }
          }
          state.requisition = { ...state.requisition, status: "placed" };
          return jsonResponse(
            {
              data: {
                id: testUuid(),
                assignmentId: assignment.id,
                candidateId: assignment.candidateId,
                clientId: state.requisition.clientId,
                requisitionId: state.requisition.id,
                startDate: (body as { startDate: string }).startDate,
                endDate: null,
                rateAmount: null,
                rateUnit: null,
                rateCurrency: null,
                hoursPerWeek: null,
                serviceTier: null,
                guaranteeEndDate: null,
                status: "active",
                createdAt: NOW,
                updatedAt: NOW,
              },
            },
            201,
          );
        }
      }

      // ----- candidates (picker + detail hydration) -----
      if (method === "GET" && path === "/candidates") {
        return collection(state.candidates);
      }
      const candidateDetail = path.match(new RegExp(`^/candidates/(${UUID})$`));
      if (candidateDetail !== null && method === "GET") {
        const detail = state.detailsById[candidateDetail[1] ?? ""];
        if (detail === undefined) {
          return errorResponse("NOT_FOUND", "Candidate not found.", 404);
        }
        return jsonResponse({ data: detail });
      }

      throw new Error(`Unhandled request: ${method} ${url.pathname}`);
    }),
  );

  return { requests, state };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderPipeline(
  requisitionId: string,
): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: "/admin/requisitions/:id", element: <RequisitionDetailPage /> },
      { path: "/admin/candidates/:id", element: <div>Candidate page</div> },
    ],
    {
      initialEntries: [`/admin/requisitions/${requisitionId}?tab=pipeline`],
    },
  );
  const ui: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  );
  return render(ui);
}
