/**
 * Public candidate registration form (T38) — jsdom, mocked fetch.
 *
 * Covers the behaviour that is easy to break and expensive to get wrong:
 *   - the configurable question categories become steps, plus the three
 *     fixed ones (typing / documents / consent)
 *   - required-field validation gates Next
 *   - consent gates submit — without it a candidate can never be presented
 *     (422 CONSENT_MISSING, AC-PL-05), so a silent pass here would poison
 *     the pipeline
 *   - the submitted payload carries answers, typing attempts and consent
 *   - a session is created lazily, not on page load
 *   - a server 422 maps back onto the offending field
 *   - nothing is written to localStorage/sessionStorage — the reasoning
 *     behind AC-IF-17 applies equally to this public form
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CandidateRegistration } from "@sdb/contracts";
import { RegistrationForm } from "@/features/candidate-registration";
import {
  makeCategory,
  makeQuestion,
} from "../intake-form/helpers";

const SESSION_ID = "00000000-0000-4000-8000-00000000a001";

const formPayload = {
  formVersionHash: "sha256:candidate-hash",
  generatedAt: "2026-08-28T09:00:00+00:00",
  categories: [
    makeCategory({
      key: "candidate_personal",
      label: "About you",
      sortOrder: 1,
      questions: [
        makeQuestion({
          key: "first_name",
          label: "First name",
          isRequired: true,
          sortOrder: 1,
        }),
        makeQuestion({
          key: "last_name",
          label: "Last name",
          isRequired: true,
          sortOrder: 2,
        }),
      ],
    }),
    makeCategory({
      key: "candidate_experience",
      label: "Your experience",
      sortOrder: 2,
      questions: [
        makeQuestion({
          key: "current_title",
          label: "Current job title",
          sortOrder: 1,
        }),
      ],
    }),
  ],
};

let submitted: CandidateRegistration[];
let sessionCalls: number;
let submitStatus: number;
let submitBody: unknown;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetchMock() {
  submitted = [];
  sessionCalls = 0;
  submitStatus = 201;
  submitBody = { data: { received: true } };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes("/api/v1/candidate-registration-form")) {
        return jsonResponse({ data: formPayload });
      }
      if (url.includes("/api/v1/candidate-registrations/session")) {
        sessionCalls += 1;
        return jsonResponse(
          {
            data: {
              sessionId: SESSION_ID,
              expiresAt: "2026-08-29T09:00:00+00:00",
            },
          },
          201,
        );
      }
      if (url.includes("/api/v1/candidate-registrations")) {
        submitted.push(JSON.parse(String(init?.body)) as CandidateRegistration);
        return jsonResponse(submitBody, submitStatus);
      }
      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );
}

function renderForm() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <RegistrationForm />
    </QueryClientProvider>,
  );
}

/**
 * The step line renders as `Step <span>1</span> of <span>5</span>`, so its
 * text is split across elements and a plain string matcher never finds it.
 * Read the whole line's textContent instead.
 */
function stepLine(): string {
  const nav = screen.getByRole("navigation", { name: "Form steps" });
  return nav.parentElement?.textContent ?? "";
}

/** Walk from step 1 to the consent step, filling the required fields. */
async function fillToConsent(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByRole("heading", { name: "About you" });
  await user.type(screen.getByLabelText(/First name/), "Maria");
  await user.type(screen.getByLabelText(/Last name/), "Gonzalez");
  await user.click(screen.getByRole("button", { name: "Next" }));

  await screen.findByRole("heading", { name: "Your experience" });
  await user.click(screen.getByRole("button", { name: "Next" }));

  await screen.findByRole("heading", { name: "Typing speed" });
  await user.click(screen.getByRole("button", { name: "Next" }));

  await screen.findByRole("heading", { name: "Documents" });
  await user.click(screen.getByRole("button", { name: "Next" }));

  await screen.findByRole("heading", { name: "Consent" });
}

beforeEach(() => {
  installFetchMock();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("candidate registration form (T38)", () => {
  it("builds steps from the question categories plus typing, documents and consent", async () => {
    renderForm();
    await screen.findByRole("heading", { name: "About you" });
    // 2 configurable categories + 3 fixed steps.
    expect(stepLine()).toMatch(/Step 1 of 5/);
  });

  it("does not create a session just by opening the form", async () => {
    renderForm();
    await screen.findByRole("heading", { name: "About you" });
    expect(sessionCalls).toBe(0);
  });

  it("blocks Next until the step's required fields are filled", async () => {
    const user = userEvent.setup();
    renderForm();
    await screen.findByRole("heading", { name: "About you" });

    await user.click(screen.getByRole("button", { name: "Next" }));
    // Still on step 1 — the heading has not advanced.
    expect(
      screen.getByRole("heading", { name: "About you" }),
    ).toBeInTheDocument();
    expect(stepLine()).toMatch(/Step 1 of 5/);
  });

  it("refuses to submit without consent, and submits nothing", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillToConsent(user);

    await user.click(screen.getByRole("button", { name: "Submit registration" }));

    expect(
      await screen.findByText(/need your permission/i),
    ).toBeInTheDocument();
    expect(submitted).toHaveLength(0);
  });

  it("submits answers, consent and a session id once consent is given", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillToConsent(user);

    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Submit registration" }));

    await screen.findByText("You’re registered");

    expect(submitted).toHaveLength(1);
    const body = submitted[0]!;
    expect(body.consentToShareProfile).toBe(true);
    expect(body.sessionId).toBe(SESSION_ID);
    expect(body.formVersionHash).toBe("sha256:candidate-hash");
    expect(body.answers).toEqual(
      expect.arrayContaining([
        { questionKey: "first_name", valueText: "Maria" },
        { questionKey: "last_name", valueText: "Gonzalez" },
      ]),
    );
  });

  it("omits questions the candidate left blank rather than sending nulls", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillToConsent(user);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Submit registration" }));
    await screen.findByText("You’re registered");

    const keys = submitted[0]!.answers.map((answer) => answer.questionKey);
    // current_title was never filled in.
    expect(keys).not.toContain("current_title");
  });

  it("maps a server 422 back onto the offending field", async () => {
    const user = userEvent.setup();
    renderForm();
    await fillToConsent(user);
    await user.click(screen.getByRole("checkbox"));

    submitStatus = 422;
    // `details.fields` is the shape the API actually returns and the shape
    // error-map.ts reads — asserting on it here is what caught the service
    // emitting `fieldErrors` instead, which would have produced a banner with
    // no per-field messages.
    submitBody = {
      error: {
        code: "VALIDATION_FAILED",
        message: "Some answers need attention.",
        details: { fields: { first_name: "That name is too short." } },
      },
    };

    await user.click(screen.getByRole("button", { name: "Submit registration" }));

    // ErrorSummary renders "<label>: <message>" across text nodes, so match
    // the anchor's full accessible name rather than the message alone.
    expect(
      await screen.findByRole("link", {
        name: /First name: That name is too short\./,
      }),
    ).toBeInTheDocument();
    // The confirmation must NOT render on a failed submit.
    expect(screen.queryByText("You’re registered")).not.toBeInTheDocument();
  });

  it("writes nothing to localStorage or sessionStorage (AC-IF-17 reasoning)", async () => {
    const localSpy = vi.spyOn(Storage.prototype, "setItem");
    const user = userEvent.setup();
    renderForm();
    await fillToConsent(user);
    await user.click(screen.getByRole("checkbox"));
    await user.click(screen.getByRole("button", { name: "Submit registration" }));
    await screen.findByText("You’re registered");

    expect(localSpy).not.toHaveBeenCalled();
    localSpy.mockRestore();
  });
});
