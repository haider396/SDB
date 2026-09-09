/**
 * Grouping the client's positions list — PURE, no React, no DOM.
 *
 * Rebecca, 13 Aug: *"Let's think about what this looks like when they have,
 * they're hiring for 15 positions. We would want it to be able to be sorted at
 * the top based on alphabetical department… And Priority."*
 *
 * "Sorted at the top" means HEADINGS, not a re-ordered flat list — at fifteen
 * positions the headings are what make the page readable, and that is what
 * Haider confirmed.
 *
 * ── Why this is safe to do in the browser ──────────────────────────────────
 * `CHANGE-REQUESTS-2026-08-13.md` T24 warns, in bold, that this list is
 * cursor-paginated and a client-side sort would break it. That is true of the
 * ADMIN list (`features/requisitions/requisitions-list-page.tsx`, which uses
 * useCursorPagination) and NOT of this one: `useClientRequisitions` follows the
 * cursor to the end and holds the whole array. Sorting a page of a paginated
 * list sorts only that page and looks like it worked, which is why the warning
 * exists — it just points at the other screen.
 *
 * ── Engine is absent on purpose ────────────────────────────────────────────
 * Rebecca asked for Engine, then removed it — *"Engine doesn't need to be seen
 * on this card"* — and reinstated it only *"unless we internally notate that
 * this client is using 5eOS"*. That flag (T25) is deferred pending a
 * conversation with her, so there is no "unless" and Engine stays out. Adding
 * it later is one entry in GROUP_BY_OPTIONS plus one `key` function.
 */
import { PRIORITY_RANK, type Requisition } from "@sdb/contracts";
import { priorityLabel } from "@/components/patterns/priority-chip";

export type GroupBy = "none" | "department" | "priority";

export const GROUP_BY_OPTIONS: readonly { value: GroupBy; label: string }[] = [
  { value: "none", label: "No grouping" },
  { value: "department", label: "Department" },
  { value: "priority", label: "Priority" },
];

export interface PositionGroup {
  /** Stable identity for a React key and the heading's id. */
  key: string;
  label: string;
  positions: Requisition[];
}

/**
 * Positions with no department collect here rather than disappearing. A list
 * someone uses to check on their hires must never silently drop one — that is
 * the failure that makes a screen untrustworthy.
 */
const UNGROUPED_KEY = "__ungrouped";
const UNGROUPED_LABEL = "Other";

/**
 * Department NAMES are not on the list payload — `RequisitionSchema` carries
 * only `departmentId`; the label lives on `RequisitionDetailSchema.taxonomy`,
 * which the list does not return. So the caller supplies a lookup built from
 * `GET /taxonomy/public`, and this stays pure.
 *
 * A label that cannot be resolved falls into "Other" rather than rendering a
 * UUID at a client — a heading reading `a3f9…` is worse than no heading.
 */
export type DepartmentLabels = Readonly<Record<string, string>>;

function departmentOf(
  position: Requisition,
  labels: DepartmentLabels,
): { key: string; label: string } {
  const id = position.departmentId;
  const label = id === null ? undefined : labels[id];
  if (label === undefined || label.trim() === "") {
    return { key: UNGROUPED_KEY, label: UNGROUPED_LABEL };
  }
  return { key: `department:${id ?? label}`, label };
}

/**
 * Group a client's positions under headings.
 *
 * Order WITHIN a group is the order given — the caller's existing sequence is
 * preserved, so grouping only ever rearranges, never reshuffles a list someone
 * has already learned to read.
 */
export function groupPositions(
  positions: readonly Requisition[],
  groupBy: GroupBy,
  departmentLabels: DepartmentLabels = {},
): PositionGroup[] {
  if (groupBy === "none") {
    return [{ key: "all", label: "", positions: [...positions] }];
  }

  const byKey = new Map<string, PositionGroup>();
  for (const position of positions) {
    const { key, label } =
      groupBy === "department"
        ? departmentOf(position, departmentLabels)
        : {
            key: `priority:${position.priority}`,
            label: priorityLabel(position.priority),
          };
    const existing = byKey.get(key);
    if (existing === undefined) {
      byKey.set(key, { key, label, positions: [position] });
    } else {
      existing.positions.push(position);
    }
  }

  const groups = [...byKey.values()];

  if (groupBy === "priority") {
    // By RANK, never alphabetically — a string sort gives
    // high < low < normal < urgent, which puts the second-most-urgent group
    // above the most urgent one and makes the grouping actively misleading.
    const rank = new Map(PRIORITY_RANK.map((value, index) => [`priority:${value}`, index]));
    return groups.sort(
      (a, b) => (rank.get(a.key) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.key) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  // Alphabetical, as she asked — with "Other" pinned last so a missing
  // department reads as a remainder rather than as a department called O.
  return groups.sort((a, b) => {
    if (a.key === UNGROUPED_KEY) return 1;
    if (b.key === UNGROUPED_KEY) return -1;
    return a.label.localeCompare(b.label);
  });
}
