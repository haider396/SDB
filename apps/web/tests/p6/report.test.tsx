/**
 * P6 — /admin/reports/rejection-reasons (AC-PL-15 spirit): the required
 * from/to range defaults to the last 90 days and always reaches the query
 * string, filters map to `actor` / `roleCategoryId` params, rows render
 * split by actor with expandable "Other" free texts, and the CSV export
 * carries the exact grouped rows.
 */
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));
import {
  buildRejectionReasonsCsv,
  defaultReportRange,
  groupReasons,
} from "@/features/admin-dashboard/rejection-reasons-report";
import {
  installDashboardApiMock,
  makeDashboardState,
  makeReport,
  makeReportRow,
  makeRoleCategory,
  renderDashboardPage,
  type DashboardApiMock,
} from "./helpers";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("rejection-reasons report page", () => {
  it("always sends the REQUIRED from/to, defaulting to the last 90 days", async () => {
    const mock: DashboardApiMock = installDashboardApiMock(
      makeDashboardState(),
    );
    renderDashboardPage("/admin/reports/rejection-reasons");

    await waitFor(() => {
      const request = mock.requests.find(
        (entry) => entry.pathname === "/api/v1/reports/rejection-reasons",
      );
      expect(request).toBeDefined();
      const { fromDay, toDay } = defaultReportRange();
      expect(request?.search.get("from")).toBe(`${fromDay}T00:00:00.000Z`);
      expect(request?.search.get("to")).toBe(`${toDay}T23:59:59.999Z`);
      // Optional filters are ABSENT until chosen, never empty strings.
      expect(request?.search.get("actor")).toBeNull();
      expect(request?.search.get("roleCategoryId")).toBeNull();
    });
  });

  it("maps the actor and role-category filters to query params", async () => {
    const roleCategory = makeRoleCategory("Executive Assistant");
    const mock = installDashboardApiMock(
      makeDashboardState({ roleCategories: [roleCategory] }),
    );
    renderDashboardPage("/admin/reports/rejection-reasons");
    await screen.findByLabelText("Rejected by");

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText("Rejected by"), "client");
    await user.selectOptions(
      screen.getByLabelText("Role category"),
      roleCategory.id,
    );

    await waitFor(() => {
      const request = [...mock.requests]
        .reverse()
        .find(
          (entry) => entry.pathname === "/api/v1/reports/rejection-reasons",
        );
      expect(request?.search.get("actor")).toBe("client");
      expect(request?.search.get("roleCategoryId")).toBe(roleCategory.id);
    });
  });

  it("blocks the range and warns when a date is cleared", async () => {
    installDashboardApiMock(makeDashboardState());
    renderDashboardPage("/admin/reports/rejection-reasons");
    const fromInput = await screen.findByLabelText("From");

    const user = userEvent.setup();
    await user.clear(fromInput);

    expect(
      screen.getByText("Both From and To dates are required."),
    ).toBeInTheDocument();
  });

  it("renders reasons split by actor and expands the Other free texts", async () => {
    const report = makeReport([
      makeReportRow({
        actor: "client",
        reasonKey: "skills_gap",
        label: "Skills gap",
        count: 5,
      }),
      makeReportRow({
        actor: "admin",
        reasonKey: "skills_gap",
        label: "Skills gap",
        count: 2,
      }),
      makeReportRow({
        actor: "client",
        reasonKey: "other",
        label: "Other",
        count: 2,
        reasonId: null,
        otherTexts: ["Wanted more overlap", "Slow replies"],
      }),
    ]);
    installDashboardApiMock(makeDashboardState({ report }));
    renderDashboardPage("/admin/reports/rejection-reasons");

    // Both actors' counts appear on the grouped Skills-gap row.
    const skillsRow = (
      await screen.findByRole("rowheader", { name: "Skills gap" })
    ).closest("tr");
    expect(skillsRow).not.toBeNull();
    expect(within(skillsRow as HTMLElement).getByText("5")).toBeInTheDocument();
    expect(within(skillsRow as HTMLElement).getByText("2")).toBeInTheDocument();
    expect(within(skillsRow as HTMLElement).getByText("7")).toBeInTheDocument();

    // The Other group starts collapsed and expands to its free texts.
    expect(screen.queryByText("Wanted more overlap")).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /Other/ }));
    expect(screen.getByText("Wanted more overlap")).toBeInTheDocument();
    expect(screen.getByText("Slow replies")).toBeInTheDocument();
  });

  it("exports the report as CSV via a Blob download", async () => {
    const report = makeReport([
      makeReportRow({
        actor: "client",
        reasonKey: "skills_gap",
        label: "Skills gap",
        count: 5,
      }),
    ]);
    installDashboardApiMock(makeDashboardState({ report }));

    const createObjectURL = vi.fn((_blob: Blob) => "blob:mock");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL }));
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => undefined);

    renderDashboardPage("/admin/reports/rejection-reasons");
    const button = await screen.findByRole("button", { name: "Export CSV" });
    await waitFor(() => expect(button).toBeEnabled());

    const user = userEvent.setup();
    await user.click(button);

    expect(clickSpy).toHaveBeenCalledOnce();
    expect(createObjectURL).toHaveBeenCalledOnce();
    const blob = createObjectURL.mock.calls[0]?.[0];
    expect(blob).toBeInstanceOf(Blob);
    // jsdom's Blob has no .text(); FileReader is its supported read path.
    const text = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(new Error("read failed"));
      reader.readAsText(blob as Blob);
    });
    expect(text).toBe(buildRejectionReasonsCsv(report));
    clickSpy.mockRestore();
  });
});

describe("report helpers", () => {
  it("groupReasons merges actors per reason, ordered by total desc", () => {
    const groups = groupReasons([
      makeReportRow({
        actor: "client",
        reasonKey: "skills_gap",
        label: "Skills gap",
        count: 2,
      }),
      makeReportRow({
        actor: "admin",
        reasonKey: "skills_gap",
        label: "Skills gap",
        count: 1,
      }),
      makeReportRow({
        actor: "admin",
        reasonKey: "other",
        label: "Other",
        count: 4,
        reasonId: null,
        otherTexts: ["Duplicate profile"],
      }),
    ]);
    expect(groups.map((group) => group.label)).toEqual(["Other", "Skills gap"]);
    expect(groups[1]?.countByActor).toEqual({ admin: 1, client: 2 });
    expect(groups[1]?.total).toBe(3);
    expect(groups[0]?.otherTextsByActor.admin).toEqual(["Duplicate profile"]);
  });

  it("buildRejectionReasonsCsv emits one quoted RFC-4180 line per row", () => {
    const report = makeReport([
      makeReportRow({
        actor: "client",
        reasonKey: "salary_mismatch",
        label: "Salary, or \"rate\" mismatch",
        count: 3,
      }),
      makeReportRow({
        actor: "admin",
        reasonKey: "other",
        label: "Other",
        count: 1,
        reasonId: null,
        otherTexts: ["Left the market"],
      }),
    ]);
    expect(buildRejectionReasonsCsv(report)).toBe(
      "actor,reasonKey,label,count,otherTexts\r\n" +
        'client,salary_mismatch,"Salary, or ""rate"" mismatch",3,\r\n' +
        "admin,other,Other,1,Left the market\r\n",
    );
  });
});
