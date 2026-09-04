/**
 * End-to-end (jsdom, mocked fetch) coverage of the renderer:
 *   - cascading taxonomy selects → role-specific fetch
 *   - multi-step fill, conditional reveal, submit
 *   - answers keyed by type, hidden questions excluded
 *   - AC-IF-17: localStorage/sessionStorage remain untouched throughout
 *   - 422 mapping back onto fields with a summary
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { IntakeSubmission } from "@sdb/contracts";
import { IntakePage } from "@/routes/public/intake-page";
import { makeCategory, makeFormResponse, makeQuestion } from "./helpers";

const ENGINE_ID = "00000000-0000-4000-8000-0000000e0001";
const DEPARTMENT_ID = "00000000-0000-4000-8000-0000000d0001";
const ROLE_CATEGORY_ID = "00000000-0000-4000-8000-0000000c0001";

const taxonomyPayload = {
  engines: [
    {
      id: ENGINE_ID,
      key: "operations",
      label: "Operations",
      departments: [
        {
          id: DEPARTMENT_ID,
          key: "executive_assistance",
          label: "Executive Assistance",
          roleCategories: [
            {
              id: ROLE_CATEGORY_ID,
              key: "executive_assistant",
              label: "Executive Assistant",
              advertisedTitle: "Executive Assistant",
              description: null,
            },
          ],
        },
      ],
    },
  ],
};

const formPayload = makeFormResponse([
  makeCategory({
    key: "about_you",
    label: "About you",
    sortOrder: 1,
    questions: [
      makeQuestion({
        key: "company_name",
        label: "Company name",
        questionType: "short_text",
        isRequired: true,
        sortOrder: 1,
        validation: { maxLength: 200 },
      }),
      makeQuestion({
        key: "contact_email",
        label: "Best contact email",
        questionType: "email",
        isRequired: true,
        sortOrder: 2,
      }),
      makeQuestion({
        key: "has_industry",
        label: "Industry experience required?",
        questionType: "yes_no",
        isRequired: false,
        sortOrder: 3,
      }),
      makeQuestion({
        key: "industry_detail",
        label: "Which industry?",
        questionType: "short_text",
        isRequired: true,
        sortOrder: 4,
        conditional: {
          questionKey: "has_industry",
          operator: "is_true",
          value: null,
        },
      }),
    ],
  }),
  makeCategory({
    key: "budget",
    label: "Budget",
    sortOrder: 2,
    questions: [
      makeQuestion({
        key: "budget_range",
        label: "Budget range",
        questionType: "currency_range",
        isRequired: true,
        sortOrder: 1,
        validation: { currency: "USD", allowedUnits: ["hourly", "monthly"] },
      }),
    ],
  }),
]);

type SubmitHandler = () => Response;

let submitHandler: SubmitHandler;
let submittedBodies: IntakeSubmission[];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetchMock() {
  submittedBodies = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/taxonomy/public")) {
        return jsonResponse({ data: taxonomyPayload });
      }
      if (url.includes("/api/v1/intake-form")) {
        return jsonResponse({ data: formPayload });
      }
      if (url.includes("/api/v1/intake-submissions")) {
        submittedBodies.push(JSON.parse(String(init?.body)) as IntakeSubmission);
        return submitHandler();
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
}

/**
 * AC-IF-17 instrumentation: a recording Storage double installed as both
 * window.localStorage and window.sessionStorage. Any write attempt — from
 * the renderer, RHF, TanStack Query, or anything else — is recorded.
 */
interface InstrumentedStorage {
  storage: globalThis.Storage;
  writes: string[];
}

function instrumentStorage(): InstrumentedStorage {
  const writes: string[] = [];
  const store = new Map<string, string>();
  const storage: globalThis.Storage = {
    get length() {
      return store.size;
    },
    key: (index: number) => [...store.keys()][index] ?? null,
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => {
      writes.push(`setItem:${key}`);
      store.set(key, value);
    },
    removeItem: (key: string) => {
      writes.push(`removeItem:${key}`);
      store.delete(key);
    },
    clear: () => {
      writes.push("clear");
      store.clear();
    },
  };
  return { storage, writes };
}

let localStorageDouble: InstrumentedStorage;
let sessionStorageDouble: InstrumentedStorage;

function installStorageDoubles() {
  localStorageDouble = instrumentStorage();
  sessionStorageDouble = instrumentStorage();
  Object.defineProperty(window, "localStorage", {
    value: localStorageDouble.storage,
    configurable: true,
  });
  Object.defineProperty(window, "sessionStorage", {
    value: sessionStorageDouble.storage,
    configurable: true,
  });
}

function renderIntakePage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <IntakePage />
    </QueryClientProvider>,
  );
}

/** Drives the happy-path fill up to (not including) submit. */
async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  // Step 1 — cascading taxonomy selects
  const engineSelect = await screen.findByLabelText(
    "Which part of your business is this hire for?",
  );
  await user.selectOptions(engineSelect, ENGINE_ID);
  await user.selectOptions(screen.getByLabelText("Department"), DEPARTMENT_ID);
  await user.selectOptions(
    screen.getByLabelText("Role category"),
    ROLE_CATEGORY_ID,
  );
  await user.click(screen.getByRole("button", { name: "Next" }));

  // Step 2 — About you
  await screen.findByRole("heading", { name: "About you" });
  await user.type(screen.getByLabelText(/Company name/), "Acme Inc.");
  await user.type(
    screen.getByLabelText(/Best contact email/),
    "founder@acme.test",
  );
  // Conditional: not visible until the controller is answered true
  expect(screen.queryByText("Which industry?")).not.toBeInTheDocument();
  await user.click(screen.getByText("Yes"));
  await user.type(await screen.findByLabelText(/Which industry\?/), "Legal");

  await user.click(screen.getByRole("button", { name: "Next" }));

  // Step 3 — Budget
  await screen.findByRole("heading", { name: "Budget" });
  await user.click(screen.getByText("Monthly"));
  await user.type(screen.getByLabelText("Minimum"), "1500");
  await user.type(screen.getByLabelText("Maximum"), "2500");
}

describe("intake form end-to-end (mocked fetch)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    installFetchMock();
    vi.stubGlobal("scrollTo", vi.fn());
    installStorageDoubles();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("fills, submits, confirms — and never touches browser storage (AC-IF-17)", async () => {
    const localSetItem = vi.spyOn(Storage.prototype, "setItem");
    submitHandler = () =>
      jsonResponse({ data: { requisitionReference: "REQ-000123" } }, 201);

    const user = userEvent.setup();
    renderIntakePage();
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    // Confirmation screen: what happens next, no account prompt, and NO
    // requisition reference (removed at the client's request — T2).
    await screen.findByText("Request received");
    expect(screen.queryByText("REQ-000123")).not.toBeInTheDocument();
    expect(screen.getByText("What happens next")).toBeInTheDocument();
    expect(screen.queryByText(/account/i)).not.toBeInTheDocument();

    // Wire shape: visible answered questions only, one value field each
    expect(submittedBodies).toHaveLength(1);
    const submission = submittedBodies[0];
    expect(submission).toMatchObject({
      formVersionHash: "sha256:test-hash",
      roleCategoryId: ROLE_CATEGORY_ID,
    });
    expect(submission?.answers).toEqual([
      { questionKey: "company_name", valueText: "Acme Inc." },
      { questionKey: "contact_email", valueText: "founder@acme.test" },
      { questionKey: "has_industry", valueBoolean: true },
      { questionKey: "industry_detail", valueText: "Legal" },
      {
        questionKey: "budget_range",
        valueJson: { min: 1500, max: 2500, unit: "monthly", currency: "USD" },
      },
    ]);

    // AC-IF-17 — nothing written to either store, at any point
    expect(localSetItem).not.toHaveBeenCalled();
    expect(localStorageDouble.writes).toEqual([]);
    expect(sessionStorageDouble.writes).toEqual([]);
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
  });

  it("blocks Next on a step with invalid required answers", async () => {
    submitHandler = () => jsonResponse({}, 500);
    const user = userEvent.setup();
    renderIntakePage();

    const engineSelect = await screen.findByLabelText(
      "Which part of your business is this hire for?",
    );
    await user.selectOptions(engineSelect, ENGINE_ID);
    await user.selectOptions(screen.getByLabelText("Department"), DEPARTMENT_ID);
    await user.selectOptions(
      screen.getByLabelText("Role category"),
      ROLE_CATEGORY_ID,
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "About you" });

    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(
      await screen.findAllByText("This field is required."),
    ).not.toHaveLength(0);
    // Still on the same step
    expect(screen.getByRole("heading", { name: "About you" })).toBeInTheDocument();
  });

  it("maps a 422 back onto fields with a top summary (05 §5 req 8)", async () => {
    submitHandler = () =>
      jsonResponse(
        {
          error: {
            code: "VALIDATION_FAILED",
            message: "Some answers failed validation.",
            details: {
              fields: { contact_email: "This email domain is not allowed." },
            },
            requestId: "01J9X422ID",
          },
        },
        422,
      );

    const user = userEvent.setup();
    renderIntakePage();
    await fillForm(user);
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    // Summary with anchor link, requestId, and navigation back to the field's step
    const summary = await screen.findByRole("alert");
    expect(summary).toHaveTextContent("Some answers failed validation.");
    expect(summary).toHaveTextContent("This email domain is not allowed.");
    expect(summary).toHaveTextContent("01J9X422ID");
    await screen.findByRole("heading", { name: "About you" });
    // Inline message on the field itself
    const emailInput = screen.getByLabelText(/Best contact email/);
    expect(emailInput).toHaveAttribute("aria-invalid", "true");

    // Storage still untouched after the error path
    expect(localStorageDouble.writes).toEqual([]);
    expect(sessionStorageDouble.writes).toEqual([]);
  });
});
