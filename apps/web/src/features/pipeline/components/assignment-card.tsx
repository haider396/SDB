/**
 * One candidate card on the pipeline board (05 §4.7): photo/initials,
 * display name, country flag, English + accent chips, days-in-stage, a
 * consent warning on unpresentable vetted cards, a drag handle, and an
 * overflow menu that doubles as the keyboard path ("Advance to…" lists only
 * machine-legal targets).
 *
 * Photo and English/accent chips hydrate from the shared candidate-detail
 * cache — the admin assignment row's candidate summary does not carry them.
 * Days-in-stage derives from `updatedAt`: an APPROXIMATION (the row has no
 * per-stage timestamp and updatedAt moves on any write), flagged in the
 * tooltip so admins don't over-trust it.
 */
import { useDraggable } from "@dnd-kit/core";
import { AlertTriangle, GripVertical } from "lucide-react";
import { useNavigate } from "react-router-dom";
import type {
  AdminAssignmentRow,
  AssignmentStage,
  CandidateDetail,
} from "@sdb/contracts";
import { cn } from "@/lib/utils";
import { daysSince } from "@/lib/format";
import {
  ACCENT_LABELS,
  LANGUAGE_LEVEL_LABELS,
  countryFlag,
} from "@/features/candidates/labels";
import { menuAdvanceTargets } from "../stage-machine";
import { STAGE_LABELS } from "../labels";
import { CardMenu, type CardMenuItem } from "./card-menu";

export interface CardActions {
  onAdvance: (row: AdminAssignmentRow, toStage: AssignmentStage) => void;
  onAddNote: (row: AdminAssignmentRow) => void;
  onReject: (row: AdminAssignmentRow) => void;
  onPlace: (row: AdminAssignmentRow) => void;
}

export interface AssignmentCardProps {
  row: AdminAssignmentRow;
  candidate: CandidateDetail | undefined;
  actions: CardActions;
  /** Multi-select mode is active on this card's column (vetted only). */
  isSelectable: boolean;
  isSelected: boolean;
  onToggleSelect: (assignmentId: string) => void;
  /** Terminal-rail rendering disables drag affordances. */
  isDraggable: boolean;
}

function initialsOf(row: AdminAssignmentRow): string {
  const first = row.candidate.firstName.charAt(0);
  const last = row.candidate.lastName.charAt(0);
  return `${first}${last}`.toUpperCase();
}

export function AssignmentCard({
  row,
  candidate,
  actions,
  isSelectable,
  isSelected,
  onToggleSelect,
  isDraggable,
}: AssignmentCardProps) {
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } =
    useDraggable({
      id: row.id,
      data: { stage: row.stage },
      disabled: !isDraggable,
    });

  const name = row.candidate.displayName;
  const flag = countryFlag(row.candidate.country);
  const days = daysSince(row.updatedAt);
  const consentMissing =
    row.stage === "vetted" && !row.candidate.hasConsentToShareProfile;

  const menuItems: CardMenuItem[] = [
    {
      key: "view",
      label: "View candidate",
      onSelect: () => navigate(`/admin/candidates/${row.candidateId}`),
    },
    ...menuAdvanceTargets(row.stage).map(
      (target): CardMenuItem => ({
        key: `advance-${target}`,
        label: `Advance to ${STAGE_LABELS[target]}`,
        onSelect: () => actions.onAdvance(row, target),
      }),
    ),
    {
      key: "note",
      label: "Add note",
      onSelect: () => actions.onAddNote(row),
    },
    ...(row.stage === "offer"
      ? [
          {
            key: "place",
            label: "Place…",
            onSelect: () => actions.onPlace(row),
          } satisfies CardMenuItem,
        ]
      : []),
    ...(menuAdvanceTargets(row.stage).length > 0 || row.stage === "offer"
      ? [
          {
            key: "reject",
            label: "Reject…",
            destructive: true,
            onSelect: () => actions.onReject(row),
          } satisfies CardMenuItem,
        ]
      : []),
  ];

  return (
    <div
      ref={setNodeRef}
      data-assignment-id={row.id}
      className={cn(
        "rounded-md border border-border-default bg-surface-raised p-3 shadow-xs",
        isDragging && "opacity-40",
      )}
    >
      <div className="flex items-start gap-2">
        {isDraggable ? (
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label={`Drag ${name} to another stage`}
            className="mt-0.5 cursor-grab touch-none rounded-sm p-0.5 text-neutral-400 hover:text-neutral-700"
            {...attributes}
            {...listeners}
          >
            <GripVertical aria-hidden="true" className="h-4 w-4" />
          </button>
        ) : null}

        {isSelectable ? (
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 accent-current"
            checked={isSelected}
            onChange={() => onToggleSelect(row.id)}
            aria-label={`Select ${name} for presentation`}
          />
        ) : null}

        {candidate?.photoPath != null ? (
          <img
            src={candidate.photoPath}
            alt=""
            className="h-8 w-8 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-blue-subtle text-xs font-semibold text-brand-blue"
          >
            {initialsOf(row)}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-brand-navy-ink">
            {flag !== null ? (
              <span
                role="img"
                aria-label={row.candidate.country ?? "Country"}
                title={row.candidate.country ?? undefined}
                className="mr-1"
              >
                {flag}
              </span>
            ) : null}
            {name}
          </p>
          {row.candidate.currentTitle !== null ? (
            <p className="truncate text-xs text-neutral-500">
              {row.candidate.currentTitle}
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-1">
          {consentMissing ? (
            <span
              className="text-warning-text"
              title="Consent to share profile is missing — cannot be presented"
            >
              <AlertTriangle aria-hidden="true" className="h-4 w-4" />
              <span className="sr-only">
                Consent missing — cannot be presented
              </span>
            </span>
          ) : null}
          <CardMenu label={`Actions for ${name}`} items={menuItems} />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {candidate?.englishSpokenLevel != null ? (
          <span className="inline-flex rounded-full bg-info-subtle px-2 py-0.5 text-[11px] font-medium text-info">
            {LANGUAGE_LEVEL_LABELS[candidate.englishSpokenLevel]} English
          </span>
        ) : null}
        {candidate?.accentStrength != null ? (
          <span className="inline-flex rounded-full bg-neutral-100 px-2 py-0.5 text-[11px] font-medium text-neutral-600">
            {ACCENT_LABELS[candidate.accentStrength]}
          </span>
        ) : null}
        <span
          className="ml-auto text-[11px] tabular-nums text-neutral-500"
          title="Approximate — derived from the assignment's last update, not a per-stage timestamp"
        >
          {days}d in stage
        </span>
      </div>
    </div>
  );
}
