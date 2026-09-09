/**
 * Who owns the machine key.
 *
 * The Key field auto-fills from the label as a PREVIEW. Sending that preview
 * made the server treat a generated key as one the admin had chosen: creating a
 * second question called "Occupation" was refused outright ("A question with
 * key 'occupation' already exists") instead of quietly becoming occupation_2.
 *
 * Only the server can see every key already taken — including keys held by
 * archived questions, which keep them forever — so the rule is: send the key
 * only when a human actually typed one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  installApiMock,
  makeCategory,
  makeQuestion,
  renderQuestionManager,
  type ApiMock,
  type ServerState,
} from "./helpers";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

/** The body of the POST /questions the editor sent, if any. */
function createBody(api: ApiMock): Record<string, unknown> | undefined {
  return api.requests.find(
    (request) =>
      request.method === "POST" && request.pathname.endsWith("/questions"),
  )?.body as Record<string, unknown> | undefined;
}

async function openNewQuestion(): Promise<ReturnType<typeof userEvent.setup>> {
  const user = userEvent.setup();
  await user.click(await screen.findByRole("button", { name: "New question" }));
  await screen.findByLabelText("Label");
  return user;
}

describe("the machine key is the server's to choose", () => {
  let api: ApiMock;

  beforeEach(() => {
    const category = makeCategory({ key: "company_context", label: "Company" });
    const state: ServerState = {
      categories: [category],
      questions: [
        makeQuestion({
          key: "occupation",
          categoryId: category.id,
          label: "Occupation",
        }),
      ],
    };
    api = installApiMock(state);
    renderQuestionManager();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("omits the key when it was only auto-filled from the label", async () => {
    const user = await openNewQuestion();
    await user.type(screen.getByLabelText("Label"), "Occupation");

    // The preview is still shown — it just is not sent.
    await waitFor(() => {
      expect(screen.getByLabelText("Key")).toHaveValue("occupation");
    });

    await user.click(screen.getByRole("button", { name: "Create question" }));

    await waitFor(() => {
      expect(createBody(api)).toBeDefined();
    });
    const body = createBody(api);
    expect(body?.label).toBe("Occupation");
    expect("key" in (body ?? {})).toBe(false);
  });

  it("sends the key when a human typed one", async () => {
    const user = await openNewQuestion();
    await user.type(screen.getByLabelText("Label"), "Occupation");

    const keyField = screen.getByLabelText("Key");
    await user.clear(keyField);
    await user.type(keyField, "job_title_v2");

    await user.click(screen.getByRole("button", { name: "Create question" }));

    await waitFor(() => {
      expect(createBody(api)).toBeDefined();
    });
    // A deliberate key is honoured — and if it collides, the server says so
    // rather than silently renaming what the admin asked for.
    expect(createBody(api)?.key).toBe("job_title_v2");
  });

  it("stops overwriting a typed key when the label changes afterwards", async () => {
    const user = await openNewQuestion();
    await user.type(screen.getByLabelText("Label"), "Occupation");

    const keyField = screen.getByLabelText("Key");
    await user.clear(keyField);
    await user.type(keyField, "chosen_key");
    await user.type(screen.getByLabelText("Label"), " updated");

    expect(keyField).toHaveValue("chosen_key");
  });
});
