/**
 * One presented candidate, collapsed to a single row.
 *
 * Rebecca, 13 Aug: *"there could be a potential where you have one title of a
 * position, but you're hiring three of that position… you might have 12 to 20
 * candidates here. And to be able to see all of those is a little bit
 * overwhelming with the expanded cards."*
 *
 * So this is the scanning view. It carries no decisions of its own — pressing
 * a row opens the FULL CandidateCard in a sheet, and every action still lives
 * there. That is deliberate: duplicating the stage-specific buttons here would
 * let the two views drift, and a client would eventually see one set of
 * choices in the list and another in the card.
 *
 * ⚠ Like CandidateCard, this renders a ClientVisibleAssignment row — the 02
 * §11 view shape — and NOTHING else, so it structurally cannot leak internal
 * data. The client-visibility gate and the PII gate are enforced in SQL
 * (CLAUDE.md invariants 2-3); nothing here may reach past that row for a field
 * the view withheld.
 */
import { ChevronRight } from "lucide-react";
import type { ClientVisibleAssignment } from "@sdb/contracts";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";
import { countryFlag } from "@/features/candidates/labels";
import { isMutedStage } from "../labels";
import { ClientStageBadge } from "./candidate-card";

/**
 * The row's DOM id, so the sheet can hand focus back to it on close.
 *
 * Radix restores focus by itself only when the opener is its own
 * SheetTrigger. This row drives `open` as state instead — one sheet is shared
 * by the whole list rather than one per row — so the restore has to be done
 * by hand, and it needs a way to find the button again after the sheet has
 * closed and re-rendered. Without it focus falls to <body> and a keyboard
 * user reviewing twenty candidates is returned to the top of the page after
 * every one.
 */
export function candidateRowId(assignmentId: string): string {
  return `candidate-row-${assignmentId}`;
}

export interface CandidateRowProps {
  row: ClientVisibleAssignment;
  onOpen: (row: ClientVisibleAssignment) => void;
}

export function CandidateRow({ row, onOpen }: CandidateRowProps) {
  const isMuted = isMutedStage(row.stage);
  const flag = countryFlag(row.country);
  const location = [row.city, row.regionState, row.country]
    .filter((part): part is string => part !== null && part !== "")
    .join(", ");

  return (
    <li>
      {/*
        A real button, not a clickable div: it has to be reachable by Tab and
        activate on Enter and Space without any handler of ours (AC-UI-04).
        The accessible name says what pressing it DOES, because "Maria
        Gonzalez" alone tells a screen-reader user nothing about the action.
      */}
      <button
        type="button"
        id={candidateRowId(row.assignmentId)}
        onClick={() => onOpen(row)}
        aria-label={`Review ${row.displayName}`}
        className={cn(
          "flex w-full items-center gap-3 rounded-lg border border-neutral-200 bg-surface-raised px-4 py-3 text-left transition-colors duration-fast",
          "hover:border-brand-blue hover:bg-brand-blue-subtle",
          "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue",
          isMuted && "opacity-70",
        )}
      >
        {row.photoUrl !== null ? (
          // photoUrl is a 300 s signed URL, resolved at render time only.
          <img
            src={row.photoUrl}
            alt=""
            className="h-9 w-9 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-blue-subtle text-sm font-semibold text-brand-blue"
          >
            {row.displayName.charAt(0)}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold text-brand-navy-ink">
            {flag !== null ? `${flag} ` : ""}
            {row.displayName}
          </p>
          {row.currentTitle !== null || location !== "" ? (
            <p className="truncate text-xs text-neutral-500">
              {row.currentTitle ?? ""}
              {row.currentTitle !== null && location !== "" ? " · " : ""}
              {location}
            </p>
          ) : null}
        </div>

        {/* The one thing worth surfacing without opening the row: that this
            candidate is waiting on the client rather than on us. */}
        {row.interviewRequestedAt !== null ? (
          <Chip tone="success" size="sm">
            Interview requested
          </Chip>
        ) : null}

        <ClientStageBadge stage={row.stage} />

        <ChevronRight
          aria-hidden="true"
          className="h-4 w-4 shrink-0 text-neutral-400"
        />
      </button>
    </li>
  );
}
