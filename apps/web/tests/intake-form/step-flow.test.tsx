/**
 * UX 3.5 conversion work on the intake renderer:
 *  - visible "Step n of N" line with the current step's question count
 *  - steps whose questions are ALL conditionally hidden auto-skip on Next
 *  - confirmation screen: copy-reference button + review-time expectation
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntakePage, estimateMinutes } from "@/routes/public/intake-page";
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

/**
 * Step 2 has a controller question; step 3 ("Extras") is entirely
 * conditional on it being answered true — unanswered, the whole step is
 * hidden and must be skipped.
 */
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
      }),
      makeQuestion({
        key: "wants_extras",
        label: "Anything unusual about the role?",
        questionType: "yes_no",
        isRequired: false,
        sortOrder: 2,
      }),
    ],
  }),
  makeCategory({
    key: "extras",
    label: "Extras",
    sortOrder: 2,
    questions: [
      makeQuestion({
        key: "extras_detail",
        label: "Tell us more",
        questionType: "short_text",
        isRequired: true,
        sortOrder: 1,
        conditional: {
          questionKey: "wants_extras",
          operator: "is_true",
          value: null,
        },
      }),
    ],
  }),
  makeCategory({
    key: "budget",
    label: "Budget",
    sortOrder: 3,
    questions: [
      makeQuestion({
        key: "budget_note",
        label: "Budget note",
        questionType: "short_text",
        isRequired: false,
        sortOrder: 1,
      }),
    ],
  }),
]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let submittedCount: number;

function installFetchMock() {
  submittedCount = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/api/v1/taxonomy/public")) {
        return jsonResponse({ data: taxonomyPayload });
      }
      if (url.includes("/api/v1/intake-form")) {
        return jsonResponse({ data: formPayload });
      }
      if (url.includes("/api/v1/intake-submissions")) {
        submittedCount += 1;
        return jsonResponse(
          { data: { requisitionReference: "REQ-000456" } },
          201,
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
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

async function chooseRole(user: ReturnType<typeof userEvent.setup>) {
  const engineSelect = await screen.findByLabelText(
    "Which part of your business is this hire for?",
  );
  await user.selectOptions(engineSelect, ENGINE_ID);
  await user.selectOptions(screen.getByLabelText("Department"), DEPARTMENT_ID);
  await user.selectOptions(
    screen.getByLabelText("Role category"),
    ROLE_CATEGORY_ID,
  );
}

describe("intake step flow (UX 3.5)", () => {
  beforeEach(() => {
    vi.stubEnv("VITE_API_BASE_URL", "http://api.test");
    installFetchMock();
    vi.stubGlobal("scrollTo", vi.fn());
  });
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("shows a visible step counter with question count from step 1, and a dynamic time estimate", async () => {
    renderIntakePage();
    await screen.findByLabelText(
      "Which part of your business is this hire for?",
    );

    // Step line: role step is step 1 with its 3 selects.
    const stepLine = screen.getByText((_, element) => {
      return element?.textContent === "Step 1 of 4: Role · 3 questions";
    });
    expect(stepLine).toBeInTheDocument();

    // 4 questions + 3 role selects → 7 questions ≈ 2 min → "about 5 minutes".
    expect(screen.getByText(/about 5 minutes/)).toBeInTheDocument();
  });

  it("estimateMinutes rounds to 5-minute bands and caps at 15", () => {
    expect(estimateMinutes(7)).toBe(5);
    expect(estimateMinutes(20)).toBe(5);
    expect(estimateMinutes(21)).toBe(10);
    expect(estimateMinutes(40)).toBe(10);
    expect(estimateMinutes(41)).toBe(15);
    expect(estimateMinutes(200)).toBe(15);
  });

  it("skips a step whose questions are all conditionally hidden, and Back skips it too", async () => {
    const user = userEvent.setup();
    renderIntakePage();
    await chooseRole(user);
    await user.click(screen.getByRole("button", { name: "Next" }));

    await screen.findByRole("heading", { name: "About you" });
    await user.type(screen.getByLabelText(/Company name/), "Acme Inc.");
    // wants_extras left unanswered → the Extras step has no visible questions.
    await user.click(screen.getByRole("button", { name: "Next" }));

    // Landed on Budget, not Extras.
    await screen.findByRole("heading", { name: "Budget" });
    expect(
      screen.queryByRole("heading", { name: "Extras" }),
    ).not.toBeInTheDocument();

    // Back also skips the hidden step.
    await user.click(screen.getByRole("button", { name: "Back" }));
    await screen.findByRole("heading", { name: "About you" });

    // Answering the controller re-enables the step.
    await user.click(screen.getByText("Yes"));
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "Extras" });
  });

  it("confirmation screen: copy-reference button and the review expectation", async () => {
    // userEvent.setup installs a working clipboard stub in jsdom.
    const user = userEvent.setup();
    renderIntakePage();
    await chooseRole(user);
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "About you" });
    await user.type(screen.getByLabelText(/Company name/), "Acme Inc.");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByRole("heading", { name: "Budget" });
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    await screen.findByText("Request received");
    expect(submittedCount).toBe(1);
    expect(
      screen.getByText(/reviews new requests within 2 business days/i),
    ).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Copy reference" }));
    expect(
      await screen.findByRole("button", { name: "Copied" }),
    ).toBeInTheDocument();
    await expect(window.navigator.clipboard.readText()).resolves.toBe(
      "REQ-000456",
    );
  });
});
