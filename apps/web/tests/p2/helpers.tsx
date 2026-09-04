/**
 * Shared harness for the P2 admin tests (clients + requisitions). Same
 * approach as tests/question-manager/helpers.tsx: the API is mocked at the
 * fetch layer with a tiny in-memory server, so invalidation → refetch cycles
 * observe mutations exactly like the real API. An `override` hook runs first
 * to force specific responses (409s, 422s, extra pages).
 */
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { vi } from "vitest";
import type {
  Client,
  ClientMember,
  EntityEvent,
  Requisition,
  RequisitionAnswer,
  RequisitionDetail,
} from "@sdb/contracts";
import { ClientDetailPage, ClientsListPage } from "@/features/clients";
import {
  RequisitionDetailPage,
  RequisitionsListPage,
} from "@/features/requisitions";

/**
 * jsdom supplies its own AbortController, whose signals Node's undici
 * Request rejects ("Expected signal to be an instance of AbortSignal").
 * React Router's data router constructs such Requests on every navigation
 * (setSearchParams included). Retry without the signal on that mismatch —
 * nothing in these tests aborts navigations.
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

let uuidCounter = 0;

/** Deterministic valid v4-shaped uuid for fixtures. */
export function testUuid(): string {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
}

/** Deterministic 12-char base62 public id (contracts PublicIdSchema). */
export function testPublicId(): string {
  return `Pub${String(uuidCounter).padStart(9, "0")}`;
}

export const NOW = "2026-08-12T09:00:00+00:00";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function makeClient(
  overrides: Partial<Client> & Pick<Client, "companyName">,
): Client {
  return {
    id: testUuid(),
    publicId: testPublicId(),
    website: null,
    industry: null,
    teamSizeBand: null,
    companyTimezone: null,
    status: "prospect",
    serviceTier: null,
    paymentConfirmedAt: null,
    invoiceReference: null,
    portalAccessEnabledAt: null,
    portalAccessEnabledBy: null,
    onboardingReadinessNote: null,
    internalNotes: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    ...overrides,
  };
}

export function makeMember(
  overrides: Partial<ClientMember> &
    Pick<ClientMember, "clientId" | "fullName" | "email">,
): ClientMember {
  return {
    id: testUuid(),
    userId: testUuid(),
    jobTitle: null,
    role: "client_user",
    isPrimaryContact: false,
    isPrincipal: false,
    isActive: true,
    invitedAt: NOW,
    acceptedAt: null,
    createdAt: NOW,
    ...overrides,
  };
}

/** List item WITHOUT commercial keys — the AC-RQ-06 "scoped caller" shape. */
export function makeRequisition(
  overrides: Partial<Requisition> &
    Pick<Requisition, "clientId" | "clientName">,
): Requisition {
  return {
    id: testUuid(),
    publicId: testPublicId(),
    reference: `REQ-${String(uuidCounter).padStart(6, "0")}`,
    engineId: null,
    departmentId: null,
    roleCategoryId: null,
    advertisedTitle: "Executive Assistant",
    headcount: 1,
    status: "submitted",
    seniorityLevel: null,
    engagementType: null,
    hoursPerWeek: null,
    startsPartTime: null,
    fullTimeTransitionAfter: null,
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
    ...overrides,
  };
}

/** The commercial keys, present — the admin caller shape. */
export function withCommercials(
  requisition: Requisition,
  overrides?: Partial<Requisition>,
): Requisition {
  return {
    ...requisition,
    budgetMin: 1500,
    budgetMax: 2500,
    budgetUnit: "monthly",
    budgetCurrency: "USD",
    budgetIsFlexible: false,
    serviceTier: "standard_placement",
    ...overrides,
  };
}

export function makeAnswer(
  overrides: Partial<RequisitionAnswer> &
    Pick<RequisitionAnswer, "questionKey" | "label"> & {
      questionSnapshot: Record<string, unknown>;
    },
): RequisitionAnswer {
  return {
    id: testUuid(),
    questionId: testUuid(),
    questionType: "short_text",
    valueText: null,
    valueNumber: null,
    valueBoolean: null,
    valueDate: null,
    valueJson: null,
    selectedOptions: [],
    answeredBy: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeDetail(
  requisition: Requisition,
  overrides?: Partial<RequisitionDetail>,
): RequisitionDetail {
  return {
    ...requisition,
    regionPreference: null,
    briefMarkdown: null,
    jobDescription: null,
    roleDescription: null,
    principalChangeRequest: null,
    intakeContactName: null,
    intakeContactEmail: null,
    taxonomy: { engine: null, department: null, roleCategory: null },
    placement: null,
    answers: [],
    countsByStage: {},
    ...overrides,
  };
}

export function makeEvent(
  overrides: Partial<EntityEvent> & Pick<EntityEvent, "entityId">,
): EntityEvent {
  return {
    id: testUuid(),
    entityType: "requisition",
    eventType: "status_changed",
    actorId: testUuid(),
    actorName: null,
    actorRole: "admin",
    fromValue: null,
    toValue: null,
    metadata: {},
    occurredAt: NOW,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Fetch mock
// ---------------------------------------------------------------------------

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): Response {
  return jsonResponse(
    { error: { code, message, requestId: "req-test-1", details } },
    status,
  );
}

export interface RecordedRequest {
  method: string;
  pathname: string;
  search: URLSearchParams;
  body: unknown;
}

export type Override = (
  request: RecordedRequest,
) => Response | Promise<Response> | undefined;

/** Mutable in-memory server state shared with the fetch mock. */
export interface ServerState {
  clients: Client[];
  membersByClientId: Record<string, ClientMember[]>;
  requisitions: Requisition[];
  detailsById: Record<string, RequisitionDetail>;
  eventsByRequisitionId: Record<string, EntityEvent[]>;
}

export function makeState(partial?: Partial<ServerState>): ServerState {
  return {
    clients: [],
    membersByClientId: {},
    requisitions: [],
    detailsById: {},
    eventsByRequisitionId: {},
    ...partial,
  };
}

export interface ApiMock {
  requests: RecordedRequest[];
  state: ServerState;
}

const UUID = "[0-9a-f-]{36}";
/** Single-entity routes accept a UUID OR a 12-char public id, like the API. */
const ENTITY_REF = "[0-9A-Za-z]{12}|[0-9a-f-]{36}";

export function installApiMock(
  state: ServerState,
  override?: Override,
): ApiMock {
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

      const custom = override?.(recorded);
      if (custom !== undefined) return custom;

      const collection = (data: unknown[]) =>
        jsonResponse({ data, meta: { count: data.length, nextCursor: null } });
      const path = url.pathname.replace(/^\/api\/v1/, "");

      // ----- Auth (permission gates, e.g. the New-client button) -----
      if (method === "GET" && path === "/auth/me") {
        return jsonResponse({
          data: {
            user: {
              id: "00000000-0000-4000-8000-999999999999",
              email: "admin@sdb.test",
              fullName: "Alex Admin",
              phone: null,
              avatarPath: null,
              timezone: "UTC",
              isActive: true,
              lastLoginAt: null,
            },
            roles: ["super_admin"],
            permissions: [
              "client.view",
              "client.create",
              "client.update",
              "requisition.view",
              "event.view",
              "settings.manage",
            ],
            clientId: null,
          },
        });
      }

      // ----- Global event log (client detail right rail) -----
      if (method === "GET" && path === "/events") {
        return collection([]);
      }

      // ----- Clients -----
      if (method === "GET" && path === "/clients") {
        return collection(state.clients);
      }

      const memberAction = path.match(
        new RegExp(`^/clients/(${UUID})/members(?:/(invite|${UUID}))?$`),
      );
      if (memberAction !== null) {
        const [, clientId = "", action] = memberAction;
        const members = state.membersByClientId[clientId] ?? [];
        if (method === "GET" && action === undefined) {
          return collection(members);
        }
        if (method === "POST" && action === "invite") {
          const payload = body as {
            email: string;
            fullName: string;
            jobTitle?: string;
            role: ClientMember["role"];
            isPrincipal?: boolean;
          };
          const created = makeMember({
            clientId,
            email: payload.email,
            fullName: payload.fullName,
            jobTitle: payload.jobTitle ?? null,
            role: payload.role,
            isPrincipal: payload.isPrincipal ?? false,
          });
          state.membersByClientId[clientId] = [...members, created];
          return jsonResponse({ data: created }, 201);
        }
        if (action !== undefined && action !== "invite") {
          const member = members.find((entry) => entry.userId === action);
          if (member === undefined) {
            return errorResponse("NOT_FOUND", "Member not found.", 404);
          }
          if (method === "PATCH") {
            Object.assign(member, body);
            return jsonResponse({ data: member });
          }
          if (method === "DELETE") {
            state.membersByClientId[clientId] = members.filter(
              (entry) => entry.userId !== action,
            );
            return new Response(null, { status: 204 });
          }
        }
      }

      const clientAction = path.match(
        new RegExp(
          `^/clients/(${ENTITY_REF})(?:/(confirm-payment|grant-access|revoke-access))?$`,
        ),
      );
      if (clientAction !== null) {
        const [, id = "", action] = clientAction;
        const client = state.clients.find(
          (entry) => entry.id === id || entry.publicId === id,
        );
        if (client === undefined) {
          return errorResponse("NOT_FOUND", "Client not found.", 404);
        }
        if (method === "GET" && action === undefined) {
          return jsonResponse({ data: client });
        }
        if (method === "PATCH" && action === undefined) {
          Object.assign(client, body);
          return jsonResponse({ data: client });
        }
        if (method === "POST" && action === "confirm-payment") {
          const payload = body as {
            paymentConfirmedAt: string;
            invoiceReference?: string;
            serviceTier: Client["serviceTier"];
          };
          client.paymentConfirmedAt = payload.paymentConfirmedAt;
          client.invoiceReference = payload.invoiceReference ?? null;
          client.serviceTier = payload.serviceTier;
          return jsonResponse({ data: client });
        }
        if (method === "POST" && action === "grant-access") {
          if (client.paymentConfirmedAt === null) {
            return errorResponse(
              "PAYMENT_NOT_CONFIRMED",
              "Portal access cannot be granted before payment is confirmed.",
              422,
            );
          }
          client.portalAccessEnabledAt = NOW;
          client.status = "active";
          const payload = body as {
            primaryContactEmail: string;
            primaryContactName: string;
            isPrincipal: boolean;
          };
          const created = makeMember({
            clientId: client.id,
            email: payload.primaryContactEmail,
            fullName: payload.primaryContactName,
            role: "client_admin",
            isPrimaryContact: true,
            isPrincipal: payload.isPrincipal,
          });
          state.membersByClientId[client.id] = [
            ...(state.membersByClientId[client.id] ?? []),
            created,
          ];
          return jsonResponse({ data: client });
        }
        if (method === "POST" && action === "revoke-access") {
          client.portalAccessEnabledAt = null;
          const deactivated = (state.membersByClientId[client.id] ?? []).map(
            (member) => member.userId,
          );
          return jsonResponse({
            data: { revoked: true, deactivatedUserIds: deactivated },
          });
        }
      }

      // ----- Requisitions -----
      if (method === "GET" && path === "/requisitions") {
        const clientId = url.searchParams.get("clientId");
        const data =
          clientId === null
            ? state.requisitions
            : state.requisitions.filter(
                (requisition) => requisition.clientId === clientId,
              );
        return collection(data);
      }

      const requisitionAction = path.match(
        new RegExp(
          `^/requisitions/(${ENTITY_REF})(?:/(transition|request-principal-approval|events))?$`,
        ),
      );
      if (requisitionAction !== null) {
        const [, id = "", action] = requisitionAction;
        const detail =
          state.detailsById[id] ??
          Object.values(state.detailsById).find(
            (entry) => entry.publicId === id,
          );
        if (detail === undefined) {
          return errorResponse("NOT_FOUND", "Requisition not found.", 404);
        }
        if (method === "GET" && action === undefined) {
          return jsonResponse({ data: detail });
        }
        if (method === "GET" && action === "events") {
          return collection(state.eventsByRequisitionId[detail.id] ?? []);
        }
        if (method === "PATCH" && action === undefined) {
          Object.assign(detail, body);
          return jsonResponse({ data: detail });
        }
        if (method === "POST" && action === "transition") {
          const payload = body as { toStatus: RequisitionDetail["status"] };
          detail.status = payload.toStatus;
          return jsonResponse({ data: detail });
        }
        if (method === "POST" && action === "request-principal-approval") {
          detail.status = "pending_principal_approval";
          return jsonResponse({ data: detail });
        }
      }

      throw new Error(`Unhandled request: ${method} ${url.pathname}`);
    }),
  );

  return { requests, state };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

/** Mount the real admin P2 routes in a memory router at `initialPath`. */
export function renderAdmin(initialPath: string): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: "/admin/clients", element: <ClientsListPage /> },
      { path: "/admin/clients/:id", element: <ClientDetailPage /> },
      { path: "/admin/requisitions", element: <RequisitionsListPage /> },
      { path: "/admin/requisitions/:id", element: <RequisitionDetailPage /> },
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
