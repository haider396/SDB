/**
 * Shared harness for the P6 admin-dashboard tests — same approach as
 * tests/p4: fetch-layer mock with recorded requests, an `override` hook for
 * forcing specific responses, and fixtures for the attention queue, stats,
 * and the rejection-reasons report.
 */
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { vi } from "vitest";
import type {
  AdminStats,
  AttentionQueue,
  AttentionQueueBucket,
  AttentionQueueBucketKey,
  AttentionQueueItem,
  RejectionReasonRow,
  RejectionReasonsReport,
  RoleCategory,
} from "@sdb/contracts";
import { ATTENTION_QUEUE_BUCKET_KEYS } from "@sdb/contracts";
import {
  AttentionQueuePage,
  RejectionReasonsReportPage,
  StatsPage,
} from "@/features/admin-dashboard";
import { BUCKET_LABELS } from "@/features/admin-dashboard/labels";
import {
  NOW,
  errorResponse,
  jsonResponse,
  testUuid,
  type Override,
  type RecordedRequest,
} from "../p3/helpers";

export { NOW, errorResponse, jsonResponse, testUuid };
export type { Override, RecordedRequest };

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export function makeQueueItem(
  entityType: AttentionQueueItem["entityType"],
  overrides?: Partial<AttentionQueueItem>,
): AttentionQueueItem {
  return {
    entityType,
    entityId: testUuid(),
    reference: "REQ-000101",
    label: "REQ-000101 — Executive Assistant",
    since: "2026-08-09T09:00:00+00:00",
    ...overrides,
  };
}

/** All seven buckets in contract order; `items` fills selected buckets. */
export function makeQueue(
  items?: Partial<Record<AttentionQueueBucketKey, AttentionQueueItem[]>>,
): AttentionQueue {
  const buckets: AttentionQueueBucket[] = ATTENTION_QUEUE_BUCKET_KEYS.map(
    (key) => {
      const bucketItems = items?.[key] ?? [];
      return {
        key,
        label: BUCKET_LABELS[key],
        count: bucketItems.length,
        items: bucketItems,
      };
    },
  );
  return { computedAt: NOW, buckets };
}

export function makeStats(overrides?: Partial<AdminStats>): AdminStats {
  return {
    openRequisitions: 4,
    candidatesByStage: {},
    averageDaysToPresent: null,
    activePlacements: 2,
    placementsByGuaranteeWindow: { d30: 0, d60: 0, d90: 0, elapsed: 0 },
    ...overrides,
  };
}

export function makeReportRow(
  overrides: Partial<RejectionReasonRow> &
    Pick<RejectionReasonRow, "actor" | "reasonKey" | "label" | "count">,
): RejectionReasonRow {
  return {
    reasonId: testUuid(),
    otherTexts: [],
    ...overrides,
  };
}

export function makeReport(
  rows: RejectionReasonRow[],
  overrides?: Partial<RejectionReasonsReport>,
): RejectionReasonsReport {
  return {
    from: "2026-05-14T00:00:00.000Z",
    to: "2026-08-12T23:59:59.999Z",
    actor: null,
    roleCategoryId: null,
    totalCount: rows.reduce((sum, row) => sum + row.count, 0),
    rows,
    ...overrides,
  };
}

export function makeRoleCategory(label: string): RoleCategory {
  return {
    id: testUuid(),
    departmentId: testUuid(),
    key: label.toLowerCase().replace(/\W+/g, "_"),
    label,
    advertisedTitle: null,
    description: null,
    sortOrder: 0,
    isActive: true,
  };
}

// ---------------------------------------------------------------------------
// Fetch mock
// ---------------------------------------------------------------------------

export interface DashboardServerState {
  queue: AttentionQueue;
  stats: AdminStats;
  report: RejectionReasonsReport;
  roleCategories: RoleCategory[];
}

export function makeDashboardState(
  partial?: Partial<DashboardServerState>,
): DashboardServerState {
  return {
    queue: makeQueue(),
    stats: makeStats(),
    report: makeReport([]),
    roleCategories: [],
    ...partial,
  };
}

export interface DashboardApiMock {
  requests: RecordedRequest[];
  state: DashboardServerState;
}

export function installDashboardApiMock(
  state: DashboardServerState,
  override?: Override,
): DashboardApiMock {
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

      if (method === "GET" && path === "/admin/attention-queue") {
        return jsonResponse({ data: state.queue });
      }
      if (method === "GET" && path === "/admin/stats") {
        return jsonResponse({ data: state.stats });
      }
      if (method === "GET" && path === "/reports/rejection-reasons") {
        return jsonResponse({ data: state.report });
      }
      if (method === "GET" && path === "/role-categories") {
        return collection(state.roleCategories);
      }

      throw new Error(`Unhandled request: ${method} ${url.pathname}`);
    }),
  );

  return { requests, state };
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderDashboardPage(
  initialPath: "/admin" | "/admin/stats" | "/admin/reports/rejection-reasons",
): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: "/admin", element: <AttentionQueuePage /> },
      { path: "/admin/stats", element: <StatsPage /> },
      {
        path: "/admin/reports/rejection-reasons",
        element: <RejectionReasonsReportPage />,
      },
      { path: "/admin/requisitions", element: <div>Requisitions list</div> },
      { path: "/admin/requisitions/:id", element: <div>Requisition page</div> },
      { path: "/admin/clients/:id", element: <div>Client page</div> },
      { path: "/admin/candidates/:id", element: <div>Candidate page</div> },
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
