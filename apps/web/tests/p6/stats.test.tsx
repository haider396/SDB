/**
 * P6 — /admin/stats: the three tiles map GET /admin/stats fields, the
 * null average reads as an em-dash, and the chart data mapper keeps
 * pipeline order, zero-fills board stages, and hides zero terminal stages.
 */
import { cleanup, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({
  getAccessToken: async () => "test-token",
}));
import { stageChartData } from "@/features/admin-dashboard/components/stage-chart-data";
import {
  installDashboardApiMock,
  makeDashboardState,
  makeStats,
  renderDashboardPage,
} from "./helpers";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("stats page", () => {
  it("renders the three tiles from GET /admin/stats", async () => {
    installDashboardApiMock(
      makeDashboardState({
        stats: makeStats({
          openRequisitions: 7,
          activePlacements: 3,
          averageDaysToPresent: 4.25,
          candidatesByStage: { sourced: 5, presented: 2 },
        }),
      }),
    );
    renderDashboardPage("/admin/stats");

    expect(await screen.findByText("Open requisitions")).toBeInTheDocument();
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Active placements")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.getByText("Average days to present")).toBeInTheDocument();
    expect(screen.getByText("4.3")).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: "Candidates by stage" }),
    ).toBeInTheDocument();
  });

  it("a null average renders as an em-dash with its explanation", async () => {
    installDashboardApiMock(
      makeDashboardState({
        stats: makeStats({ averageDaysToPresent: null }),
      }),
    );
    renderDashboardPage("/admin/stats");

    expect(await screen.findByText("—")).toBeInTheDocument();
    expect(
      screen.getByText("Nothing presented in the last 90 days"),
    ).toBeInTheDocument();
  });

  it("shows the chart empty state when no assignments exist anywhere", async () => {
    installDashboardApiMock(
      makeDashboardState({ stats: makeStats({ candidatesByStage: {} }) }),
    );
    renderDashboardPage("/admin/stats");

    expect(
      await screen.findByText("No candidates in any pipeline"),
    ).toBeInTheDocument();
  });
});

describe("stageChartData", () => {
  it("zero-fills the nine board stages in pipeline order", () => {
    const rows = stageChartData({ vetted: 3, sourced: 1 });
    expect(rows.map((row) => row.stage)).toEqual([
      "sourced",
      "screened",
      "vetted",
      "presented",
      "client_reviewing",
      "interview_scheduled",
      "interviewed",
      "offer",
      "placed",
    ]);
    expect(rows[0]).toEqual({ stage: "sourced", label: "Sourced", count: 1 });
    expect(rows[1]?.count).toBe(0);
    expect(rows[2]?.count).toBe(3);
  });

  it("appends terminal stages only when non-zero, with display labels", () => {
    const rows = stageChartData({
      interviewed: 2,
      rejected_by_client: 4,
      withdrawn: 0,
    });
    const terminal = rows.slice(9);
    expect(terminal).toEqual([
      {
        stage: "rejected_by_client",
        label: "Rejected by client",
        count: 4,
      },
    ]);
    expect(rows.find((row) => row.stage === "interviewed")?.count).toBe(2);
  });
});
