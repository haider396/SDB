/**
 * Tools and skills pickers. Both write through PUT replace endpoints
 * (04 §8): the full set is sent on save. Entries carry a per-item
 * proficiency; options come from the taxonomy reads (04 §5).
 */
import { X } from "lucide-react";
import { useMemo, useState } from "react";
import type {
  CandidateDetail,
  ProficiencyLevel,
  PutCandidateSkillsBody,
  PutCandidateToolsBody,
} from "@sdb/contracts";
import { ProficiencyLevelSchema } from "@sdb/contracts";
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
import { PROFICIENCY_LABELS } from "../labels";
import {
  useChildWrite,
  useSkillOptions,
  useToolOptions,
  type ToolOption,
} from "../api";
import { useReportDirty } from "./section-form";
import { MultiSelectCombobox } from "./multi-select-combobox";

interface Entry {
  id: string;
  proficiency: ProficiencyLevel;
}

function entriesEqual(a: Entry[], b: Entry[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((entry) => [entry.id, entry.proficiency]));
  return b.every((entry) => byId.get(entry.id) === entry.proficiency);
}

function PickerCard({
  sectionId,
  title,
  emptyText,
  initial,
  options,
  isLoadingOptions,
  optionsError,
  onSave,
  isSaving,
}: {
  sectionId: string;
  title: string;
  emptyText: string;
  initial: Entry[];
  options: ToolOption[];
  isLoadingOptions: boolean;
  optionsError: string | null;
  onSave: (entries: Entry[]) => Promise<void>;
  isSaving: boolean;
}) {
  const [entries, setEntries] = useState<Entry[]>(initial);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  const isDirty = !entriesEqual(initial, entries);
  useReportDirty(sectionId, isDirty);

  const labelById = useMemo(
    () => new Map(options.map((option) => [option.id, option.name])),
    [options],
  );

  const toggle = (ids: string[]) => {
    setEntries((previous) => {
      const byId = new Map(previous.map((entry) => [entry.id, entry]));
      return ids.map(
        (id) => byId.get(id) ?? { id, proficiency: "working" as const },
      );
    });
  };

  const save = async () => {
    setError(null);
    try {
      await onSave(entries);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 4000);
    } catch (cause) {
      setError(
        cause instanceof ApiError ? cause.message : "Could not save the set.",
      );
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="space-y-1.5">
          <Label htmlFor={`${sectionId}-picker`}>Add {title.toLowerCase()}</Label>
          <MultiSelectCombobox
            inputId={`${sectionId}-picker`}
            label={title}
            options={options.map((option) => ({
              id: option.id,
              label:
                option.category !== null
                  ? `${option.name} (${option.category})`
                  : option.name,
            }))}
            selectedIds={entries.map((entry) => entry.id)}
            onChange={toggle}
            hideChips
            isLoading={isLoadingOptions}
            loadError={optionsError}
          />
        </div>

        {entries.length === 0 ? (
          <p className="text-sm text-neutral-500">{emptyText}</p>
        ) : (
          <ul className="divide-y divide-border-default">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 py-2">
                <span className="min-w-0 flex-1 truncate text-sm font-medium text-neutral-800">
                  {labelById.get(entry.id) ?? entry.id}
                </span>
                <div className="w-36">
                  <NativeSelect
                    aria-label={`Proficiency for ${labelById.get(entry.id) ?? entry.id}`}
                    value={entry.proficiency}
                    onChange={(event) =>
                      setEntries((previous) =>
                        previous.map((item) =>
                          item.id === entry.id
                            ? {
                                ...item,
                                proficiency: event.target
                                  .value as ProficiencyLevel,
                              }
                            : item,
                        ),
                      )
                    }
                  >
                    {ProficiencyLevelSchema.options.map((level) => (
                      <option key={level} value={level}>
                        {PROFICIENCY_LABELS[level]}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${labelById.get(entry.id) ?? entry.id}`}
                  onClick={() =>
                    setEntries((previous) =>
                      previous.filter((item) => item.id !== entry.id),
                    )
                  }
                >
                  <X aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        )}

        <div className="flex items-center justify-end gap-3 border-t border-border-default pt-3">
          {error !== null ? (
            <p role="alert" className="mr-auto text-xs text-danger-text">
              {error}
            </p>
          ) : savedFlash ? (
            <p aria-live="polite" className="mr-auto text-xs text-success-text">
              Saved.
            </p>
          ) : isDirty ? (
            <p className="mr-auto text-xs text-warning-text">Unsaved changes</p>
          ) : null}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => void save()}
            disabled={isSaving || !isDirty}
          >
            {isSaving ? "Saving…" : "Save"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export function ToolsCard({ candidate }: { candidate: CandidateDetail }) {
  const write = useChildWrite(candidate.id);
  const toolOptions = useToolOptions();

  const initial: Entry[] = candidate.tools.map((tool) => ({
    id: tool.toolId,
    proficiency: tool.proficiency,
  }));

  return (
    <PickerCard
      sectionId="tools"
      title="Tools"
      emptyText="No tools selected. Pick the software this candidate has used."
      initial={initial}
      options={toolOptions.data ?? []}
      isLoadingOptions={toolOptions.isPending}
      optionsError={
        toolOptions.isError ? "The tool taxonomy could not be loaded." : null
      }
      isSaving={write.isPending}
      onSave={async (entries) => {
        const body: PutCandidateToolsBody = {
          tools: entries.map((entry) => ({
            toolId: entry.id,
            proficiency: entry.proficiency,
          })),
        };
        await write.mutateAsync({ path: "tools", method: "PUT", body });
      }}
    />
  );
}

export function SkillsCard({ candidate }: { candidate: CandidateDetail }) {
  const write = useChildWrite(candidate.id);
  const skillOptions = useSkillOptions();

  const initial: Entry[] = candidate.skills.map((skill) => ({
    id: skill.skillId,
    proficiency: skill.proficiency,
  }));

  return (
    <PickerCard
      sectionId="skills"
      title="Skills"
      emptyText="No skills selected. Pick the candidate's verified skills."
      initial={initial}
      options={skillOptions.data ?? []}
      isLoadingOptions={skillOptions.isPending}
      optionsError={
        skillOptions.isError ? "The skill taxonomy could not be loaded." : null
      }
      isSaving={write.isPending}
      onSave={async (entries) => {
        const body: PutCandidateSkillsBody = {
          skills: entries.map((entry) => ({
            skillId: entry.id,
            proficiency: entry.proficiency,
          })),
        };
        await write.mutateAsync({ path: "skills", method: "PUT", body });
      }}
    />
  );
}
