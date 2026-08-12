/**
 * In-portal second-hire intake (03 §3.5): the SAME form engine renders
 * authenticated, company/contact answers are prefilled from the client
 * record and read-only, and submission targets POST /requisitions — never
 * /intake-submissions.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Session } from "@supabase/supabase-js";

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    useSession: () => ({
      session: {} as unknown as Session,
      isLoading: false,
    }),
    getAccessToken: async () => "test-token",
  };
});

import {
  makeCategory,
  makeFormResponse,
  makeQuestion,
} from "../intake-form/helpers";
import {
  installClientPortalApiMock,
  makeClientRecord,
  makeMe,
  makeState,
  renderClientPortal,
} from "./helpers";

const ENGINE_ID = "00000000-0000-4000-8000-00000000e001";
const DEPARTMENT_ID = "00000000-0000-4000-8000-00000000d001";
const ROLE_CATEGORY_ID = "00000000-0000-4000-8000-00000000c001";

const taxonomy = {
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

const intakeForm = makeFormResponse([
  makeCategory({
    key: "company_context",
    label: "Company context",
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
        key: "contact_email",
        label: "Best contact email",
        questionType: "email",
        isRequired: true,
        sortOrder: 2,
      }),
      makeQuestion({
        key: "role_notes",
        label: "What will this hire own?",
        questionType: "short_text",
        isRequired: true,
        sortOrder: 3,
      }),
    ],
  }),
]);

function portalIntakeState() {
  const me = makeMe();
  const clientId = me.clientId ?? "";
  return makeState({
    me,
    client: makeClientRecord(clientId),
    taxonomy,
    intakeForm,
  });
}

async function fillRoleStep(user: ReturnType<typeof userEvent.setup>) {
  await user.selectOptions(
    await screen.findByLabelText(
      "Which part of your business is this hire for?",
    ),
    ENGINE_ID,
  );
  await user.selectOptions(screen.getByLabelText("Department"), DEPARTMENT_ID);
  await user.selectOptions(
    screen.getByLabelText("Role category"),
    ROLE_CATEGORY_ID,
  );
  await user.click(screen.getByRole("button", { name: "Next" }));
}

describe("in-portal intake", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("prefills company/contact questions read-only from the account", async () => {
    const user = userEvent.setup();
    installClientPortalApiMock(portalIntakeState());
    renderClientPortal("/client/requisitions/new");

    await fillRoleStep(user);

    const companyInput = await screen.findByLabelText("Company name");
    expect(companyInput).toHaveValue("Acme Corp");
    expect(companyInput).toHaveAttribute("readonly");

    const emailInput = screen.getByLabelText("Best contact email");
    expect(emailInput).toHaveValue("casey@acme.test");
    expect(emailInput).toHaveAttribute("readonly");

    expect(
      screen.getAllByText("Prefilled from your account and cannot be edited here."),
    ).toHaveLength(2);

    // The role question stays editable.
    expect(screen.getByLabelText(/what will this hire own/i)).not.toHaveAttribute(
      "readonly",
    );
  });

  it("submits to POST /requisitions with the prefilled and typed answers", async () => {
    const user = userEvent.setup();
    const { requests } = installClientPortalApiMock(portalIntakeState());
    renderClientPortal("/client/requisitions/new");

    await fillRoleStep(user);
    await user.type(
      await screen.findByLabelText(/what will this hire own/i),
      "Founder inbox and calendar.",
    );
    await user.click(screen.getByRole("button", { name: "Submit request" }));

    await waitFor(() => {
      const posted = requests.find(
        (request) =>
          request.method === "POST" &&
          request.pathname === "/api/v1/requisitions",
      );
      expect(posted).toBeDefined();
      expect(posted?.body).toMatchObject({
        formVersionHash: "sha256:test-hash",
        roleCategoryId: ROLE_CATEGORY_ID,
        answers: expect.arrayContaining([
          { questionKey: "company_name", valueText: "Acme Corp" },
          { questionKey: "contact_email", valueText: "casey@acme.test" },
          {
            questionKey: "role_notes",
            valueText: "Founder inbox and calendar.",
          },
        ]) as unknown,
      });
    });

    // The public endpoint is never used from the portal.
    expect(
      requests.some((request) =>
        request.pathname.endsWith("/intake-submissions"),
      ),
    ).toBe(false);
  });
});
