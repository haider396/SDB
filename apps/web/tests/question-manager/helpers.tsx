/**
 * Shared harness for question-manager tests. The API is mocked at the fetch
 * layer (same approach as tests/intake-form): a tiny in-memory server keeps
 * categories/questions and answers every /api/v1 route the feature calls, so
 * invalidation → refetch cycles observe edits exactly like the real API.
 */
import type { ReactElement } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { RouterProvider, createMemoryRouter } from "react-router-dom";
import { Toaster } from "sonner";
import { vi } from "vitest";
import type {
  IntakeFormCategory,
  IntakeFormQuestion,
  Question,
  QuestionCategory,
  QuestionDetail,
} from "@sdb/contracts";
import { QuestionManagerPage } from "@/features/question-manager";

let uuidCounter = 0;

/** Deterministic valid v4-shaped uuid for fixtures. */
export function testUuid(): string {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
}

const NOW = "2026-08-12T09:00:00+00:00";

export function makeCategory(
  overrides: Partial<QuestionCategory> & Pick<QuestionCategory, "key">,
): QuestionCategory {
  return {
    id: testUuid(),
    label: overrides.key,
    description: null,
    sortOrder: 1,
    isActive: true,
    questionCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

export function makeQuestion(
  overrides: Partial<Question> &
    Pick<Question, "key" | "categoryId">,
): Question {
  return {
    id: testUuid(),
    label: overrides.key,
    helpText: null,
    placeholder: null,
    questionType: "short_text",
    audience: "client",
    isRequired: false,
    isActive: true,
    sortOrder: 1,
    validation: {},
    conditional: null,
    options: [],
    roleCategoryIds: [],
    answerCount: 0,
    lastAnsweredAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    archivedAt: null,
    ...overrides,
  };
}

export function toDetail(question: Question): QuestionDetail {
  return { ...question, dependents: [], lastAnsweredAt: null };
}

export const ROLE_CATEGORY_ID = "00000000-0000-4000-8000-00000000ca01";

const taxonomyPayload = {
  engines: [
    {
      id: "00000000-0000-4000-8000-00000000e001",
      key: "operations",
      label: "Operations",
      description: null,
      departments: [
        {
          id: "00000000-0000-4000-8000-00000000d001",
          key: "executive_assistance",
          label: "Executive Assistance",
          roleCategories: [
            {
              id: ROLE_CATEGORY_ID,
              key: "executive_assistant",
              label: "Executive Assistant",
              advertisedTitle: null,
              description: null,
            },
          ],
        },
      ],
    },
  ],
};

function toIntakeQuestion(question: Question): IntakeFormQuestion {
  return {
    id: question.id,
    key: question.key,
    label: question.label,
    helpText: question.helpText,
    placeholder: question.placeholder,
    questionType: question.questionType,
    isRequired: question.isRequired,
    sortOrder: question.sortOrder,
    validation: question.validation,
    options: question.options
      .filter((option) => option.isActive)
      .map((option) => ({ value: option.value, label: option.label })),
    conditional: question.conditional,
  };
}

/** Mutable in-memory server state shared with the fetch mock. */
export interface ServerState {
  categories: QuestionCategory[];
  questions: Question[];
}

function buildPreview(state: ServerState): {
  formVersionHash: string;
  generatedAt: string;
  categories: IntakeFormCategory[];
} {
  return {
    formVersionHash: "sha256:test",
    generatedAt: NOW,
    categories: state.categories
      .filter((category) => category.isActive)
      .map((category) => ({
        id: category.id,
        key: category.key,
        label: category.label,
        description: category.description,
        sortOrder: category.sortOrder,
        questions: state.questions
          .filter(
            (question) =>
              question.categoryId === category.id &&
              question.isActive &&
              question.archivedAt === null &&
              question.audience === "client",
          )
          .map(toIntakeQuestion),
      })),
  };
}

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

export interface ApiMock {
  requests: RecordedRequest[];
  state: ServerState;
}

/**
 * Installs a fetch mock backed by `state`. `override` runs first — return a
 * Response to short-circuit (e.g. force a 500), undefined to fall through to
 * the default in-memory behaviour.
 */
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

      if (method === "GET" && path === "/taxonomy/public") {
        return jsonResponse({ data: taxonomyPayload });
      }
      if (method === "GET" && path === "/question-categories") {
        return collection(state.categories);
      }
      if (method === "GET" && path === "/questions/preview") {
        return jsonResponse({ data: buildPreview(state) });
      }
      if (method === "GET" && path === "/questions") {
        const categoryId = url.searchParams.get("categoryId");
        const data =
          categoryId === null
            ? state.questions
            : state.questions.filter(
                (question) => question.categoryId === categoryId,
              );
        return collection(data.filter((q) => q.archivedAt === null));
      }
      if (method === "POST" && path === "/questions") {
        const payload = body as Partial<Question> & {
          categoryId: string;
          label: string;
        };
        const created = makeQuestion({
          key:
            (payload.key as string | undefined) ??
            payload.label.toLowerCase().replace(/[^a-z0-9]+/g, "_"),
          categoryId: payload.categoryId,
          label: payload.label,
          questionType: payload.questionType ?? "short_text",
          audience: payload.audience ?? "client",
          isRequired: payload.isRequired ?? false,
          conditional: payload.conditional ?? null,
        });
        state.questions.push(created);
        return jsonResponse({ data: toDetail(created) }, 201);
      }
      if (method === "PATCH" && path === "/questions/reorder") {
        const { categoryId, orderedQuestionIds } = body as {
          categoryId: string;
          orderedQuestionIds: string[];
        };
        state.questions = state.questions.map((question) => {
          if (question.categoryId !== categoryId) return question;
          const index = orderedQuestionIds.indexOf(question.id);
          return index === -1
            ? question
            : { ...question, sortOrder: index + 1 };
        });
        return jsonResponse({ data: { reordered: true } });
      }
      if (method === "PATCH" && path === "/question-categories/reorder") {
        const { orderedCategoryIds } = body as { orderedCategoryIds: string[] };
        state.categories = state.categories.map((category) => {
          const index = orderedCategoryIds.indexOf(category.id);
          return index === -1
            ? category
            : { ...category, sortOrder: index + 1 };
        });
        return jsonResponse({ data: { reordered: true } });
      }

      const questionAction = path.match(
        /^\/questions\/([0-9a-f-]{36})(?:\/(activate|deactivate|duplicate))?$/,
      );
      if (questionAction !== null) {
        const [, id, action] = questionAction;
        const question = state.questions.find((entry) => entry.id === id);
        if (question === undefined) {
          return errorResponse("NOT_FOUND", "Question not found.", 404);
        }
        if (method === "GET" && action === undefined) {
          return jsonResponse({ data: toDetail(question) });
        }
        if (method === "PATCH" && action === undefined) {
          const patch = body as Partial<Question>;
          Object.assign(question, patch);
          return jsonResponse({ data: toDetail(question) });
        }
        if (method === "DELETE" && action === undefined) {
          question.archivedAt = NOW;
          return new Response(null, { status: 204 });
        }
        if (method === "POST" && action === "activate") {
          question.isActive = true;
          return jsonResponse({ data: toDetail(question) });
        }
        if (method === "POST" && action === "deactivate") {
          question.isActive = false;
          return jsonResponse({ data: toDetail(question), warnings: [] });
        }
        if (method === "POST" && action === "duplicate") {
          const copy = makeQuestion({
            ...question,
            id: testUuid(),
            key: `${question.key}_copy`,
            label: `${question.label} (copy)`,
          });
          state.questions.push(copy);
          return jsonResponse({ data: toDetail(copy) }, 201);
        }
      }

      throw new Error(`Unhandled request: ${method} ${url.pathname}`);
    }),
  );

  return { requests, state };
}

export function renderQuestionManager(): ReturnType<typeof render> {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const router = createMemoryRouter(
    [{ path: "/admin/questions", element: <QuestionManagerPage /> }],
    { initialEntries: ["/admin/questions"] },
  );
  const ui: ReactElement = (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
    </QueryClientProvider>
  );
  return render(ui);
}
