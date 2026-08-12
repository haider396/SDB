/**
 * Pins the web copy of the assignment stage machine against a literal of
 * the API's map (apps/api/src/services/state-machines.ts — contracts does
 * not export it, so the copy is snapshot-tested here; AC-PL-01 keeps the
 * server authoritative). Also unit-tests the pure drop-target legality
 * helpers that drive the board's disabled-during-drag behaviour (05 §4.7).
 */
import { describe, expect, it } from "vitest";
import type { AssignmentStage } from "@sdb/contracts";
import { AssignmentStageSchema } from "@sdb/contracts";
import {
  ASSIGNMENT_TRANSITIONS,
  BOARD_STAGES,
  TERMINAL_STAGES,
  allowedTargets,
  canAdvance,
  columnDropState,
  isTerminalStage,
  menuAdvanceTargets,
} from "@/features/pipeline/stage-machine";

/** Literal copy of apps/api/src/services/state-machines.ts. */
const API_ASSIGNMENT_TRANSITIONS: Record<AssignmentStage, AssignmentStage[]> = {
  sourced: ["screened", "rejected_by_admin", "withdrawn", "closed_not_selected"],
  screened: ["vetted", "rejected_by_admin", "withdrawn", "closed_not_selected"],
  vetted: ["presented", "rejected_by_admin", "withdrawn", "closed_not_selected"],
  presented: [
    "client_reviewing",
    "rejected_by_admin",
    "rejected_by_client",
    "withdrawn",
    "closed_not_selected",
  ],
  client_reviewing: [
    "interview_scheduled",
    "rejected_by_admin",
    "rejected_by_client",
    "withdrawn",
    "closed_not_selected",
  ],
  interview_scheduled: [
    "interviewed",
    "rejected_by_admin",
    "withdrawn",
    "closed_not_selected",
  ],
  interviewed: [
    "offer",
    "rejected_by_admin",
    "rejected_by_client",
    "withdrawn",
    "closed_not_selected",
  ],
  offer: ["placed", "rejected_by_admin", "withdrawn", "closed_not_selected"],
  placed: [],
  rejected_by_admin: [],
  rejected_by_client: [],
  withdrawn: [],
  closed_not_selected: [],
};

describe("assignment stage machine (web copy)", () => {
  it("matches the API's ASSIGNMENT_TRANSITIONS map exactly", () => {
    expect(ASSIGNMENT_TRANSITIONS).toEqual(API_ASSIGNMENT_TRANSITIONS);
  });

  it("covers every stage of the contracts enum, with no extras", () => {
    expect(Object.keys(ASSIGNMENT_TRANSITIONS).sort()).toEqual(
      [...AssignmentStageSchema.options].sort(),
    );
    expect(
      [...BOARD_STAGES, ...TERMINAL_STAGES].sort(),
    ).toEqual([...AssignmentStageSchema.options].sort());
  });

  it("gives terminal stages no outbound transitions", () => {
    for (const stage of TERMINAL_STAGES) {
      expect(allowedTargets(stage)).toEqual([]);
      expect(isTerminalStage(stage)).toBe(true);
    }
    expect(allowedTargets("placed")).toEqual([]);
  });

  it("canAdvance follows the map edges", () => {
    expect(canAdvance("sourced", "screened")).toBe(true);
    expect(canAdvance("sourced", "vetted")).toBe(false);
    expect(canAdvance("vetted", "presented")).toBe(true);
    expect(canAdvance("vetted", "client_reviewing")).toBe(false);
    expect(canAdvance("offer", "placed")).toBe(true);
    expect(canAdvance("interview_scheduled", "rejected_by_client")).toBe(false);
    expect(canAdvance("placed", "offer")).toBe(false);
  });

  describe("columnDropState (drop-target legality per stage)", () => {
    it("is idle when nothing is dragged", () => {
      for (const stage of BOARD_STAGES) {
        expect(columnDropState(null, stage)).toBe("idle");
      }
    });

    it("marks the dragged card's own column as origin", () => {
      expect(columnDropState("vetted", "vetted")).toBe("origin");
    });

    it("computes valid vs disabled for every column while dragging", () => {
      // Dragging a sourced card: only screened is a valid board target.
      const states = BOARD_STAGES.map((stage) => [
        stage,
        columnDropState("sourced", stage),
      ]);
      expect(states).toEqual([
        ["sourced", "origin"],
        ["screened", "valid"],
        ["vetted", "disabled"],
        ["presented", "disabled"],
        ["client_reviewing", "disabled"],
        ["interview_scheduled", "disabled"],
        ["interviewed", "disabled"],
        ["offer", "disabled"],
        ["placed", "disabled"],
      ]);
    });

    it("dragging an offer card enables only the placed column", () => {
      expect(columnDropState("offer", "placed")).toBe("valid");
      expect(columnDropState("offer", "interviewed")).toBe("disabled");
      expect(columnDropState("offer", "sourced")).toBe("disabled");
    });
  });

  describe("menuAdvanceTargets (keyboard path)", () => {
    it("excludes rejections, placed, and closed_not_selected", () => {
      expect(menuAdvanceTargets("vetted")).toEqual(["presented", "withdrawn"]);
      expect(menuAdvanceTargets("offer")).toEqual(["withdrawn"]);
      expect(menuAdvanceTargets("presented")).toEqual([
        "client_reviewing",
        "withdrawn",
      ]);
    });

    it("is empty for terminal stages", () => {
      for (const stage of TERMINAL_STAGES) {
        expect(menuAdvanceTargets(stage)).toEqual([]);
      }
      expect(menuAdvanceTargets("placed")).toEqual([]);
    });
  });
});
