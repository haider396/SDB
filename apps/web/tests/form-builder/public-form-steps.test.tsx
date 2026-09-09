/**
 * A built form at /f/:slug — the per-form typing and documents steps.
 *
 * The bug these pin: the builder's Preview appended a "Typing speed" and a
 * "Documents" step from `hasTypingTest` / `hasDocumentsStep`, but the LIVE
 * renderer read neither flag. An admin ticked "collect documents", saw the
 * step in Preview, published — and candidates were never asked for a CV,
 * while `submit()` posted `files: []` regardless. The Preview lied.
 *
 * So three properties are worth holding down:
 *   - flags ON  → both steps render, in the Preview's order
 *   - flags OFF → neither renders, and the step sequence is byte-for-byte
 *     what it was before this change (pages, then Consent)
 *   - flags OFF → the submitted body still carries the empty arrays the
 *     server's step guards demand (candidate-form-submission.service.ts 422s
 *     on a non-empty `typingAttempts`/`files` for a form without the step)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { FormThemeSchema } from "@sdb/contracts";
import { PublicFormRenderer } from "@/features/form-builder/render/public-form-renderer";
import { makeBlock } from "@/features/form-builder/defaults";
import { makeCategory, makeQuestion } from "../intake-form/helpers";

const SLUG = "WoK6hBgzhuey";
const SESSION_ID = "00000000-0000-4000-8000-0000000000f1";

const firstName = makeQuestion({
  key: "first_name",
  label: "First name",
  isRequired: true,
  sortOrder: 1,
});
const currentTitle = makeQuestion({
  key: "current_title",
  label: "Current job title",
  sortOrder: 2,
});

/**
 * The public payload for a two-page form, with the step flags supplied by the
 * test. Shape mirrors candidate-form-public.service.ts's PublicFormPayload.
 */
function makePayload(flags: {
  hasTypingTest: boolean;
  hasDocumentsStep: boolean;
}) {
  return {
    form: {
      slug: SLUG,
      key: "candidate_registration",
      label: "Candidate registration",
      description: null,
      hasTypingTest: flags.hasTypingTest,
      hasDocumentsStep: flags.hasDocumentsStep,
      isDefault: false,
      roleCategory: null,
    },
    formVersionId: "00000000-0000-4000-8000-0000000000e1",
    formVersionHash: "sha256:built-form-hash",
    generatedAt: "2026-09-09T09:00:00+00:00",
    theme: FormThemeSchema.parse({}),
    pages: [
      { index: 0, title: "About you", description: null },
      { index: 1, title: "Your experience", description: null },
    ],
    blocks: [
      makeBlock("question", 0, 0, { questionId: firstName.id }),
      makeBlock("question", 1, 0, { questionId: currentTitle.id }),
    ],
    categories: [
      makeCategory({
        key: "candidate_personal",
        label: "About you",
        sortOrder: 1,
        questions: [firstName, currentTitle],
      }),
    ],
  };
}

let submittedBodies: Record<string, unknown>[];
let sessionCalls: number;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function installFetchMock(flags: {
  hasTypingTest: boolean;
  hasDocumentsStep: boolean;
}) {
  submittedBodies = [];
  sessionCalls = 0;

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      // Most specific first: the submissions path also contains the form path.
      if (url.includes(`/candidate-forms/public/${SLUG}/submissions`)) {
        submittedBodies.push(
          JSON.parse(String(init?.body)) as Record<string, unknown>,
        );
        return jsonResponse({ data: { received: true } }, 201);
      }
      if (url.includes(`/candidate-forms/public/${SLUG}`)) {
        return jsonResponse({ data: makePayload(flags) });
      }
      if (url.includes("/candidate-registrations/session")) {
        sessionCalls += 1;
        return jsonResponse(
          {
            data: {
              sessionId: SESSION_ID,
              expiresAt: "2026-09-10T09:00:00+00:00",
            },
          },
          201,
        );
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
      <PublicFormRenderer slug={SLUG} />
    </QueryClientProvider>,
  );
}

/**
 * "Step 1 of 5" renders across several elements, so a string matcher never
 * finds it. Read the whole progress block's textContent instead.
 */
function stepLine(): string {
  const nav = screen.getByRole("navigation", { name: "Form steps" });
  return nav.parentElement?.textContent ?? "";
}

/** Fill page 1's required field and walk to the end of the canvas pages. */
async function walkThroughPages(user: ReturnType<typeof userEvent.setup>) {
  await screen.findByLabelText(/First name/);
  await user.type(screen.getByLabelText(/First name/), "Maria");
  await user.click(screen.getByRole("button", { name: "Next" }));

  await screen.findByLabelText(/Current job title/);
  await user.click(screen.getByRole("button", { name: "Next" }));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("built form: per-form typing and documents steps", () => {
  describe("both flags on", () => {
    beforeEach(() => {
      installFetchMock({ hasTypingTest: true, hasDocumentsStep: true });
    });

    it("shows both steps, after the pages and before Consent", async () => {
      const user = userEvent.setup();
      renderForm();

      // 2 canvas pages + typing + documents + consent.
      await screen.findByLabelText(/First name/);
      expect(stepLine()).toMatch(/Step 1 of 5/);

      await walkThroughPages(user);

      const typing = await screen.findByRole("region", { name: "Typing speed" });
      expect(typing).toBeInTheDocument();
      expect(
        screen.getByLabelText(/Typing speed \(words per minute\)/),
      ).toBeInTheDocument();
      expect(stepLine()).toMatch(/Step 3 of 5/);

      await user.click(screen.getByRole("button", { name: "Next" }));

      expect(
        await screen.findByRole("region", { name: "Documents" }),
      ).toBeInTheDocument();
      // The CV slot is the whole point of the documents step.
      expect(screen.getByLabelText("CV / résumé")).toBeInTheDocument();
      expect(stepLine()).toMatch(/Step 4 of 5/);

      await user.click(screen.getByRole("button", { name: "Next" }));

      expect(
        await screen.findByRole("region", { name: "Consent" }),
      ).toBeInTheDocument();
      expect(stepLine()).toMatch(/Step 5 of 5/);
    });

    it("is operable from the keyboard, and the typing test starts with a keypress", async () => {
      const user = userEvent.setup();
      renderForm();
      await walkThroughPages(user);
      await screen.findByRole("region", { name: "Typing speed" });

      // AC-UI-04: no pointer-only affordance. Tab to the button and press it.
      const open = screen.getByRole("button", { name: /Take the typing test/ });
      open.focus();
      await user.keyboard("{Enter}");

      const input = await screen.findByLabelText("Typing test input");
      expect(input).toBeDisabled(); // armed by Start, not by focus
      await user.click(screen.getByRole("button", { name: "Start" }));
      expect(await screen.findByLabelText("Typing test input")).toBeEnabled();
    });
  });

  describe("both flags off", () => {
    beforeEach(() => {
      installFetchMock({ hasTypingTest: false, hasDocumentsStep: false });
    });

    it("shows neither step, and the step order is unchanged", async () => {
      const user = userEvent.setup();
      renderForm();

      // 2 canvas pages + consent, exactly as before this change.
      await screen.findByLabelText(/First name/);
      expect(stepLine()).toMatch(/Step 1 of 3/);

      await walkThroughPages(user);

      // Straight from the last page to Consent.
      expect(
        await screen.findByRole("region", { name: "Consent" }),
      ).toBeInTheDocument();
      expect(stepLine()).toMatch(/Step 3 of 3/);
      expect(
        screen.queryByRole("region", { name: "Typing speed" }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole("region", { name: "Documents" }),
      ).not.toBeInTheDocument();
      expect(screen.queryByLabelText("CV / résumé")).not.toBeInTheDocument();
    });

    it("still posts empty typingAttempts and files, as the server's guards require", async () => {
      const user = userEvent.setup();
      renderForm();
      await walkThroughPages(user);
      await screen.findByRole("region", { name: "Consent" });

      // No session is created just by filling the form in.
      expect(sessionCalls).toBe(0);

      await user.click(screen.getByRole("checkbox"));
      await user.click(screen.getByRole("button", { name: "Submit" }));

      await screen.findByText("Thank you");
      expect(submittedBodies).toHaveLength(1);
      const body = submittedBodies[0]!;
      expect(body["typingAttempts"]).toEqual([]);
      expect(body["files"]).toEqual([]);
      expect(body["sessionId"]).toBe(SESSION_ID);
      expect(body["consentToShareProfile"]).toBe(true);
      expect(sessionCalls).toBe(1);
    });

    it("does not let Next skip a required field", async () => {
      const user = userEvent.setup();
      renderForm();
      await screen.findByLabelText(/First name/);

      await user.click(screen.getByRole("button", { name: "Next" }));

      expect(stepLine()).toMatch(/Step 1 of 3/);
      expect(screen.getByLabelText(/First name/)).toBeInTheDocument();
    });
  });

  describe("consent copy", () => {
    beforeEach(() => {
      installFetchMock({ hasTypingTest: true, hasDocumentsStep: true });
    });

    /**
     * /register and /f/:slug render the same seeded form and used to disagree
     * about what the candidate was agreeing to — this renderer had its own
     * shorter wording ("...may share my profile with prospective clients")
     * with none of the explanation. Both now render ConsentStep.
     */
    it("matches the wording /register shows", async () => {
      const user = userEvent.setup();
      renderForm();
      await walkThroughPages(user);
      await user.click(screen.getByRole("button", { name: "Next" }));
      await user.click(screen.getByRole("button", { name: "Next" }));

      await screen.findByRole("region", { name: "Consent" });
      expect(
        screen.getByRole("heading", { name: "How we use your information" }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          /may store my information and share my profile with client companies when putting me forward for a role/,
        ),
      ).toBeInTheDocument();
    });
  });
});
