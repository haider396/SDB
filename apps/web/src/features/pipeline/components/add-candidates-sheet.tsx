/**
 * "Add candidates" sheet: searchable picker over the candidates list
 * (excluding those already assigned to the requisition), multi-select →
 * POST /requisitions/:id/assignments. Surfaces the two documented failures
 * inline: 422 VALIDATION_FAILED with blockedCandidates (do-not-present
 * list, AC-PL-04) and 409 DUPLICATE_ASSIGNMENT.
 */
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import type { Candidate } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { ApiError } from "@/lib/api-client";
import { useDebouncedValue } from "@/lib/use-debounced-value";
import { useCandidates } from "@/features/candidates/api";
import { countryFlag } from "@/features/candidates/labels";
import { useCreateAssignments } from "../api";

export interface AddCandidatesSheetProps {
  requisitionId: string;
  /** Candidates already assigned — excluded from the picker. */
  assignedCandidateIds: ReadonlySet<string>;
  isOpen: boolean;
  onClose: () => void;
}

interface BlockedCandidateDetail {
  candidateId: string;
  reason: string;
}

function blockedIdsFrom(error: ApiError): string[] {
  if (error.code === "DUPLICATE_ASSIGNMENT") {
    const ids = error.details?.candidateIds;
    return Array.isArray(ids) ? ids.filter((id) => typeof id === "string") : [];
  }
  const blocked = error.details?.blockedCandidates;
  if (!Array.isArray(blocked)) return [];
  return blocked
    .filter(
      (entry): entry is BlockedCandidateDetail =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as { candidateId?: unknown }).candidateId === "string",
    )
    .map((entry) => entry.candidateId);
}

export function AddCandidatesSheet({
  requisitionId,
  assignedCandidateIds,
  isOpen,
  onClose,
}: AddCandidatesSheetProps) {
  const [searchInput, setSearchInput] = useState("");
  const search = useDebouncedValue(searchInput.trim());
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [inlineError, setInlineError] = useState<string | null>(null);

  const query = useCandidates({ search: search === "" ? undefined : search });
  const create = useCreateAssignments(requisitionId);

  const candidates = useMemo(() => {
    const pages = query.data?.pages ?? [];
    return pages
      .flatMap((page) => page.data)
      .filter(
        (candidate) =>
          !assignedCandidateIds.has(candidate.id) &&
          candidate.archivedAt === null,
      );
  }, [query.data, assignedCandidateIds]);

  const nameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const candidate of candidates) map.set(candidate.id, candidate.displayName);
    return map;
  }, [candidates]);

  const toggle = (id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const reset = () => {
    setSelected(new Set());
    setInlineError(null);
    setSearchInput("");
  };

  const submit = () => {
    setInlineError(null);
    create.mutate(
      { candidateIds: [...selected] },
      {
        onSuccess: (rows) => {
          toast.success(
            rows.length === 1
              ? "1 candidate added to the pipeline."
              : `${rows.length} candidates added to the pipeline.`,
          );
          reset();
          onClose();
        },
        onError: (error) => {
          if (error instanceof ApiError) {
            const ids = blockedIdsFrom(error);
            const names = ids
              .map((id) => nameById.get(id) ?? id)
              .join(", ");
            if (error.code === "DUPLICATE_ASSIGNMENT") {
              setInlineError(
                names === ""
                  ? "Some of these candidates are already assigned to this requisition."
                  : `Already assigned to this requisition: ${names}. Nobody was added.`,
              );
              return;
            }
            if (ids.length > 0) {
              setInlineError(
                `Cannot be presented to this client (do-not-present list): ${names}. Nobody was added.`,
              );
              return;
            }
            setInlineError(error.message);
            return;
          }
          setInlineError("Adding candidates failed. Please try again.");
        },
      },
    );
  };

  return (
    <Sheet
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          reset();
          onClose();
        }
      }}
    >
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Add candidates</SheetTitle>
          <SheetDescription>
            New assignments start at the sourced stage.
          </SheetDescription>
        </SheetHeader>
        <SheetBody>
          <div className="space-y-1.5">
            <Label htmlFor="add-candidates-search">Search candidates</Label>
            <Input
              id="add-candidates-search"
              type="search"
              placeholder="Name, title, reference…"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
            />
          </div>

          {inlineError !== null ? (
            <div
              role="alert"
              className="mt-4 rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger-text"
            >
              {inlineError}
            </div>
          ) : null}

          <div className="mt-4">
            {query.isPending ? (
              <LoadingSkeleton
                variant="list"
                rows={6}
                label="Loading candidates…"
              />
            ) : query.isError ? (
              <ErrorState
                error={query.error}
                onRetry={() => void query.refetch()}
              />
            ) : candidates.length === 0 ? (
              <EmptyState
                icon={UserPlus}
                title="No candidates to add"
                description="Every matching candidate is already on this requisition, or nothing matches the search."
              />
            ) : (
              <ul aria-label="Available candidates" className="space-y-1">
                {candidates.map((candidate: Candidate) => {
                  const flag = countryFlag(candidate.country);
                  const checkboxId = `add-candidate-${candidate.id}`;
                  return (
                    <li
                      key={candidate.id}
                      className="flex items-center gap-3 rounded-md border border-border-default bg-surface-raised px-3 py-2"
                    >
                      <input
                        id={checkboxId}
                        type="checkbox"
                        className="h-4 w-4"
                        checked={selected.has(candidate.id)}
                        onChange={() => toggle(candidate.id)}
                      />
                      <label
                        htmlFor={checkboxId}
                        className="min-w-0 flex-1 cursor-pointer"
                      >
                        <span className="block truncate text-sm font-medium text-brand-navy-ink">
                          {flag !== null ? `${flag} ` : ""}
                          {candidate.displayName}
                        </span>
                        <span className="block truncate text-xs text-neutral-500">
                          {candidate.reference}
                          {candidate.currentTitle !== null
                            ? ` · ${candidate.currentTitle}`
                            : ""}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
            {query.hasNextPage === true ? (
              <Button
                variant="secondary"
                size="sm"
                className="mt-3"
                disabled={query.isFetchingNextPage}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? "Loading…" : "Load more"}
              </Button>
            ) : null}
          </div>
        </SheetBody>
        <SheetFooter>
          <Button
            variant="secondary"
            onClick={() => {
              reset();
              onClose();
            }}
          >
            Cancel
          </Button>
          <Button
            disabled={selected.size === 0 || create.isPending}
            onClick={submit}
          >
            {create.isPending
              ? "Adding…"
              : `Add ${selected.size} candidate${selected.size === 1 ? "" : "s"}`}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
