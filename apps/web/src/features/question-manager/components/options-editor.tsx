/**
 * Options editor for select-type questions (03 §1.5 rules):
 *   - add: always allowed
 *   - relabel: always allowed (value stays stable)
 *   - change value: the API blocks it once any answer references the option
 *     (409) — the attempt is allowed here and the rejection surfaces inline
 *   - delete: never — deactivate instead
 *
 * Create mode edits a local array (submitted inside POST /questions);
 * edit mode calls the per-option endpoints immediately.
 */
import { useState } from "react";
import { Plus } from "lucide-react";
import type { CreateQuestionOptionBody, QuestionOption } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError } from "@/lib/api-client";
import { useAddOption, useDeactivateOption, useUpdateOption } from "../api";
import { slugifyKey } from "../guard-rails";
import { Chip } from "./chips";

// ---------------------------------------------------------------------------
// Create mode — local rows, no API calls
// ---------------------------------------------------------------------------

export function DraftOptionsEditor({
  value,
  onChange,
}: {
  value: CreateQuestionOptionBody[];
  onChange: (next: CreateQuestionOptionBody[]) => void;
}) {
  const updateRow = (index: number, patch: Partial<CreateQuestionOptionBody>) => {
    onChange(
      value.map((row, rowIndex) => {
        if (rowIndex !== index) return row;
        const next = { ...row, ...patch };
        // Keep value tracking the label slug until the value is hand-edited.
        if (
          patch.label !== undefined &&
          (row.value === "" || row.value === slugifyKey(row.label))
        ) {
          next.value = slugifyKey(patch.label);
        }
        return next;
      }),
    );
  };

  return (
    <div className="space-y-2">
      {value.map((row, index) => (
        <div key={index} className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label htmlFor={`draft-option-label-${index}`}>Label</Label>
            <Input
              id={`draft-option-label-${index}`}
              value={row.label}
              onChange={(event) =>
                updateRow(index, { label: event.target.value })
              }
            />
          </div>
          <div className="flex-1 space-y-1">
            <Label htmlFor={`draft-option-value-${index}`}>Value</Label>
            <Input
              id={`draft-option-value-${index}`}
              value={row.value}
              className="font-mono"
              onChange={(event) =>
                updateRow(index, { value: event.target.value })
              }
            />
          </div>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Remove option ${row.label || index + 1}`}
            onClick={() =>
              onChange(value.filter((_, rowIndex) => rowIndex !== index))
            }
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onChange([...value, { value: "", label: "" }])}
      >
        <Plus aria-hidden="true" />
        Add option
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Edit mode — immediate per-option API calls
// ---------------------------------------------------------------------------

function SavedOptionRow({
  questionId,
  categoryId,
  option,
}: {
  questionId: string;
  categoryId: string;
  option: QuestionOption;
}) {
  const updateOption = useUpdateOption();
  const deactivateOption = useDeactivateOption();
  const [draftLabel, setDraftLabel] = useState(option.label);
  const [draftValue, setDraftValue] = useState(option.value);
  const [error, setError] = useState<string | null>(null);

  const isDirty = draftLabel !== option.label || draftValue !== option.value;

  const save = async () => {
    const body = {
      ...(draftLabel !== option.label ? { label: draftLabel } : {}),
      ...(draftValue !== option.value ? { value: draftValue } : {}),
    };
    if (Object.keys(body).length === 0) return;
    try {
      await updateOption.mutateAsync({
        questionId,
        categoryId,
        optionId: option.id,
        body,
      });
      setError(null);
    } catch (cause) {
      // 03 §1.5: value changes are blocked once referenced by any answer —
      // the API answers 422 VALIDATION_FAILED with an explanatory message.
      setDraftValue(option.value);
      setError(
        cause instanceof ApiError
          ? cause.message
          : "Could not update the option.",
      );
    }
  };

  return (
    <div className="space-y-1">
      <div className="flex items-end gap-2">
        <div className="flex-1 space-y-1">
          <Label htmlFor={`option-label-${option.id}`}>Label</Label>
          <Input
            id={`option-label-${option.id}`}
            value={draftLabel}
            disabled={!option.isActive}
            onChange={(event) => setDraftLabel(event.target.value)}
          />
        </div>
        <div className="flex-1 space-y-1">
          <Label htmlFor={`option-value-${option.id}`}>Value</Label>
          <Input
            id={`option-value-${option.id}`}
            value={draftValue}
            disabled={!option.isActive}
            className="font-mono"
            onChange={(event) => setDraftValue(event.target.value)}
          />
        </div>
        {option.isActive ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              disabled={!isDirty || updateOption.isPending}
              onClick={() => void save()}
            >
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={deactivateOption.isPending}
              aria-label={`Deactivate option ${option.label}`}
              onClick={() =>
                deactivateOption.mutate({
                  questionId,
                  categoryId,
                  optionId: option.id,
                })
              }
            >
              Deactivate
            </Button>
          </>
        ) : (
          <Chip tone="warning" className="mb-2">
            Inactive
          </Chip>
        )}
      </div>
      {error !== null ? (
        <p role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export function SavedOptionsEditor({
  questionId,
  categoryId,
  options,
}: {
  questionId: string;
  categoryId: string;
  options: QuestionOption[];
}) {
  const addOption = useAddOption();
  const [newLabel, setNewLabel] = useState("");
  const [addError, setAddError] = useState<string | null>(null);

  const add = async () => {
    const label = newLabel.trim();
    if (label.length === 0) return;
    try {
      await addOption.mutateAsync({
        questionId,
        categoryId,
        body: { label, value: slugifyKey(label) },
      });
      setNewLabel("");
      setAddError(null);
    } catch (cause) {
      setAddError(
        cause instanceof ApiError ? cause.message : "Could not add the option.",
      );
    }
  };

  const sorted = [...options].sort((a, b) => a.sortOrder - b.sortOrder);

  return (
    <div className="space-y-3">
      {sorted.map((option) => (
        <SavedOptionRow
          key={option.id}
          questionId={questionId}
          categoryId={categoryId}
          option={option}
        />
      ))}
      <div className="space-y-1">
        <Label htmlFor="new-option-label">Add an option</Label>
        <div className="flex items-center gap-2">
          <Input
            id="new-option-label"
            value={newLabel}
            placeholder="Option label"
            onChange={(event) => setNewLabel(event.target.value)}
          />
          <Button
            size="sm"
            variant="secondary"
            disabled={addOption.isPending}
            onClick={() => void add()}
          >
            <Plus aria-hidden="true" />
            Add
          </Button>
        </div>
        {addError !== null ? (
          <p role="alert" className="text-xs text-danger-text">
            {addError}
          </p>
        ) : null}
        <p className="text-xs text-neutral-500">
          Options can be relabelled at any time; an option's value is fixed
          once any answer references it, and options are deactivated rather
          than deleted so historical answers keep their meaning.
        </p>
      </div>
    </div>
  );
}
