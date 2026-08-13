/**
 * AC-RQ-06 on the front end: commercial keys are ABSENT (not null) for
 * callers without requisition.view_commercials. The list must not render a
 * budget column and the detail must not render the budget fieldset — and
 * neither may crash. With the keys present, both appear.
 */
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  installApiMock,
  makeClient,
  makeDetail,
  makeRequisition,
  makeState,
  renderAdmin,
  withCommercials,
} from "./helpers";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("commercial field gating", () => {
  it("hides the budget column when the keys are absent from every row", async () => {
    const client = makeClient({ companyName: "Acme Corp" });
    const requisition = makeRequisition({
      clientId: client.id,
      clientName: client.companyName,
    });
    installApiMock(
      makeState({ clients: [client], requisitions: [requisition] }),
    );
    renderAdmin("/admin/requisitions");

    expect(await screen.findByText(requisition.reference)).toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: /budget/i }),
    ).not.toBeInTheDocument();
  });

  it("shows the budget column with formatted amounts when the keys exist", async () => {
    const client = makeClient({ companyName: "Acme Corp" });
    const requisition = withCommercials(
      makeRequisition({
        clientId: client.id,
        clientName: client.companyName,
      }),
    );
    installApiMock(
      makeState({ clients: [client], requisitions: [requisition] }),
    );
    renderAdmin("/admin/requisitions");

    expect(
      await screen.findByRole("columnheader", { name: /budget/i }),
    ).toBeInTheDocument();
    // MoneyFigure: emphasized amount + muted currency/unit suffix.
    expect(screen.getByText("1,500–2,500")).toBeInTheDocument();
    expect(screen.getByText("USD / month")).toBeInTheDocument();
  });

  it("omits the budget fieldset on the detail without crashing", async () => {
    const client = makeClient({ companyName: "Acme Corp" });
    const requisition = makeRequisition({
      clientId: client.id,
      clientName: client.companyName,
    });
    const detail = makeDetail(requisition);
    installApiMock(
      makeState({
        clients: [client],
        requisitions: [requisition],
        detailsById: { [requisition.id]: detail },
      }),
    );
    renderAdmin(`/admin/requisitions/${requisition.id}`);

    // The rest of the fields editor renders…
    expect(await screen.findByLabelText("Headcount")).toBeInTheDocument();
    // …but nothing commercial does.
    expect(screen.queryByText("Budget")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Minimum")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Unit")).not.toBeInTheDocument();
  });

  it("renders the budget fieldset when the detail carries the keys", async () => {
    const client = makeClient({ companyName: "Acme Corp" });
    const requisition = withCommercials(
      makeRequisition({
        clientId: client.id,
        clientName: client.companyName,
      }),
    );
    const detail = makeDetail(requisition);
    installApiMock(
      makeState({
        clients: [client],
        requisitions: [requisition],
        detailsById: { [requisition.id]: detail },
      }),
    );
    renderAdmin(`/admin/requisitions/${requisition.id}`);

    expect(await screen.findByLabelText("Minimum")).toHaveValue(1500);
    expect(screen.getByLabelText("Maximum")).toHaveValue(2500);
    expect(screen.getByLabelText("Unit")).toHaveValue("monthly");
    expect(screen.getByLabelText("Currency")).toHaveValue("USD");
  });
});
