/**
 * Shared harness for the P3 candidate tests — same approach as tests/p2:
 * the API is mocked at the fetch layer with a tiny in-memory server so
 * invalidation → refetch cycles observe mutations like the real API, and an
 * `override` hook runs first to force specific responses. Uploads get a
 * controllable fake XMLHttpRequest (the browser PUTs bytes via XHR for
 * progress events).
 */
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { vi } from "vitest";
import type {
  Candidate,
  CandidateDetail,
  CandidateDisqualifierCheck,
  CandidateFile,
  PublicTaxonomy,
} from "@sdb/contracts";
import {
  CandidateDetailPage,
  CandidateNewPage,
  CandidatesListPage,
} from "@/features/candidates";

/**
 * jsdom's AbortController signals are rejected by Node's undici Request,
 * which React Router constructs on navigation. Retry without the signal —
 * nothing in these tests aborts navigations. (Same shim as tests/p2.)
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

export function makeCandidate(
  overrides: Partial<Candidate> & Pick<Candidate, "firstName" | "lastName">,
): Candidate {
  const first = overrides.preferredName ?? overrides.firstName;
  return {
    id: testUuid(),
    publicId: testPublicId(),
    reference: `CAN-${String(uuidCounter).padStart(6, "0")}`,
    externalId: null,
    preferredName: null,
    displayName: `${first} ${overrides.lastName.charAt(0)}.`,
    email: null,
    phone: null,
    whatsapp: null,
    linkedinUrl: null,
    portfolioUrl: null,
    photoPath: null,
    country: null,
    regionState: null,
    city: null,
    timezone: null,
    nationality: null,
    relocationStatus: null,
    englishSpokenLevel: null,
    englishWrittenLevel: null,
    accentStrength: null,
    accentNotes: null,
    languageAssessedBy: null,
    languageAssessedAt: null,
    yearsExperienceTotal: null,
    yearsExperienceRelevant: null,
    currentTitle: null,
    currentEmployer: null,
    employmentStatus: null,
    noticePeriodDays: null,
    availableFrom: null,
    seniorityLevel: null,
    engineId: null,
    primaryRoleCategoryId: null,
    secondarySpecialisationId: null,
    hasManagementExperience: null,
    teamSizeManaged: null,
    hasClientFacingExperience: null,
    hasUsClientExperience: null,
    remoteExperienceYears: null,
    aiToolProficiency: null,
    typingWpm: null,
    techLiteracyRating: null,
    expectedRateAmount: null,
    expectedRateUnit: null,
    expectedRateCurrency: null,
    rateMin: null,
    rateMax: null,
    isRateNegotiable: null,
    currentRateAmount: null,
    currentRateUnit: null,
    engagementTypes: null,
    hoursAvailablePerWeek: null,
    overlapStart: null,
    overlapEnd: null,
    overlapTimezone: null,
    maxConcurrentClients: null,
    internetDownMbps: null,
    internetUpMbps: null,
    hasBackupInternet: null,
    hasBackupPower: null,
    computerSpecs: null,
    hasDualMonitor: null,
    headsetQuality: null,
    workspace: null,
    isQuietEnvironmentVerified: null,
    vettingStatus: "not_started",
    vettedBy: null,
    vettedAt: null,
    screeningCallAt: null,
    recruiterRating: null,
    recruiterRecommendation: null,
    strengths: null,
    watchPoints: null,
    redFlags: null,
    autonomy: null,
    canManageUp: null,
    proactivityRating: null,
    attentionToDetailRating: null,
    communicationRating: null,
    energyPresentationRating: null,
    salesBackgroundWeight: null,
    hasOpsBackground: null,
    hasEntrepreneurialAmbition: null,
    areReferencesChecked: false,
    backgroundCheckStatus: null,
    source: "linkedin",
    sourceDetail: null,
    sourcedBy: null,
    submittedVia: "manual",
    externalSystem: null,
    firstContactedAt: null,
    responsivenessRating: null,
    lastActivityAt: null,
    dataCompleteness: "complete",
    hasConsentToShareProfile: false,
    consentCapturedAt: null,
    consentSource: null,
    retentionUntil: null,
    doNotPresentToClientIds: [],
    poolStatus: "active",
    cvPrimaryFileId: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    ...overrides,
  };
}

export function makeDetail(
  candidate: Candidate,
  overrides?: Partial<CandidateDetail>,
): CandidateDetail {
  return {
    ...candidate,
    photoUrl: null,
    missingFields: [],
    // Form-builder submissions (0020/0021). Empty by default so existing
    // fixtures keep describing a candidate with no public-form history.
    submissions: [],
    languages: [],
    tools: [],
    skills: [],
    employmentHistory: [],
    education: [],
    certifications: [],
    references: [],
    notes: [],
    disqualifierChecks: [],
    assessments: [],
    files: [],
    ...overrides,
  };
}

export function makeFile(
  overrides: Partial<CandidateFile> &
    Pick<CandidateFile, "candidateId" | "originalFilename">,
): CandidateFile {
  return {
    id: testUuid(),
    fileType: "cv",
    storagePath: `candidates/${overrides.candidateId}/cv.pdf`,
    mimeType: "application/pdf",
    sizeBytes: 120_000,
    isClientVisible: false,
    virusScanStatus: "complete",
    uploadedBy: null,
    uploadedAt: NOW,
    ...overrides,
  };
}

export interface DisqualifierRow {
  id: string;
  key: string;
  label: string;
  roleCategoryId: string | null;
  isActive: boolean;
  sortOrder: number;
}

export function makeDisqualifier(
  overrides: Partial<DisqualifierRow> & Pick<DisqualifierRow, "key" | "label">,
): DisqualifierRow {
  return {
    id: testUuid(),
    roleCategoryId: null,
    isActive: true,
    sortOrder: 0,
    ...overrides,
  };
}

export const EMPTY_TAXONOMY: PublicTaxonomy = { engines: [] };

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
): Response {
  return jsonResponse(
    { error: { code, message, requestId: "req-test-1" } },
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

export interface ServerState {
  candidates: Candidate[];
  detailsById: Record<string, CandidateDetail>;
  filesByCandidateId: Record<string, CandidateFile[]>;
  taxonomy: PublicTaxonomy;
  tools: { id: string; name: string; category: string | null; isActive: boolean }[];
  skills: { id: string; name: string; category: string | null; isActive: boolean }[];
  disqualifiers: DisqualifierRow[];
}

export function makeState(partial?: Partial<ServerState>): ServerState {
  return {
    candidates: [],
    detailsById: {},
    filesByCandidateId: {},
    taxonomy: EMPTY_TAXONOMY,
    tools: [],
    skills: [],
    disqualifiers: [],
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

      // ----- global event log (candidate detail right rail) -----
      if (method === "GET" && path === "/events") {
        return collection([]);
      }

      // ----- taxonomy / option lists -----
      if (method === "GET" && path === "/taxonomy/public") {
        return jsonResponse({ data: state.taxonomy });
      }
      if (method === "GET" && path === "/tools") {
        return collection(state.tools);
      }
      if (method === "GET" && path === "/skills") {
        return collection(state.skills);
      }
      if (method === "GET" && path === "/disqualifiers") {
        return collection(state.disqualifiers);
      }

      // ----- download urls -----
      const download = path.match(
        new RegExp(`^/files/(${UUID})/download-url$`),
      );
      if (download !== null && method === "GET") {
        return jsonResponse({
          data: {
            url: `http://storage.test/signed/${download[1]}`,
            expiresInSeconds: 300,
          },
        });
      }

      // ----- candidates root -----
      if (path === "/candidates") {
        if (method === "GET") return collection(state.candidates);
        if (method === "POST") {
          const payload = body as { firstName: string; lastName: string };
          const created = makeCandidate({
            firstName: payload.firstName,
            lastName: payload.lastName,
          });
          state.candidates = [...state.candidates, created];
          state.detailsById[created.id] = makeDetail(created);
          return jsonResponse({ data: created }, 201);
        }
      }

      // ----- candidate files -----
      const fileAction = path.match(
        new RegExp(
          `^/candidates/(${UUID})/files(?:/(upload-url|${UUID}))?(?:/(confirm))?$`,
        ),
      );
      if (fileAction !== null) {
        const [, candidateId = "", second, third] = fileAction;
        const files = state.filesByCandidateId[candidateId] ?? [];
        if (method === "GET" && second === undefined) {
          return collection(files);
        }
        if (method === "POST" && second === "upload-url") {
          const payload = body as {
            fileType: CandidateFile["fileType"];
            originalFilename: string;
            mimeType: string;
            sizeBytes: number;
          };
          const fileId = testUuid();
          const pending = makeFile({
            id: fileId,
            candidateId,
            originalFilename: payload.originalFilename,
            fileType: payload.fileType,
            mimeType: payload.mimeType,
            sizeBytes: payload.sizeBytes,
            virusScanStatus: "pending",
          });
          state.filesByCandidateId[candidateId] = [...files, pending];
          return jsonResponse(
            {
              data: {
                fileId,
                uploadUrl: `http://storage.test/upload/${fileId}`,
                token: "signed-upload-token",
                storagePath: pending.storagePath,
              },
            },
            201,
          );
        }
        if (second !== undefined && second !== "upload-url") {
          const file = files.find((entry) => entry.id === second);
          if (file === undefined) {
            return errorResponse("NOT_FOUND", "File not found.", 404);
          }
          if (method === "POST" && third === "confirm") {
            file.virusScanStatus = "complete";
            return jsonResponse({ data: file });
          }
          if (method === "PATCH") {
            Object.assign(file, body);
            return jsonResponse({ data: file });
          }
          if (method === "DELETE") {
            state.filesByCandidateId[candidateId] = files.filter(
              (entry) => entry.id !== second,
            );
            return new Response(null, { status: 204 });
          }
        }
      }

      // ----- disqualifier checks -----
      const checksAction = path.match(
        new RegExp(`^/candidates/(${UUID})/disqualifier-checks$`),
      );
      if (checksAction !== null) {
        const [, candidateId = ""] = checksAction;
        const detail = state.detailsById[candidateId];
        if (detail === undefined) {
          return errorResponse("NOT_FOUND", "Candidate not found.", 404);
        }
        if (method === "GET") return collection(detail.disqualifierChecks);
        if (method === "PUT") {
          const payload = body as {
            checks: {
              disqualifierId: string;
              result: CandidateDisqualifierCheck["result"];
              notes?: string | null;
            }[];
          };
          for (const check of payload.checks) {
            const disqualifier = state.disqualifiers.find(
              (entry) => entry.id === check.disqualifierId,
            );
            const existing = detail.disqualifierChecks.find(
              (entry) => entry.disqualifierId === check.disqualifierId,
            );
            const row: CandidateDisqualifierCheck = {
              disqualifierId: check.disqualifierId,
              disqualifierKey: disqualifier?.key ?? "unknown",
              disqualifierLabel: disqualifier?.label ?? "Unknown",
              result: check.result,
              notes: check.notes ?? null,
              checkedBy: null,
              checkedAt: NOW,
            };
            if (existing !== undefined) Object.assign(existing, row);
            else detail.disqualifierChecks.push(row);
          }
          return collection(detail.disqualifierChecks);
        }
      }

      // ----- other child collections (append-only where tests need them) ---
      const childAction = path.match(
        new RegExp(
          `^/candidates/(${UUID})/(languages|tools|skills|employment-history|education|certifications|references|notes|assessments)(?:/(${UUID}))?$`,
        ),
      );
      if (childAction !== null) {
        const [, candidateId = "", kind = ""] = childAction;
        const detail = state.detailsById[candidateId];
        if (detail === undefined) {
          return errorResponse("NOT_FOUND", "Candidate not found.", 404);
        }
        if (method === "GET") return collection([]);
        if (kind === "tools" && method === "PUT") {
          const payload = body as { tools: { toolId: string; proficiency: string }[] };
          detail.tools = payload.tools.map((tool) => ({
            toolId: tool.toolId,
            proficiency: tool.proficiency as CandidateDetail["tools"][number]["proficiency"],
            yearsUsed: null,
            lastUsedYear: null,
          }));
          return collection(detail.tools);
        }
        if (kind === "skills" && method === "PUT") {
          const payload = body as {
            skills: { skillId: string; proficiency: string }[];
          };
          detail.skills = payload.skills.map((skill) => ({
            skillId: skill.skillId,
            proficiency:
              skill.proficiency as CandidateDetail["skills"][number]["proficiency"],
            verifiedBy: null,
            verifiedAt: null,
          }));
          return collection(detail.skills);
        }
        // Generic 200 for POST/PATCH/DELETE the tests don't inspect.
        return jsonResponse({ data: {} }, method === "POST" ? 201 : 200);
      }

      // ----- candidate CRUD + actions -----
      const candidateAction = path.match(
        new RegExp(`^/candidates/(${ENTITY_REF})(?:/(archive|consent))?$`),
      );
      if (candidateAction !== null) {
        const [, id = "", action] = candidateAction;
        const detail =
          state.detailsById[id] ??
          Object.values(state.detailsById).find(
            (entry) => entry.publicId === id,
          );
        if (detail === undefined) {
          return errorResponse("NOT_FOUND", "Candidate not found.", 404);
        }
        if (method === "GET" && action === undefined) {
          return jsonResponse({ data: detail });
        }
        if (method === "PATCH" && action === undefined) {
          Object.assign(detail, body);
          return jsonResponse({ data: detail });
        }
        if (method === "POST" && action === "archive") {
          detail.archivedAt = NOW;
          return jsonResponse({ data: detail });
        }
        if (method === "POST" && action === "consent") {
          const payload = body as {
            hasConsentToShareProfile: boolean;
            consentSource: string;
          };
          detail.hasConsentToShareProfile = payload.hasConsentToShareProfile;
          detail.consentSource = payload.consentSource;
          detail.consentCapturedAt = NOW;
          return jsonResponse({ data: detail });
        }
      }

      throw new Error(`Unhandled request: ${method} ${url.pathname}`);
    }),
  );

  return { requests, state };
}

// ---------------------------------------------------------------------------
// Fake XMLHttpRequest for the signed-URL PUT
// ---------------------------------------------------------------------------

export class FakeXHR {
  static instances: FakeXHR[] = [];
  /** Status the next send() resolves with. */
  static nextStatus = 200;

  method = "";
  url = "";
  status = 0;
  headers: Record<string, string> = {};
  sentBody: unknown = null;
  upload = {
    addEventListener: (
      _event: string,
      _handler: (event: ProgressEvent) => void,
    ) => {},
  };

  private listeners: Record<string, () => void> = {};

  open(method: string, url: string): void {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  addEventListener(event: string, handler: () => void): void {
    this.listeners[event] = handler;
  }

  send(body: unknown): void {
    this.sentBody = body;
    FakeXHR.instances.push(this);
    this.status = FakeXHR.nextStatus;
    queueMicrotask(() => this.listeners.load?.());
  }

  static reset(): void {
    FakeXHR.instances = [];
    FakeXHR.nextStatus = 200;
  }
}

export function installFakeXhr(): void {
  FakeXHR.reset();
  vi.stubGlobal("XMLHttpRequest", FakeXHR);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export function renderCandidates(
  initialPath: string,
): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [
      { path: "/admin/candidates", element: <CandidatesListPage /> },
      { path: "/admin/candidates/new", element: <CandidateNewPage /> },
      { path: "/admin/candidates/:id", element: <CandidateDetailPage /> },
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
