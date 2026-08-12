/**
 * Consent & retention. The consent flag is captured ONLY through
 * POST /candidates/:id/consent (with a consent source), applied
 * optimistically with rollback — never via PATCH, so consent_captured_at
 * always reflects a deliberate action (contracts, 02 §8.1).
 */
import { useState } from "react";
import { toast } from "sonner";
import type { CandidateDetail } from "@sdb/contracts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { ApiError } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { useCaptureConsent, useUpdateCandidate } from "../api";
import { VisibilityChip } from "./badges";

export function ConsentCard({ candidate }: { candidate: CandidateDetail }) {
  const captureConsent = useCaptureConsent(candidate.id);
  const updateCandidate = useUpdateCandidate();

  const [consentSource, setConsentSource] = useState("");
  const [sourceError, setSourceError] = useState<string | null>(null);
  const [retentionUntil, setRetentionUntil] = useState(
    candidate.retentionUntil ?? "",
  );
  const [retentionError, setRetentionError] = useState<string | null>(null);

  const toggleConsent = (next: boolean) => {
    const source = consentSource.trim() !== ""
      ? consentSource.trim()
      : (candidate.consentSource ?? "");
    if (source === "") {
      setSourceError(
        "Enter where this consent was captured (e.g. intake call, email) first.",
      );
      return;
    }
    setSourceError(null);
    captureConsent.mutate(
      { hasConsentToShareProfile: next, consentSource: source },
      {
        onError: (cause) => {
          toast.error(
            cause instanceof ApiError
              ? cause.message
              : "Could not record consent — the toggle was rolled back.",
          );
        },
      },
    );
  };

  const saveRetention = async () => {
    setRetentionError(null);
    try {
      await updateCandidate.mutateAsync({
        id: candidate.id,
        body: { retentionUntil: retentionUntil === "" ? null : retentionUntil },
      });
    } catch (cause) {
      setRetentionError(
        cause instanceof ApiError
          ? cause.message
          : "Could not save the retention date.",
      );
    }
  };

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          Consent & retention
          <VisibilityChip visibility="internal" />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <label
            htmlFor="consent-toggle"
            className="flex cursor-pointer items-center gap-2 text-sm font-medium text-neutral-800"
          >
            <input
              id="consent-toggle"
              type="checkbox"
              checked={candidate.hasConsentToShareProfile}
              onChange={(event) => toggleConsent(event.target.checked)}
              className="h-4 w-4 rounded-sm accent-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
            />
            Has consent to share profile with clients
          </label>
          <p className="text-xs text-neutral-500">
            {candidate.consentCapturedAt !== null
              ? `Captured ${formatDateTime(candidate.consentCapturedAt)}${
                  candidate.consentSource !== null
                    ? ` via ${candidate.consentSource}`
                    : ""
                }`
              : "Consent has not been captured yet. Candidates cannot be presented without it (J5)."}
          </p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="consent-source">Consent source</Label>
          <Input
            id="consent-source"
            placeholder={candidate.consentSource ?? "e.g. screening call, signed form"}
            value={consentSource}
            onChange={(event) => {
              setConsentSource(event.target.value);
              if (sourceError !== null && event.target.value.trim() !== "") {
                setSourceError(null);
              }
            }}
            aria-invalid={sourceError !== null || undefined}
          />
          {sourceError !== null ? (
            <p role="alert" className="text-xs text-danger-text">
              {sourceError}
            </p>
          ) : null}
        </div>

        <Separator />

        <div className="space-y-1.5">
          <Label htmlFor="retention-until">Retention until</Label>
          <div className="flex items-center gap-2">
            <Input
              id="retention-until"
              type="date"
              value={retentionUntil}
              onChange={(event) => setRetentionUntil(event.target.value)}
              className="w-44"
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => void saveRetention()}
              disabled={
                updateCandidate.isPending ||
                retentionUntil === (candidate.retentionUntil ?? "")
              }
            >
              {updateCandidate.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
          {retentionError !== null ? (
            <p role="alert" className="text-xs text-danger-text">
              {retentionError}
            </p>
          ) : null}
          {candidate.retentionUntil !== null ? (
            <p className="text-xs text-neutral-500">
              Profile retained until {formatDate(candidate.retentionUntil)}.
            </p>
          ) : null}
        </div>

        <div>
          <p className="text-sm font-medium text-neutral-800">
            Do-not-present list
          </p>
          {candidate.doNotPresentToClientIds.length === 0 ? (
            <p className="mt-1 text-xs text-neutral-500">
              No client exclusions recorded.
            </p>
          ) : (
            <ul className="mt-1 space-y-0.5">
              {candidate.doNotPresentToClientIds.map((clientId) => (
                <li
                  key={clientId}
                  className="font-mono text-xs text-neutral-500"
                >
                  {clientId}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
