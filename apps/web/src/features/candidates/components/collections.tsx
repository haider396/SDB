/**
 * Child-collection editors on the candidate detail page: languages,
 * employment history, education, certifications, references, and notes
 * (docs/04-API.md §8 child endpoints). Rows live in CandidateDetail; every
 * write invalidates the detail query.
 *
 * Deletes use the typed-name destructive confirm (05 §4.4), consistent with
 * the members card.
 */
import {
  ArrowDown,
  ArrowUp,
  GraduationCap,
  Languages,
  Pencil,
  Plus,
  ScrollText,
  Trash2,
  UserCheck,
} from "lucide-react";
import { useState, type FormEvent, type ReactNode } from "react";
import type {
  CandidateDetail,
  CandidateEducation,
  CandidateEmployment,
  CandidateCertification,
  CandidateLanguage,
  CandidateReference,
  CreateCandidateNoteBody,
  LanguageLevel,
} from "@sdb/contracts";
import { LanguageLevelSchema } from "@sdb/contracts";
import { TypedConfirmDialog } from "@/components/patterns/typed-confirm-dialog";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-client";
import { formatDate, formatDateTime } from "@/lib/format";
import { LANGUAGE_LEVEL_LABELS } from "../labels";
import { useChildWrite } from "../api";
import { VisibilityChip } from "./badges";

// ---------------------------------------------------------------------------
// Shared shells
// ---------------------------------------------------------------------------

function CollectionCard({
  title,
  titleChip,
  onAdd,
  addLabel,
  emptyText,
  isEmpty,
  children,
}: {
  title: string;
  titleChip?: ReactNode;
  onAdd?: () => void;
  addLabel?: string;
  emptyText: string;
  isEmpty: boolean;
  children: ReactNode;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          {title}
          {titleChip}
        </CardTitle>
        {onAdd !== undefined ? (
          <Button variant="secondary" size="sm" onClick={onAdd}>
            <Plus aria-hidden="true" />
            {addLabel ?? "Add"}
          </Button>
        ) : null}
      </CardHeader>
      <CardContent>
        {isEmpty ? (
          <p className="text-sm text-neutral-500">{emptyText}</p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

function RowActions({
  name,
  onEdit,
  onDelete,
}: {
  name: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Edit ${name}`}
        onClick={onEdit}
      >
        <Pencil aria-hidden="true" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Delete ${name}`}
        onClick={onDelete}
      >
        <Trash2 aria-hidden="true" className="text-danger-text" />
      </Button>
    </div>
  );
}

function FieldError({ message }: { message: string | null }) {
  if (message === null) return null;
  return (
    <p role="alert" className="text-xs text-danger-text">
      {message}
    </p>
  );
}

interface EntryDialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  onSubmit: () => Promise<void>;
  isPending: boolean;
  rootError: string | null;
  children: ReactNode;
}

function EntryDialog({
  open,
  onClose,
  title,
  description,
  onSubmit,
  isPending,
  rootError,
  children,
}: EntryDialogProps) {
  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void onSubmit();
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent>
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            {description !== undefined ? (
              <DialogDescription>{description}</DialogDescription>
            ) : null}
          </DialogHeader>
          <div className="space-y-4">{children}</div>
          {rootError !== null ? (
            <p role="alert" className="mt-3 text-xs text-danger-text">
              {rootError}
            </p>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function orNull(value: string): string | null {
  return value.trim() === "" ? null : value.trim();
}

function yearOrNull(value: string): number | null {
  return value.trim() === "" ? null : Number.parseInt(value, 10);
}

function apiMessage(cause: unknown, fallback: string): string {
  return cause instanceof ApiError ? cause.message : fallback;
}

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

interface LanguageDraft {
  language: string;
  spokenLevel: LanguageLevel | "";
  writtenLevel: LanguageLevel | "";
  isNative: boolean;
}

const EMPTY_LANGUAGE: LanguageDraft = {
  language: "",
  spokenLevel: "",
  writtenLevel: "",
  isNative: false,
};

export function LanguagesCard({ candidate }: { candidate: CandidateDetail }) {
  const write = useChildWrite(candidate.id);
  const [editing, setEditing] = useState<CandidateLanguage | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<LanguageDraft>(EMPTY_LANGUAGE);
  const [languageError, setLanguageError] = useState<string | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CandidateLanguage | null>(null);

  const openAdd = () => {
    setEditing(null);
    setDraft(EMPTY_LANGUAGE);
    setLanguageError(null);
    setRootError(null);
    setIsOpen(true);
  };
  const openEdit = (entry: CandidateLanguage) => {
    setEditing(entry);
    setDraft({
      language: entry.language,
      spokenLevel: entry.spokenLevel ?? "",
      writtenLevel: entry.writtenLevel ?? "",
      isNative: entry.isNative,
    });
    setLanguageError(null);
    setRootError(null);
    setIsOpen(true);
  };

  const submit = async () => {
    if (draft.language.trim() === "") {
      setLanguageError("Enter the language.");
      return;
    }
    setRootError(null);
    const body = {
      language: draft.language.trim(),
      spokenLevel: draft.spokenLevel === "" ? null : draft.spokenLevel,
      writtenLevel: draft.writtenLevel === "" ? null : draft.writtenLevel,
      isNative: draft.isNative,
    };
    try {
      await write.mutateAsync(
        editing === null
          ? { path: "languages", method: "POST", body }
          : { path: `languages/${editing.id}`, method: "PATCH", body },
      );
      setIsOpen(false);
    } catch (cause) {
      setRootError(apiMessage(cause, "Could not save this language."));
    }
  };

  return (
    <>
      <CollectionCard
        title="Languages"
        onAdd={openAdd}
        addLabel="Add language"
        emptyText="No languages recorded. Add the candidate's languages beyond English here."
        isEmpty={candidate.languages.length === 0}
      >
        <ul className="divide-y divide-border-default">
          {candidate.languages.map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 py-2">
              <Languages
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-neutral-400"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-neutral-800">
                  {entry.language}
                  {entry.isNative ? (
                    <span className="ml-2 rounded-full bg-brand-blue-subtle px-2 py-0.5 text-[11px] font-medium text-brand-blue">
                      Native
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-neutral-500">
                  Spoken:{" "}
                  {entry.spokenLevel !== null
                    ? LANGUAGE_LEVEL_LABELS[entry.spokenLevel]
                    : "—"}{" "}
                  · Written:{" "}
                  {entry.writtenLevel !== null
                    ? LANGUAGE_LEVEL_LABELS[entry.writtenLevel]
                    : "—"}
                </p>
              </div>
              <RowActions
                name={entry.language}
                onEdit={() => openEdit(entry)}
                onDelete={() => setDeleting(entry)}
              />
            </li>
          ))}
        </ul>
      </CollectionCard>

      <EntryDialog
        open={isOpen}
        onClose={() => setIsOpen(false)}
        title={editing === null ? "Add language" : `Edit ${editing.language}`}
        onSubmit={submit}
        isPending={write.isPending}
        rootError={rootError}
      >
        <div className="space-y-1.5">
          <Label htmlFor="language-name">Language</Label>
          <Input
            id="language-name"
            value={draft.language}
            aria-invalid={languageError !== null || undefined}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                language: event.target.value,
              }))
            }
            onBlur={() =>
              setLanguageError(
                draft.language.trim() === "" ? "Enter the language." : null,
              )
            }
          />
          <FieldError message={languageError} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="language-spoken">Spoken level</Label>
            <NativeSelect
              id="language-spoken"
              value={draft.spokenLevel}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  spokenLevel: event.target.value as LanguageLevel | "",
                }))
              }
            >
              <option value="">Not set</option>
              {LanguageLevelSchema.options.map((level) => (
                <option key={level} value={level}>
                  {LANGUAGE_LEVEL_LABELS[level]}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="language-written">Written level</Label>
            <NativeSelect
              id="language-written"
              value={draft.writtenLevel}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  writtenLevel: event.target.value as LanguageLevel | "",
                }))
              }
            >
              <option value="">Not set</option>
              {LanguageLevelSchema.options.map((level) => (
                <option key={level} value={level}>
                  {LANGUAGE_LEVEL_LABELS[level]}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        <label
          htmlFor="language-native"
          className="flex cursor-pointer items-center gap-2 text-sm font-medium text-neutral-800"
        >
          <input
            id="language-native"
            type="checkbox"
            checked={draft.isNative}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                isNative: event.target.checked,
              }))
            }
            className="h-4 w-4 rounded-sm accent-brand-blue"
          />
          Native language
        </label>
      </EntryDialog>

      <TypedConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.language ?? "language"}?`}
        description="This removes the language entry from the candidate's profile."
        confirmName={deleting?.language ?? ""}
        confirmLabel="Delete language"
        pendingLabel="Deleting…"
        onConfirm={async () => {
          if (deleting === null) return;
          await write.mutateAsync({
            path: `languages/${deleting.id}`,
            method: "DELETE",
          });
          setDeleting(null);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Employment history — ordered by sort_order, movable up/down
// ---------------------------------------------------------------------------

interface EmploymentDraft {
  employer: string;
  title: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  responsibilities: string;
  reasonForLeaving: string;
}

const EMPTY_EMPLOYMENT: EmploymentDraft = {
  employer: "",
  title: "",
  startDate: "",
  endDate: "",
  isCurrent: false,
  responsibilities: "",
  reasonForLeaving: "",
};

export function EmploymentCard({ candidate }: { candidate: CandidateDetail }) {
  const write = useChildWrite(candidate.id);
  const entries = [...candidate.employmentHistory].sort(
    (a, b) => a.sortOrder - b.sortOrder,
  );
  const [editing, setEditing] = useState<CandidateEmployment | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<EmploymentDraft>(EMPTY_EMPLOYMENT);
  const [errors, setErrors] = useState<{
    employer: string | null;
    title: string | null;
  }>({ employer: null, title: null });
  const [rootError, setRootError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CandidateEmployment | null>(null);

  const openAdd = () => {
    setEditing(null);
    setDraft(EMPTY_EMPLOYMENT);
    setErrors({ employer: null, title: null });
    setRootError(null);
    setIsOpen(true);
  };
  const openEdit = (entry: CandidateEmployment) => {
    setEditing(entry);
    setDraft({
      employer: entry.employer,
      title: entry.title,
      startDate: entry.startDate ?? "",
      endDate: entry.endDate ?? "",
      isCurrent: entry.isCurrent,
      responsibilities: entry.responsibilities ?? "",
      reasonForLeaving: entry.reasonForLeaving ?? "",
    });
    setErrors({ employer: null, title: null });
    setRootError(null);
    setIsOpen(true);
  };

  const submit = async () => {
    const nextErrors = {
      employer: draft.employer.trim() === "" ? "Enter the employer." : null,
      title: draft.title.trim() === "" ? "Enter the title." : null,
    };
    setErrors(nextErrors);
    if (nextErrors.employer !== null || nextErrors.title !== null) return;
    setRootError(null);
    const body = {
      employer: draft.employer.trim(),
      title: draft.title.trim(),
      startDate: orNull(draft.startDate),
      endDate: orNull(draft.endDate),
      isCurrent: draft.isCurrent,
      responsibilities: orNull(draft.responsibilities),
      reasonForLeaving: orNull(draft.reasonForLeaving),
      ...(editing === null ? { sortOrder: entries.length } : {}),
    };
    try {
      await write.mutateAsync(
        editing === null
          ? { path: "employment-history", method: "POST", body }
          : {
              path: `employment-history/${editing.id}`,
              method: "PATCH",
              body,
            },
      );
      setIsOpen(false);
    } catch (cause) {
      setRootError(apiMessage(cause, "Could not save this role."));
    }
  };

  /** Swap sort_order with the neighbour (two PATCHes). */
  const move = async (index: number, direction: -1 | 1) => {
    const current = entries[index];
    const neighbour = entries[index + direction];
    if (current === undefined || neighbour === undefined) return;
    await write.mutateAsync({
      path: `employment-history/${current.id}`,
      method: "PATCH",
      body: { sortOrder: neighbour.sortOrder },
    });
    await write.mutateAsync({
      path: `employment-history/${neighbour.id}`,
      method: "PATCH",
      body: { sortOrder: current.sortOrder },
    });
  };

  return (
    <>
      <CollectionCard
        title="Employment history"
        onAdd={openAdd}
        addLabel="Add role"
        emptyText="No employment history yet. Add past roles so the profile shows a track record."
        isEmpty={entries.length === 0}
      >
        <ul className="divide-y divide-border-default">
          {entries.map((entry, index) => (
            <li key={entry.id} className="flex items-center gap-3 py-2">
              <div className="flex shrink-0 flex-col">
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label={`Move ${entry.title} up`}
                  disabled={index === 0 || write.isPending}
                  onClick={() => void move(index, -1)}
                >
                  <ArrowUp aria-hidden="true" className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6"
                  aria-label={`Move ${entry.title} down`}
                  disabled={index === entries.length - 1 || write.isPending}
                  onClick={() => void move(index, 1)}
                >
                  <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
                </Button>
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-800">
                  {entry.title} · {entry.employer}
                  {entry.isCurrent ? (
                    <span className="ml-2 rounded-full bg-success-subtle px-2 py-0.5 text-[11px] font-medium text-success-text">
                      Current
                    </span>
                  ) : null}
                </p>
                <p className="text-xs text-neutral-500">
                  {formatDate(entry.startDate)} —{" "}
                  {entry.isCurrent ? "present" : formatDate(entry.endDate)}
                </p>
              </div>
              <RowActions
                name={`${entry.title} at ${entry.employer}`}
                onEdit={() => openEdit(entry)}
                onDelete={() => setDeleting(entry)}
              />
            </li>
          ))}
        </ul>
      </CollectionCard>

      <EntryDialog
        open={isOpen}
        onClose={() => setIsOpen(false)}
        title={editing === null ? "Add role" : `Edit ${editing.title}`}
        onSubmit={submit}
        isPending={write.isPending}
        rootError={rootError}
      >
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="employment-employer">Employer</Label>
            <Input
              id="employment-employer"
              value={draft.employer}
              aria-invalid={errors.employer !== null || undefined}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  employer: event.target.value,
                }))
              }
              onBlur={() =>
                setErrors((previous) => ({
                  ...previous,
                  employer:
                    draft.employer.trim() === "" ? "Enter the employer." : null,
                }))
              }
            />
            <FieldError message={errors.employer} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="employment-title">Title</Label>
            <Input
              id="employment-title"
              value={draft.title}
              aria-invalid={errors.title !== null || undefined}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  title: event.target.value,
                }))
              }
              onBlur={() =>
                setErrors((previous) => ({
                  ...previous,
                  title: draft.title.trim() === "" ? "Enter the title." : null,
                }))
              }
            />
            <FieldError message={errors.title} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="employment-start">Start date</Label>
            <Input
              id="employment-start"
              type="date"
              value={draft.startDate}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  startDate: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="employment-end">End date</Label>
            <Input
              id="employment-end"
              type="date"
              value={draft.endDate}
              disabled={draft.isCurrent}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  endDate: event.target.value,
                }))
              }
            />
          </div>
        </div>
        <label
          htmlFor="employment-current"
          className="flex cursor-pointer items-center gap-2 text-sm font-medium text-neutral-800"
        >
          <input
            id="employment-current"
            type="checkbox"
            checked={draft.isCurrent}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                isCurrent: event.target.checked,
                endDate: event.target.checked ? "" : previous.endDate,
              }))
            }
            className="h-4 w-4 rounded-sm accent-brand-blue"
          />
          Current role
        </label>
        <div className="space-y-1.5">
          <Label htmlFor="employment-responsibilities">Responsibilities</Label>
          <Textarea
            id="employment-responsibilities"
            value={draft.responsibilities}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                responsibilities: event.target.value,
              }))
            }
          />
        </div>
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5">
            <Label htmlFor="employment-reason">Reason for leaving</Label>
            <VisibilityChip visibility="internal" />
          </div>
          <Textarea
            id="employment-reason"
            value={draft.reasonForLeaving}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                reasonForLeaving: event.target.value,
              }))
            }
          />
        </div>
      </EntryDialog>

      <TypedConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.title ?? "role"} at ${deleting?.employer ?? ""}?`}
        description="This removes the role from the candidate's employment history."
        confirmName={deleting?.employer ?? ""}
        confirmLabel="Delete role"
        pendingLabel="Deleting…"
        onConfirm={async () => {
          if (deleting === null) return;
          await write.mutateAsync({
            path: `employment-history/${deleting.id}`,
            method: "DELETE",
          });
          setDeleting(null);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Education
// ---------------------------------------------------------------------------

interface EducationDraft {
  institution: string;
  degree: string;
  fieldOfStudy: string;
  country: string;
  startYear: string;
  endYear: string;
}

const EMPTY_EDUCATION: EducationDraft = {
  institution: "",
  degree: "",
  fieldOfStudy: "",
  country: "",
  startYear: "",
  endYear: "",
};

export function EducationCard({ candidate }: { candidate: CandidateDetail }) {
  const write = useChildWrite(candidate.id);
  const [editing, setEditing] = useState<CandidateEducation | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<EducationDraft>(EMPTY_EDUCATION);
  const [institutionError, setInstitutionError] = useState<string | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CandidateEducation | null>(null);

  const openAdd = () => {
    setEditing(null);
    setDraft(EMPTY_EDUCATION);
    setInstitutionError(null);
    setRootError(null);
    setIsOpen(true);
  };
  const openEdit = (entry: CandidateEducation) => {
    setEditing(entry);
    setDraft({
      institution: entry.institution,
      degree: entry.degree ?? "",
      fieldOfStudy: entry.fieldOfStudy ?? "",
      country: entry.country ?? "",
      startYear: entry.startYear !== null ? String(entry.startYear) : "",
      endYear: entry.endYear !== null ? String(entry.endYear) : "",
    });
    setInstitutionError(null);
    setRootError(null);
    setIsOpen(true);
  };

  const submit = async () => {
    if (draft.institution.trim() === "") {
      setInstitutionError("Enter the institution.");
      return;
    }
    setRootError(null);
    const body = {
      institution: draft.institution.trim(),
      degree: orNull(draft.degree),
      fieldOfStudy: orNull(draft.fieldOfStudy),
      country: orNull(draft.country),
      startYear: yearOrNull(draft.startYear),
      endYear: yearOrNull(draft.endYear),
    };
    try {
      await write.mutateAsync(
        editing === null
          ? { path: "education", method: "POST", body }
          : { path: `education/${editing.id}`, method: "PATCH", body },
      );
      setIsOpen(false);
    } catch (cause) {
      setRootError(apiMessage(cause, "Could not save this education entry."));
    }
  };

  return (
    <>
      <CollectionCard
        title="Education"
        onAdd={openAdd}
        addLabel="Add education"
        emptyText="No education recorded yet."
        isEmpty={candidate.education.length === 0}
      >
        <ul className="divide-y divide-border-default">
          {candidate.education.map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 py-2">
              <GraduationCap
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-neutral-400"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-800">
                  {entry.institution}
                </p>
                <p className="text-xs text-neutral-500">
                  {[entry.degree, entry.fieldOfStudy]
                    .filter((part) => part !== null)
                    .join(" · ") || "—"}
                  {entry.startYear !== null || entry.endYear !== null
                    ? ` · ${entry.startYear ?? "?"}–${entry.endYear ?? "?"}`
                    : ""}
                </p>
              </div>
              <RowActions
                name={entry.institution}
                onEdit={() => openEdit(entry)}
                onDelete={() => setDeleting(entry)}
              />
            </li>
          ))}
        </ul>
      </CollectionCard>

      <EntryDialog
        open={isOpen}
        onClose={() => setIsOpen(false)}
        title={editing === null ? "Add education" : `Edit ${editing.institution}`}
        onSubmit={submit}
        isPending={write.isPending}
        rootError={rootError}
      >
        <div className="space-y-1.5">
          <Label htmlFor="education-institution">Institution</Label>
          <Input
            id="education-institution"
            value={draft.institution}
            aria-invalid={institutionError !== null || undefined}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                institution: event.target.value,
              }))
            }
            onBlur={() =>
              setInstitutionError(
                draft.institution.trim() === ""
                  ? "Enter the institution."
                  : null,
              )
            }
          />
          <FieldError message={institutionError} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="education-degree">Degree</Label>
            <Input
              id="education-degree"
              value={draft.degree}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  degree: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="education-field">Field of study</Label>
            <Input
              id="education-field"
              value={draft.fieldOfStudy}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  fieldOfStudy: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="education-country">Country</Label>
            <Input
              id="education-country"
              value={draft.country}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  country: event.target.value,
                }))
              }
            />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1.5">
              <Label htmlFor="education-start">Start year</Label>
              <Input
                id="education-start"
                inputMode="numeric"
                value={draft.startYear}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    startYear: event.target.value,
                  }))
                }
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="education-end">End year</Label>
              <Input
                id="education-end"
                inputMode="numeric"
                value={draft.endYear}
                onChange={(event) =>
                  setDraft((previous) => ({
                    ...previous,
                    endYear: event.target.value,
                  }))
                }
              />
            </div>
          </div>
        </div>
      </EntryDialog>

      <TypedConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.institution ?? "education"}?`}
        description="This removes the education entry from the candidate's profile."
        confirmName={deleting?.institution ?? ""}
        confirmLabel="Delete entry"
        pendingLabel="Deleting…"
        onConfirm={async () => {
          if (deleting === null) return;
          await write.mutateAsync({
            path: `education/${deleting.id}`,
            method: "DELETE",
          });
          setDeleting(null);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Certifications
// ---------------------------------------------------------------------------

interface CertificationDraft {
  name: string;
  issuer: string;
  issuedDate: string;
  expiresDate: string;
  credentialUrl: string;
}

const EMPTY_CERTIFICATION: CertificationDraft = {
  name: "",
  issuer: "",
  issuedDate: "",
  expiresDate: "",
  credentialUrl: "",
};

export function CertificationsCard({
  candidate,
}: {
  candidate: CandidateDetail;
}) {
  const write = useChildWrite(candidate.id);
  const [editing, setEditing] = useState<CandidateCertification | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<CertificationDraft>(EMPTY_CERTIFICATION);
  const [nameError, setNameError] = useState<string | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CandidateCertification | null>(null);

  const openAdd = () => {
    setEditing(null);
    setDraft(EMPTY_CERTIFICATION);
    setNameError(null);
    setRootError(null);
    setIsOpen(true);
  };
  const openEdit = (entry: CandidateCertification) => {
    setEditing(entry);
    setDraft({
      name: entry.name,
      issuer: entry.issuer ?? "",
      issuedDate: entry.issuedDate ?? "",
      expiresDate: entry.expiresDate ?? "",
      credentialUrl: entry.credentialUrl ?? "",
    });
    setNameError(null);
    setRootError(null);
    setIsOpen(true);
  };

  const submit = async () => {
    if (draft.name.trim() === "") {
      setNameError("Enter the certification name.");
      return;
    }
    setRootError(null);
    const body = {
      name: draft.name.trim(),
      issuer: orNull(draft.issuer),
      issuedDate: orNull(draft.issuedDate),
      expiresDate: orNull(draft.expiresDate),
      credentialUrl: orNull(draft.credentialUrl),
    };
    try {
      await write.mutateAsync(
        editing === null
          ? { path: "certifications", method: "POST", body }
          : { path: `certifications/${editing.id}`, method: "PATCH", body },
      );
      setIsOpen(false);
    } catch (cause) {
      setRootError(apiMessage(cause, "Could not save this certification."));
    }
  };

  return (
    <>
      <CollectionCard
        title="Certifications"
        onAdd={openAdd}
        addLabel="Add certification"
        emptyText="No certifications recorded yet."
        isEmpty={candidate.certifications.length === 0}
      >
        <ul className="divide-y divide-border-default">
          {candidate.certifications.map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 py-2">
              <ScrollText
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-neutral-400"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-800">
                  {entry.name}
                </p>
                <p className="text-xs text-neutral-500">
                  {entry.issuer ?? "—"}
                  {entry.issuedDate !== null
                    ? ` · issued ${formatDate(entry.issuedDate)}`
                    : ""}
                  {entry.expiresDate !== null
                    ? ` · expires ${formatDate(entry.expiresDate)}`
                    : ""}
                </p>
              </div>
              <RowActions
                name={entry.name}
                onEdit={() => openEdit(entry)}
                onDelete={() => setDeleting(entry)}
              />
            </li>
          ))}
        </ul>
      </CollectionCard>

      <EntryDialog
        open={isOpen}
        onClose={() => setIsOpen(false)}
        title={editing === null ? "Add certification" : `Edit ${editing.name}`}
        onSubmit={submit}
        isPending={write.isPending}
        rootError={rootError}
      >
        <div className="space-y-1.5">
          <Label htmlFor="certification-name">Name</Label>
          <Input
            id="certification-name"
            value={draft.name}
            aria-invalid={nameError !== null || undefined}
            onChange={(event) =>
              setDraft((previous) => ({ ...previous, name: event.target.value }))
            }
            onBlur={() =>
              setNameError(
                draft.name.trim() === ""
                  ? "Enter the certification name."
                  : null,
              )
            }
          />
          <FieldError message={nameError} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="certification-issuer">Issuer</Label>
            <Input
              id="certification-issuer"
              value={draft.issuer}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  issuer: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="certification-url">Credential URL</Label>
            <Input
              id="certification-url"
              value={draft.credentialUrl}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  credentialUrl: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="certification-issued">Issued</Label>
            <Input
              id="certification-issued"
              type="date"
              value={draft.issuedDate}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  issuedDate: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="certification-expires">Expires</Label>
            <Input
              id="certification-expires"
              type="date"
              value={draft.expiresDate}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  expiresDate: event.target.value,
                }))
              }
            />
          </div>
        </div>
      </EntryDialog>

      <TypedConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? "certification"}?`}
        description="This removes the certification from the candidate's profile."
        confirmName={deleting?.name ?? ""}
        confirmLabel="Delete certification"
        pendingLabel="Deleting…"
        onConfirm={async () => {
          if (deleting === null) return;
          await write.mutateAsync({
            path: `certifications/${deleting.id}`,
            method: "DELETE",
          });
          setDeleting(null);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// References — checked_by/checked_at are server-set once an outcome lands
// ---------------------------------------------------------------------------

interface ReferenceDraft {
  refereeName: string;
  relationship: string;
  company: string;
  contact: string;
  outcome: string;
  notes: string;
}

const EMPTY_REFERENCE: ReferenceDraft = {
  refereeName: "",
  relationship: "",
  company: "",
  contact: "",
  outcome: "",
  notes: "",
};

export function ReferencesCard({ candidate }: { candidate: CandidateDetail }) {
  const write = useChildWrite(candidate.id);
  const [editing, setEditing] = useState<CandidateReference | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draft, setDraft] = useState<ReferenceDraft>(EMPTY_REFERENCE);
  const [nameError, setNameError] = useState<string | null>(null);
  const [rootError, setRootError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<CandidateReference | null>(null);

  const openAdd = () => {
    setEditing(null);
    setDraft(EMPTY_REFERENCE);
    setNameError(null);
    setRootError(null);
    setIsOpen(true);
  };
  const openEdit = (entry: CandidateReference) => {
    setEditing(entry);
    setDraft({
      refereeName: entry.refereeName,
      relationship: entry.relationship ?? "",
      company: entry.company ?? "",
      contact: entry.contact ?? "",
      outcome: entry.outcome ?? "",
      notes: entry.notes ?? "",
    });
    setNameError(null);
    setRootError(null);
    setIsOpen(true);
  };

  const submit = async () => {
    if (draft.refereeName.trim() === "") {
      setNameError("Enter the referee's name.");
      return;
    }
    setRootError(null);
    const body = {
      refereeName: draft.refereeName.trim(),
      relationship: orNull(draft.relationship),
      company: orNull(draft.company),
      contact: orNull(draft.contact),
      outcome: orNull(draft.outcome),
      notes: orNull(draft.notes),
    };
    try {
      await write.mutateAsync(
        editing === null
          ? { path: "references", method: "POST", body }
          : { path: `references/${editing.id}`, method: "PATCH", body },
      );
      setIsOpen(false);
    } catch (cause) {
      setRootError(apiMessage(cause, "Could not save this reference."));
    }
  };

  return (
    <>
      <CollectionCard
        title="References"
        titleChip={<VisibilityChip visibility="internal" />}
        onAdd={openAdd}
        addLabel="Add reference"
        emptyText="No references recorded. Add referees and record outcomes as you check them."
        isEmpty={candidate.references.length === 0}
      >
        <ul className="divide-y divide-border-default">
          {candidate.references.map((entry) => (
            <li key={entry.id} className="flex items-center gap-3 py-2">
              <UserCheck
                aria-hidden="true"
                className="h-4 w-4 shrink-0 text-neutral-400"
              />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-neutral-800">
                  {entry.refereeName}
                  {entry.checkedAt !== null ? (
                    <span className="ml-2 rounded-full bg-success-subtle px-2 py-0.5 text-[11px] font-medium text-success-text">
                      Checked
                    </span>
                  ) : null}
                </p>
                <p className="truncate text-xs text-neutral-500">
                  {[entry.relationship, entry.company]
                    .filter((part) => part !== null)
                    .join(" · ") || "—"}
                  {entry.outcome !== null ? ` · Outcome: ${entry.outcome}` : ""}
                  {entry.checkedAt !== null
                    ? ` · checked ${formatDateTime(entry.checkedAt)}`
                    : ""}
                </p>
              </div>
              <RowActions
                name={entry.refereeName}
                onEdit={() => openEdit(entry)}
                onDelete={() => setDeleting(entry)}
              />
            </li>
          ))}
        </ul>
      </CollectionCard>

      <EntryDialog
        open={isOpen}
        onClose={() => setIsOpen(false)}
        title={editing === null ? "Add reference" : `Edit ${editing.refereeName}`}
        description="Recording an outcome stamps the check with your user and the current time."
        onSubmit={submit}
        isPending={write.isPending}
        rootError={rootError}
      >
        <div className="space-y-1.5">
          <Label htmlFor="reference-name">Referee name</Label>
          <Input
            id="reference-name"
            value={draft.refereeName}
            aria-invalid={nameError !== null || undefined}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                refereeName: event.target.value,
              }))
            }
            onBlur={() =>
              setNameError(
                draft.refereeName.trim() === ""
                  ? "Enter the referee's name."
                  : null,
              )
            }
          />
          <FieldError message={nameError} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label htmlFor="reference-relationship">Relationship</Label>
            <Input
              id="reference-relationship"
              value={draft.relationship}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  relationship: event.target.value,
                }))
              }
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="reference-company">Company</Label>
            <Input
              id="reference-company"
              value={draft.company}
              onChange={(event) =>
                setDraft((previous) => ({
                  ...previous,
                  company: event.target.value,
                }))
              }
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reference-contact">Contact</Label>
          <Input
            id="reference-contact"
            placeholder="Email or phone"
            value={draft.contact}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                contact: event.target.value,
              }))
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reference-outcome">Outcome</Label>
          <Input
            id="reference-outcome"
            placeholder="e.g. Positive — confirmed employment and performance"
            value={draft.outcome}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                outcome: event.target.value,
              }))
            }
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="reference-notes">Notes</Label>
          <Textarea
            id="reference-notes"
            value={draft.notes}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                notes: event.target.value,
              }))
            }
          />
        </div>
      </EntryDialog>

      <TypedConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        title={`Delete reference ${deleting?.refereeName ?? ""}?`}
        description="This removes the reference and its check outcome."
        confirmName={deleting?.refereeName ?? ""}
        confirmLabel="Delete reference"
        pendingLabel="Deleting…"
        onConfirm={async () => {
          if (deleting === null) return;
          await write.mutateAsync({
            path: `references/${deleting.id}`,
            method: "DELETE",
          });
          setDeleting(null);
        }}
      />
    </>
  );
}

// ---------------------------------------------------------------------------
// Notes — append-only timeline with per-note client visibility
// ---------------------------------------------------------------------------

export function NotesCard({ candidate }: { candidate: CandidateDetail }) {
  const write = useChildWrite(candidate.id);
  const [body, setBody] = useState("");
  const [isClientVisible, setIsClientVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notes = [...candidate.notes].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (body.trim() === "") {
      setError("Write the note first.");
      return;
    }
    setError(null);
    const payload: CreateCandidateNoteBody = {
      body: body.trim(),
      isClientVisible,
    };
    try {
      await write.mutateAsync({ path: "notes", method: "POST", body: payload });
      setBody("");
      setIsClientVisible(false);
    } catch (cause) {
      setError(apiMessage(cause, "Could not add the note."));
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <form onSubmit={(event) => void submit(event)} noValidate className="space-y-2">
          <div className="space-y-1.5">
            <Label htmlFor="note-body">Add a note</Label>
            <Textarea
              id="note-body"
              value={body}
              aria-invalid={error !== null || undefined}
              onChange={(event) => setBody(event.target.value)}
            />
            <FieldError message={error} />
          </div>
          <div className="flex items-center justify-between gap-4">
            <label
              htmlFor="note-client-visible"
              className="flex cursor-pointer items-center gap-2 text-sm text-neutral-800"
            >
              <input
                id="note-client-visible"
                type="checkbox"
                checked={isClientVisible}
                onChange={(event) => setIsClientVisible(event.target.checked)}
                className="h-4 w-4 rounded-sm accent-brand-blue"
              />
              Visible to client
            </label>
            <Button type="submit" size="sm" disabled={write.isPending}>
              {write.isPending ? "Adding…" : "Add note"}
            </Button>
          </div>
        </form>

        {notes.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No notes yet. Screening call summaries and observations belong here.
          </p>
        ) : (
          <ol className="space-y-3">
            {notes.map((note) => (
              <li
                key={note.id}
                className="rounded-md border border-border-default bg-surface-subtle p-3"
              >
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span
                    className="text-xs text-neutral-500"
                    title={formatDateTime(note.createdAt)}
                  >
                    {formatDateTime(note.createdAt)}
                  </span>
                  <VisibilityChip
                    visibility={note.isClientVisible ? "client" : "internal"}
                  />
                </div>
                <p className="whitespace-pre-wrap text-sm text-neutral-800">
                  {note.body}
                </p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  );
}
