/**
 * Grouping the client's positions list (T24).
 *
 * Rebecca, 38:40: *"let's think about what this looks like when they have,
 * they're hiring for 15 positions. We would want it to be able to be sorted at
 * the top based on alphabetical department… And Priority."*
 *
 * The two failures these exist to stop:
 *
 * 1. **Priority groups ordered alphabetically.** `high` sorts before `urgent`,
 *    so a naive sort puts the second-most-urgent group above the most urgent
 *    one — and a ranking that lies is worse than no ranking.
 * 2. **A position disappearing.** Anything without a department, or with one
 *    the label lookup cannot resolve, must still be on the page. A list
 *    someone uses to check on their hires must never quietly drop one.
 */
import { describe, expect, it } from "vitest";
import type { Requisition } from "@sdb/contracts";
import { groupPositions } from "@/features/client-portal/grouping";

const DEPARTMENTS = {
  "dept-ea": "Executive Assistance",
  "dept-cx": "Client Experience",
};

function position(overrides: Partial<Requisition> = {}): Requisition {
  return {
    id: `req-${Math.random().toString(36).slice(2)}`,
    advertisedTitle: "A role",
    priority: "normal",
    departmentId: null,
    ...overrides,
  } as unknown as Requisition;
}

describe("grouping positions", () => {
  it("returns one unlabelled group when grouping is off", () => {
    const rows = [position(), position(), position()];
    const groups = groupPositions(rows, "none", DEPARTMENTS);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("");
    expect(groups[0]?.positions).toHaveLength(3);
  });

  it("orders departments alphabetically, as she asked", () => {
    const rows = [
      position({ departmentId: "dept-ea" }),
      position({ departmentId: "dept-cx" }),
    ];
    const groups = groupPositions(rows, "department", DEPARTMENTS);
    expect(groups.map((g) => g.label)).toEqual([
      "Client Experience",
      "Executive Assistance",
    ]);
  });

  it("orders priority by RANK, never alphabetically", () => {
    // The whole point. Alphabetically this is high < low < normal < urgent,
    // which would put "High priority" above "Urgent".
    const rows = [
      position({ priority: "normal" }),
      position({ priority: "urgent" }),
      position({ priority: "low" }),
      position({ priority: "high" }),
    ];
    const groups = groupPositions(rows, "priority", DEPARTMENTS);
    expect(groups.map((g) => g.label)).toEqual([
      "Urgent",
      "High priority",
      "Normal",
      "Low priority",
    ]);
  });

  it("keeps a position with no department, under Other", () => {
    const rows = [position({ departmentId: "dept-ea" }), position()];
    const groups = groupPositions(rows, "department", DEPARTMENTS);
    expect(groups.map((g) => g.label)).toEqual(["Executive Assistance", "Other"]);
    expect(groups.flatMap((g) => g.positions)).toHaveLength(2);
  });

  it("keeps a position whose department label cannot be resolved", () => {
    // The taxonomy request failed, or the department is new. The position
    // still has to be on the page — and it must not render a raw UUID.
    const rows = [position({ departmentId: "dept-unknown" })];
    const groups = groupPositions(rows, "department", DEPARTMENTS);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.label).toBe("Other");
    expect(groups[0]?.label).not.toContain("dept-unknown");
  });

  it("pins Other last, even when its name would sort first", () => {
    const rows = [position({ departmentId: "dept-ea" }), position()];
    const groups = groupPositions(rows, "department", DEPARTMENTS);
    // "Other" < "Executive Assistance" is false, but alphabetically "Other"
    // would land between other names — it is pinned instead.
    expect(groups.at(-1)?.label).toBe("Other");
  });

  it("never loses or duplicates a position", () => {
    const rows = [
      position({ departmentId: "dept-ea", priority: "urgent" }),
      position({ departmentId: "dept-cx" }),
      position(),
      position({ departmentId: "dept-ea", priority: "low" }),
    ];
    for (const mode of ["none", "department", "priority"] as const) {
      const flat = groupPositions(rows, mode, DEPARTMENTS).flatMap(
        (g) => g.positions,
      );
      expect(flat).toHaveLength(rows.length);
      expect(new Set(flat.map((p) => p.id)).size).toBe(rows.length);
    }
  });

  it("preserves the given order within a group", () => {
    // Grouping rearranges; it must never reshuffle a sequence someone has
    // already learned to read.
    const first = position({ departmentId: "dept-ea", advertisedTitle: "First" });
    const second = position({ departmentId: "dept-ea", advertisedTitle: "Second" });
    const groups = groupPositions([first, second], "department", DEPARTMENTS);
    expect(groups[0]?.positions.map((p) => p.advertisedTitle)).toEqual([
      "First",
      "Second",
    ]);
  });
});
