/**
 * Sticky right rail for the candidate detail page (05 §4.1): photo +
 * reference, optimistic pool-status toggle, quick facts, and the archive
 * action (typed-name confirm, soft delete).
 */
import { Archive } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { CandidateDetail, PoolStatus } from "@sdb/contracts";
import { PoolStatusSchema } from "@sdb/contracts";
import { MoneyFigure } from "@/components/patterns/money-figure";
import { TypedConfirmDialog } from "@/components/patterns/typed-confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { ApiError } from "@/lib/api-client";
import { formatDate, rateParts } from "@/lib/format";
import { useArchiveCandidate, usePoolStatus, useTaxonomyOptions } from "../api";
import {
  ACCENT_LABELS,
  countryFlag,
  LANGUAGE_LEVEL_LABELS,
  POOL_STATUS_LABELS,
} from "../labels";
import { DataCompletenessBadge, VettingStatusBadge } from "./badges";

function initialsOf(candidate: CandidateDetail): string {
  return `${candidate.firstName.charAt(0)}${candidate.lastName.charAt(0)}`.toUpperCase();
}

export function ProfileRailCard({ candidate }: { candidate: CandidateDetail }) {
  const poolStatus = usePoolStatus(candidate.id);

  const onPoolChange = (next: PoolStatus) => {
    poolStatus.mutate(next, {
      onError: (cause) => {
        toast.error(
          cause instanceof ApiError
            ? cause.message
            : "Could not change the pool status — rolled back.",
        );
      },
    });
  };

  return (
    <Card>
      <CardContent className="pt-6">
        <div className="flex items-center gap-3">
          {candidate.photoUrl !== null ? (
            <img
              src={candidate.photoUrl}
              alt={`Photo of ${candidate.displayName}`}
              className="h-14 w-14 rounded-full object-cover"
            />
          ) : (
            <div
              aria-hidden="true"
              className="flex h-14 w-14 items-center justify-center rounded-full bg-brand-blue-subtle text-lg font-semibold text-brand-blue"
            >
              {initialsOf(candidate)}
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-brand-navy-ink">
              {candidate.displayName}
            </p>
            <p className="font-mono text-xs text-neutral-500">
              {candidate.reference}
            </p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <VettingStatusBadge status={candidate.vettingStatus} />
              <DataCompletenessBadge completeness={candidate.dataCompleteness} />
            </div>
          </div>
        </div>

        {/* Consent state must be visible without scrolling (UX 2.5) — the
            chip jumps to the consent card where it is captured. */}
        <div className="mt-3">
          <a
            href="#candidate-section-consent"
            onClick={(event) => {
              event.preventDefault();
              document
                .getElementById("candidate-section-consent")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
            className={
              candidate.hasConsentToShareProfile
                ? "inline-flex items-center gap-1 rounded-full bg-success-subtle px-2 py-0.5 text-2xs font-medium text-success-text hover:underline"
                : "inline-flex items-center gap-1 rounded-full bg-danger-subtle px-2 py-0.5 text-2xs font-medium text-danger-text hover:underline"
            }
          >
            {candidate.hasConsentToShareProfile
              ? "Consent captured"
              : "Consent missing"}
            <span className="sr-only"> — go to the consent section</span>
          </a>
        </div>

        <div className="mt-4 space-y-1.5">
          <Label htmlFor="rail-pool-status">Pool status</Label>
          <NativeSelect
            id="rail-pool-status"
            value={candidate.poolStatus}
            onChange={(event) => onPoolChange(event.target.value as PoolStatus)}
            disabled={candidate.archivedAt !== null}
          >
            {PoolStatusSchema.options.map((status) => (
              <option key={status} value={status}>
                {POOL_STATUS_LABELS[status]}
              </option>
            ))}
          </NativeSelect>
        </div>
      </CardContent>
    </Card>
  );
}

function FactRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="shrink-0 text-sm text-neutral-500">{label}</dt>
      <dd className="text-right text-sm text-neutral-800">{value}</dd>
    </div>
  );
}

export function QuickFactsCard({ candidate }: { candidate: CandidateDetail }) {
  const taxonomy = useTaxonomyOptions();
  const roleLabel =
    candidate.primaryRoleCategoryId !== null
      ? (taxonomy.data?.roleCategoryLabelById[candidate.primaryRoleCategoryId] ??
        "…")
      : "—";
  const flag = countryFlag(candidate.country);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Quick facts</CardTitle>
      </CardHeader>
      <CardContent>
        <dl>
          <FactRow
            label="Location"
            value={
              candidate.country !== null
                ? `${flag !== null ? `${flag} ` : ""}${candidate.country}${
                    candidate.city !== null ? ` · ${candidate.city}` : ""
                  }`
                : "—"
            }
          />
          <FactRow label="Role category" value={roleLabel} />
          <FactRow
            label="English (spoken)"
            value={
              candidate.englishSpokenLevel !== null
                ? LANGUAGE_LEVEL_LABELS[candidate.englishSpokenLevel]
                : "—"
            }
          />
          <FactRow
            label="Accent"
            value={
              candidate.accentStrength !== null
                ? ACCENT_LABELS[candidate.accentStrength]
                : "—"
            }
          />
          <FactRow
            label="Expected rate"
            value={
              <MoneyFigure
                parts={rateParts(
                  candidate.expectedRateAmount,
                  candidate.expectedRateUnit,
                  candidate.expectedRateCurrency,
                )}
              />
            }
          />
          <FactRow
            label="Available from"
            value={formatDate(candidate.availableFrom)}
          />
          <FactRow label="Added" value={formatDate(candidate.createdAt)} />
        </dl>
      </CardContent>
    </Card>
  );
}

export function ArchiveRailCard({ candidate }: { candidate: CandidateDetail }) {
  const navigate = useNavigate();
  const archiveCandidate = useArchiveCandidate();
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const fullName = `${candidate.firstName} ${candidate.lastName}`;

  if (candidate.archivedAt !== null) {
    return (
      <Card>
        <CardContent className="pt-6">
          <p className="text-sm text-neutral-500">
            Archived on {formatDate(candidate.archivedAt)}. The profile is kept
            but excluded from sourcing.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-neutral-500">
            Archiving removes the candidate from the active pool. Nothing is
            deleted.
          </p>
          <Button
            variant="destructive"
            size="sm"
            className="w-full"
            onClick={() => setIsConfirmOpen(true)}
          >
            <Archive aria-hidden="true" />
            Archive candidate
          </Button>
        </CardContent>
      </Card>

      <TypedConfirmDialog
        open={isConfirmOpen}
        onClose={() => setIsConfirmOpen(false)}
        title={`Archive ${fullName}?`}
        description="The candidate is removed from the active pool and from search results. The profile and its history are kept."
        confirmName={fullName}
        confirmLabel="Archive candidate"
        pendingLabel="Archiving…"
        onConfirm={async () => {
          await archiveCandidate.mutateAsync({ id: candidate.id });
          toast.success(`${fullName} archived.`);
          navigate("/admin/candidates");
        }}
      />
    </>
  );
}
