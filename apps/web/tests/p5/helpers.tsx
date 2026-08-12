/**
 * Shared harness for the P5 client-portal tests — same approach as
 * tests/p4: fetch-layer mock with a tiny in-memory server (mutations mutate
 * state so invalidation → refetch observes them), an `override` hook for
 * forcing specific responses, and fixtures for the client-visible shapes.
 *
 * Auth: pages here sit behind useMe()/useSession(). Each TEST FILE mocks
 * "@/lib/auth" (vi.mock is hoisted per file — see mockAuthModule() docs);
 * the fetch mock then serves GET /auth/me from state.
 */
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { vi } from "vitest";
import type {
  AuthMeResponse,
  Client,
  ClientDashboard,
  ClientVisibleAssignment,
  Interview,
  IntakeFormResponse,
  RejectionReason,
  Requisition,
  RequisitionDetail,
} from "@sdb/contracts";
import { RequireClientContext } from "@/components/guards/require-client-context";
import {
  ClientDashboardPage,
  ClientRequisitionDetailPage,
  ClientRequisitionNewPage,
  ClientRequisitionsPage,
} from "@/features/client-portal";
import {
  NOW,
  jsonResponse,
  errorResponse,
  makeRequisition,
  testUuid,
  type Override,
  type RecordedRequest,
} from "../p4/helpers";

export {
  NOW,
  jsonResponse,
  errorResponse,
  makeRequisition,
  testUuid,
};
export type { Override, RecordedRequest };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function makeMe(overrides?: Partial<AuthMeResponse>): AuthMeResponse {
  return {
    user: {
      id: testUuid(),
      email: "casey@acme.test",
      fullName: "Casey Client",
      phone: null,
      avatarPath: null,
      timezone: "America/New_York",
      isActive: true,
      lastLoginAt: null,
    },
    roles: ["client_admin"],
    permissions: [
      "client.view",
      "requisition.view",
      "requisition.create",
      "assignment.view",
      "interview.view",
    ],
    clientId: testUuid(),
    ...overrides,
  };
}

export function makeClientRecord(
  id: string,
  overrides?: Partial<Client>,
): Client {
  return {
    id,
    companyName: "Acme Corp",
    website: "https://acme.test",
    industry: null,
    teamSizeBand: null,
    companyTimezone: null,
    status: "active",
    serviceTier: null,
    paymentConfirmedAt: null,
    invoiceReference: null,
    portalAccessEnabledAt: NOW,
    portalAccessEnabledBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    ...overrides,
  };
}

export function makeDashboard(
  overrides?: Partial<ClientDashboard>,
): ClientDashboard {
  return {
    requisitions: [],
    pendingActions: { principalApprovals: [], candidatesAwaitingReview: [] },
    recentEvents: [],
    ...overrides,
  };
}

/** A client-visible assignment row: gated PII null (presented) by default. */
export function makeClientAssignment(
  overrides: Partial<ClientVisibleAssignment> &
    Pick<ClientVisibleAssignment, "requisitionId">,
): ClientVisibleAssignment {
  return {
    assignmentId: testUuid(),
    stage: "presented",
    presentedAt: NOW,
    clientNote: null,
    clientId: testUuid(),
    candidateId: testUuid(),
    reference: "CAN-000001",
    displayName: "Maria G.",
    photoPath: null,
    country: "Philippines",
    regionState: null,
    city: "Manila",
    timezone: "Asia/Manila",
    englishSpokenLevel: "professional",
    englishWrittenLevel: "native_equivalent",
    accentStrength: "light",
    yearsExperienceTotal: 7,
    yearsExperienceRelevant: 5,
    currentTitle: "Executive Assistant",
    seniorityLevel: "senior",
    hasManagementExperience: null,
    teamSizeManaged: null,
    hasClientFacingExperience: null,
    hasUsClientExperience: null,
    remoteExperienceYears: null,
    availableFrom: null,
    engagementTypes: ["full_time"],
    hoursAvailablePerWeek: 40,
    overlapStart: "13:00",
    overlapEnd: "17:00",
    overlapTimezone: "ET",
    autonomy: "fully_autonomous",
    canManageUp: true,
    recruiterRecommendation: "A superb operator — present first.",
    strengths: "Calendar mastery, investor comms.",
    firstName: null,
    lastName: null,
    email: null,
    phone: null,
    whatsapp: null,
    linkedinUrl: null,
    currentEmployer: null,
    files: [],
    ...overrides,
  };
}

/** The same row after the PII gate opened (interview_scheduled or later). */
export function withUnlockedPii(
  row: ClientVisibleAssignment,
  overrides?: Partial<ClientVisibleAssignment>,
): ClientVisibleAssignment {
  return {
    ...row,
    stage: "interview_scheduled",
    firstName: "Maria",
    lastName: "Gonzales",
    email: "maria@example.test",
    phone: "+63 900 123 4567",
    whatsapp: "+63 900 123 4567",
    linkedinUrl: "https://linkedin.example/in/maria",
    currentEmployer: "Legacy BPO Inc",
    ...overrides,
  };
}

export function makeInterview(
  assignmentId: string,
  overrides?: Partial<Interview>,
): Interview {
  return {
    id: testUuid(),
    assignmentId,
    roundNumber: 1,
    scheduledAt: "2026-08-20T15:00:00+00:00",
    timezone: "America/New_York",
    durationMinutes: 45,
    meetingUrl: "https://meet.example/sdb-round-1",
    interviewerNames: "Casey Client, Robin Ops",
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

/** Stable id so tests can assert exact reasonId bodies. */
export const SKILLS_GAP_REASON_ID = "00000000-0000-4000-8000-00000000a001";

export function makeClientRejectionReasons(): RejectionReason[] {
  return [
    {
      id: SKILLS_GAP_REASON_ID,
      key: "skills_gap",
      label: "Skills gap",
      actor: "client",
      sortOrder: 1,
      isActive: true,
    },
    {
      id: "00000000-0000-4000-8000-00000000a009",
      key: "other_client",
      label: "Other",
      actor: "client",
      sortOrder: 9,
      isActive: true,
    },
  ];
}

// ---------------------------------------------------------------------------
// Fetch mock
// ---------------------------------------------------------------------------

export interface ClientPortalServerState {
  me: AuthMeResponse;
  dashboard: ClientDashboard;
  /** Served by GET /requisitions (the client's implicit scope). */
  requisitions: Requisition[];
  /** Served by GET /requisitions/:id when the id matches. */
  requisitionDetail: RequisitionDetail | null;
  assignmentsByRequisitionId: Record<string, ClientVisibleAssignment[]>;
  interviewsByAssignmentId: Record<string, Interview[]>;
  /** Served by GET /clients/:id (in-portal intake prefill). */
  client: Client | null;
  /** Served by GET /taxonomy/public and /intake-form (in-portal intake). */
  taxonomy: unknown;
  intakeForm: IntakeFormResponse | null;
  /** Served by GET /rejection-reasons (actor filter applied). */
  rejectionReasons: RejectionReason[];
}

export function makeState(
  partial?: Partial<ClientPortalServerState> & { me?: AuthMeResponse },
): ClientPortalServerState {
  return {
    me: makeMe(),
    dashboard: makeDashboard(),
    requisitions: [],
    requisitionDetail: null,
    assignmentsByRequisitionId: {},
    interviewsByAssignmentId: {},
    client: null,
    taxonomy: { engines: [] },
    intakeForm: null,
    rejectionReasons: makeClientRejectionReasons(),
    ...partial,
  };
}

export interface ClientPortalApiMock {
  requests: RecordedRequest[];
  state: ClientPortalServerState;
}

const UUID = "[0-9a-f-]{36}";

export function installClientPortalApiMock(
  state: ClientPortalServerState,
  override?: Override,
): ClientPortalApiMock {
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

      // ----- auth -----
      if (method === "GET" && path === "/auth/me") {
        return jsonResponse({ data: state.me });
      }

      // ----- dashboard -----
      if (method === "GET" && path === "/client/dashboard") {
        return jsonResponse({ data: state.dashboard });
      }

      // ----- requisitions -----
      if (path === "/requisitions") {
        if (method === "GET") return collection(state.requisitions);
        if (method === "POST") {
          return jsonResponse(
            { data: { id: testUuid(), requisitionReference: "REQ-000777" } },
            201,
          );
        }
      }
      const requisitionAction = path.match(
        new RegExp(
          `^/requisitions/(${UUID})(?:/(assignments|events|principal-approve|principal-request-changes))?$`,
        ),
      );
      if (requisitionAction !== null) {
        const [, requisitionId = "", action] = requisitionAction;
        if (method === "GET" && action === "assignments") {
          return collection(state.assignmentsByRequisitionId[requisitionId] ?? []);
        }
        if (method === "GET" && action === "events") return collection([]);
        const detail = state.requisitionDetail;
        if (detail === null || detail.id !== requisitionId) {
          return errorResponse("NOT_FOUND", "Requisition not found.", 404);
        }
        if (method === "GET" && action === undefined) {
          return jsonResponse({ data: detail });
        }
        if (method === "POST" && action === "principal-approve") {
          state.requisitionDetail = {
            ...detail,
            status: "sourcing",
            principalApprovedAt: NOW,
          };
          return jsonResponse({ data: state.requisitionDetail });
        }
        if (method === "POST" && action === "principal-request-changes") {
          const payload = body as { comment?: string };
          if (payload.comment === undefined || payload.comment === "") {
            return errorResponse("VALIDATION_FAILED", "Comment required.", 422);
          }
          state.requisitionDetail = {
            ...detail,
            status: "changes_requested",
            principalChangeRequest: payload.comment,
          };
          return jsonResponse({ data: state.requisitionDetail });
        }
      }

      // ----- assignment decisions + interviews -----
      const assignmentAction = path.match(
        new RegExp(
          `^/assignments/(${UUID})/(approve-for-interview|reject|request-interview|interviews)$`,
        ),
      );
      if (assignmentAction !== null) {
        const [, assignmentId = "", action] = assignmentAction;
        if (method === "GET" && action === "interviews") {
          return collection(state.interviewsByAssignmentId[assignmentId] ?? []);
        }
        const rows = Object.values(state.assignmentsByRequisitionId).flat();
        const row = rows.find((entry) => entry.assignmentId === assignmentId);
        if (row === undefined) {
          return errorResponse("NOT_FOUND", "Assignment not found.", 404);
        }
        if (method === "POST" && action === "approve-for-interview") {
          row.stage = "client_reviewing";
          return jsonResponse({ data: row });
        }
        if (method === "POST" && action === "reject") {
          row.stage = "rejected_by_client";
          return jsonResponse({ data: { id: row.assignmentId } });
        }
        if (method === "POST" && action === "request-interview") {
          return jsonResponse({ data: row });
        }
      }

      // ----- rejection reasons taxonomy -----
      if (method === "GET" && path === "/rejection-reasons") {
        const actor = url.searchParams.get("actor");
        return collection(
          state.rejectionReasons.filter(
            (reason) => actor === null || reason.actor === actor,
          ),
        );
      }

      // ----- files -----
      const fileAction = path.match(
        new RegExp(`^/files/(${UUID})/download-url$`),
      );
      if (fileAction !== null && method === "GET") {
        return jsonResponse({
          data: {
            url: `https://signed.example/${fileAction[1]}`,
            expiresInSeconds: 300,
          },
        });
      }

      // ----- in-portal intake -----
      if (method === "GET" && path === "/clients/" + (state.client?.id ?? "")) {
        return jsonResponse({ data: state.client });
      }
      if (method === "GET" && path === "/taxonomy/public") {
        return jsonResponse({ data: state.taxonomy });
      }
      if (method === "GET" && path === "/intake-form") {
        if (state.intakeForm === null) {
          return errorResponse("NOT_FOUND", "No form configured.", 404);
        }
        return jsonResponse({ data: state.intakeForm });
      }

      throw new Error(`Unhandled request: ${method} ${url.pathname}`);
    }),
  );

  return { requests, state };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderClientPortal(
  initialPath: string,
): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: "/client", element: <ClientDashboardPage /> },
      { path: "/client/requisitions", element: <ClientRequisitionsPage /> },
      {
        path: "/client/requisitions/new",
        element: (
          <RequireClientContext>
            <ClientRequisitionNewPage />
          </RequireClientContext>
        ),
      },
      {
        path: "/client/requisitions/:id",
        element: <ClientRequisitionDetailPage />,
      },
    ],
    { initialEntries: [initialPath] },
  );
  const ui: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  );
  return render(ui);
}
