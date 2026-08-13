/**
 * Declarative per-card candidate editor machinery.
 *
 * Each section card owns one RHF form over a declared field list, saves
 * independently (PATCH carries ONLY that card's fields), validates inline on
 * blur, and reports its dirty state into a page-level registry so a single
 * navigation guard covers every card (React Router allows one blocker).
 */
import { zodResolver } from "@hookform/resolvers/zod";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { format, parseISO } from "date-fns";
import type { CandidateDetail, UpdateCandidateBody } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Textarea } from "@/components/ui/textarea";
import { ApiError } from "@/lib/api-client";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import { cn } from "@/lib/utils";
import { useUpdateCandidate } from "../api";
import { visibilityOf, type FieldVisibility } from "../visibility";
import { VisibilityChip } from "./badges";

// ---------------------------------------------------------------------------
// Dirty registry — one navigation guard for all cards, plus per-section
// submit handlers so the page's "Save all" bar can flush every dirty card
// sequentially through the same forms (UX 2.5).
// ---------------------------------------------------------------------------

interface DirtyRegistryHandle {
  report: (id: string, dirty: boolean) => void;
  registerSubmit: (id: string, submit: (() => Promise<void>) | null) => void;
}

export interface DirtySectionsState {
  /** Section ids currently dirty, in card registration (display) order. */
  dirtyIds: readonly string[];
  isSavingAll: boolean;
  /** Submit every dirty section's own form, one at a time, in order. */
  saveAll: () => Promise<void>;
}

const DirtyContext = createContext<DirtyRegistryHandle | null>(null);
const DirtySectionsContext = createContext<DirtySectionsState | null>(null);

export function DirtyRegistryProvider({ children }: { children: ReactNode }) {
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [isSavingAll, setIsSavingAll] = useState(false);
  // Map preserves insertion order — sections register in render order, so
  // "Save all" flushes top-to-bottom.
  const submitsRef = useRef<Map<string, () => Promise<void>>>(new Map());

  const report = useCallback((id: string, dirty: boolean) => {
    setDirtyIds((previous) => {
      if (previous.has(id) === dirty) return previous;
      const next = new Set(previous);
      if (dirty) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const registerSubmit = useCallback(
    (id: string, submit: (() => Promise<void>) | null) => {
      if (submit === null) submitsRef.current.delete(id);
      else submitsRef.current.set(id, submit);
    },
    [],
  );

  const orderedDirtyIds = [
    ...[...submitsRef.current.keys()].filter((id) => dirtyIds.has(id)),
    // Dirty reporters without a registered submit still count as unsaved.
    ...[...dirtyIds].filter((id) => !submitsRef.current.has(id)),
  ];

  const saveAll = useCallback(async () => {
    setIsSavingAll(true);
    try {
      for (const [id, submit] of submitsRef.current) {
        if (dirtyIds.has(id)) {
          await submit();
        }
      }
    } finally {
      setIsSavingAll(false);
    }
  }, [dirtyIds]);

  useDirtyGuard(dirtyIds.size > 0);

  const handle = useMemo(
    () => ({ report, registerSubmit }),
    [report, registerSubmit],
  );

  return (
    <DirtyContext.Provider value={handle}>
      <DirtySectionsContext.Provider
        value={{ dirtyIds: orderedDirtyIds, isSavingAll, saveAll }}
      >
        {children}
      </DirtySectionsContext.Provider>
    </DirtyContext.Provider>
  );
}

export function useReportDirty(id: string, dirty: boolean): void {
  const handle = useContext(DirtyContext);
  const report = handle?.report;
  useEffect(() => {
    report?.(id, dirty);
    return () => report?.(id, false);
  }, [report, id, dirty]);
}

/** Register the section's own submit for the page-level "Save all". */
export function useRegisterSectionSubmit(
  id: string,
  submit: () => Promise<void>,
): void {
  const handle = useContext(DirtyContext);
  const registerSubmit = handle?.registerSubmit;
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    registerSubmit?.(id, () => submitRef.current());
    return () => registerSubmit?.(id, null);
  }, [registerSubmit, id]);
}

/** Dirty-section state for the sticky save bar; null outside the provider. */
export function useDirtySections(): DirtySectionsState | null {
  return useContext(DirtySectionsContext);
}

// ---------------------------------------------------------------------------
// Field descriptors
// ---------------------------------------------------------------------------

export type FieldKind =
  | "text"
  | "textarea"
  | "number"
  | "integer"
  | "date"
  | "datetime"
  | "time"
  | "select"
  | "boolSelect"
  | "checkbox"
  | "rating"
  | "multiEnum";

export interface SelectOption {
  value: string;
  label: string;
}

/** Body keys writable through PATCH (UpdateCandidateBody). */
export type WritableField = keyof UpdateCandidateBody & keyof CandidateDetail;

export interface FieldDescriptor {
  name: WritableField;
  label: string;
  kind: FieldKind;
  options?: readonly SelectOption[];
  placeholder?: string;
  help?: string;
  /** Span both columns of the card grid (textareas, multi selects). */
  wide?: boolean;
}

type SectionValue = string | boolean | string[];
export type SectionValues = Record<string, SectionValue>;

function toInputValue(kind: FieldKind, value: unknown): SectionValue {
  if (kind === "checkbox") return value === true;
  if (kind === "multiEnum") {
    return Array.isArray(value)
      ? value.filter((item): item is string => typeof item === "string")
      : [];
  }
  if (value === null || value === undefined) return "";
  if (kind === "datetime" && typeof value === "string") {
    try {
      return format(parseISO(value), "yyyy-MM-dd'T'HH:mm");
    } catch {
      return "";
    }
  }
  if (kind === "time" && typeof value === "string") return value.slice(0, 5);
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return typeof value === "string" ? value : "";
}

export function defaultsFor(
  candidate: CandidateDetail,
  fields: readonly FieldDescriptor[],
): SectionValues {
  const values: SectionValues = {};
  for (const field of fields) {
    values[field.name] = toInputValue(field.kind, candidate[field.name]);
  }
  return values;
}

function toBodyValue(kind: FieldKind, value: SectionValue): unknown {
  if (kind === "checkbox") return value === true;
  if (kind === "multiEnum") {
    const list = Array.isArray(value) ? value : [];
    return list.length === 0 ? null : list;
  }
  const text = typeof value === "string" ? value.trim() : "";
  if (text === "") return null;
  switch (kind) {
    case "number":
      return Number(text);
    case "integer":
    case "rating":
      return Number.parseInt(text, 10);
    case "datetime":
      return new Date(text).toISOString();
    default:
      return text;
  }
}

/** Build the PATCH body containing ONLY this card's fields. */
export function bodyFor(
  fields: readonly FieldDescriptor[],
  values: SectionValues,
): UpdateCandidateBody {
  const body: Record<string, unknown> = {};
  for (const field of fields) {
    body[field.name] = toBodyValue(field.kind, values[field.name] ?? "");
  }
  return body as unknown as UpdateCandidateBody;
}

/**
 * Money safety (02 §7 precedent, as in requisition fields-card): when the
 * amount field is filled, the paired unit field is mandatory. The reverse —
 * a unit without an amount — is fine.
 */
export interface AmountUnitRule {
  amountField: WritableField;
  unitField: WritableField;
}

function validationSchema(
  fields: readonly FieldDescriptor[],
  amountUnitRules: readonly AmountUnitRule[] = [],
) {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    if (field.kind === "checkbox") {
      shape[field.name] = z.boolean();
    } else if (field.kind === "multiEnum") {
      shape[field.name] = z.array(z.string());
    } else if (field.kind === "number") {
      shape[field.name] = z
        .string()
        .refine(
          (value) => value.trim() === "" || Number.isFinite(Number(value)),
          "Enter a number.",
        );
    } else if (field.kind === "integer") {
      shape[field.name] = z
        .string()
        .refine(
          (value) =>
            value.trim() === "" ||
            (Number.isFinite(Number(value)) && Number.isInteger(Number(value))),
          "Enter a whole number.",
        );
    } else {
      shape[field.name] = z.string();
    }
  }
  const base = z.object(shape);
  if (amountUnitRules.length === 0) return base;
  return base.superRefine((values, context) => {
    for (const rule of amountUnitRules) {
      const amount = values[rule.amountField];
      const unit = values[rule.unitField];
      const hasAmount = typeof amount === "string" && amount.trim() !== "";
      const hasUnit = typeof unit === "string" && unit !== "";
      if (hasAmount && !hasUnit) {
        context.addIssue({
          code: z.ZodIssueCode.custom,
          path: [rule.unitField],
          message: "Pick a unit — an amount without a unit is ambiguous.",
        });
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Field rendering
// ---------------------------------------------------------------------------

const NULLABLE_BOOL_OPTIONS: readonly SelectOption[] = [
  { value: "", label: "Not set" },
  { value: "true", label: "Yes" },
  { value: "false", label: "No" },
];

function RatingControl({
  id,
  value,
  onChange,
  onBlur,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
}) {
  const options = ["", "1", "2", "3", "4", "5"];
  return (
    <div
      role="radiogroup"
      aria-labelledby={`${id}-label`}
      className="inline-flex gap-1 rounded-md border border-border-default bg-surface-subtle p-1"
    >
      {options.map((option) => (
        // `relative` contains the absolutely-positioned sr-only input.
        <label key={option} className="relative cursor-pointer">
          <input
            type="radio"
            name={id}
            value={option}
            checked={value === option}
            onChange={() => onChange(option)}
            onBlur={onBlur}
            className="peer sr-only"
          />
          <span
            className={cn(
              "flex h-8 min-w-9 items-center justify-center rounded-sm px-2.5 text-sm font-medium text-neutral-600 transition-colors duration-fast",
              "hover:text-neutral-900",
              "peer-checked:bg-surface-raised peer-checked:text-brand-navy-ink peer-checked:shadow-xs",
              "peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-blue",
            )}
          >
            {option === "" ? "—" : option}
          </span>
        </label>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SectionCard
// ---------------------------------------------------------------------------

export interface SectionCardProps {
  sectionId: string;
  title: string;
  description?: string;
  candidate: CandidateDetail;
  fields: readonly FieldDescriptor[];
  /**
   * The card's dominant visibility; fields whose visibility differs get a
   * chip (gated lock / internal / client-visible).
   */
  defaultVisibility: FieldVisibility;
  /** Render the card read-only (webhook-sourced provenance, 04 §8.2). */
  readOnly?: boolean;
  /** Extra read-only rows under the grid (e.g. "assessed by / at"). */
  footer?: ReactNode;
  /** Card-level chip shown next to the title. */
  titleChip?: ReactNode;
  /** Amount⇒unit pairings enforced on save (money safety, 02 §7). */
  amountUnitRules?: readonly AmountUnitRule[];
}

export function SectionCard({
  sectionId,
  title,
  description,
  candidate,
  fields,
  defaultVisibility,
  readOnly = false,
  footer,
  titleChip,
  amountUnitRules,
}: SectionCardProps) {
  const updateCandidate = useUpdateCandidate();
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const savedTimer = useRef<number | null>(null);

  const schema = useMemo(
    () => validationSchema(fields, amountUnitRules ?? []),
    [fields, amountUnitRules],
  );
  const defaults = useMemo(
    () => defaultsFor(candidate, fields),
    [candidate, fields],
  );

  const form = useForm<SectionValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    defaultValues: defaults,
    values: defaults,
    // A background refetch (e.g. an optimistic toggle elsewhere on the page)
    // must not clobber in-progress edits in this card.
    resetOptions: { keepDirtyValues: true },
  });
  const { errors, isDirty } = form.formState;
  useReportDirty(sectionId, isDirty);

  useEffect(
    () => () => {
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
    },
    [],
  );

  const submit = form.handleSubmit(async (values) => {
    const body = bodyFor(fields, values);
    try {
      await updateCandidate.mutateAsync({ id: candidate.id, body });
      form.reset(values);
      setSavedAt(Date.now());
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current);
      savedTimer.current = window.setTimeout(() => setSavedAt(null), 4000);
    } catch (cause) {
      form.setError("root", {
        message:
          cause instanceof ApiError
            ? cause.message
            : "Could not save this section.",
      });
    }
  });
  useRegisterSectionSubmit(sectionId, () => submit());

  const fieldId = (name: string) => `${sectionId}-${name}`;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="flex items-center gap-2">
          {title}
          {titleChip}
        </CardTitle>
        {description !== undefined ? (
          <p className="text-xs text-neutral-500">{description}</p>
        ) : null}
      </CardHeader>
      <CardContent>
        {readOnly ? (
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 sm:grid-cols-2">
            {fields.map((field) => (
              <div key={field.name} className="flex items-baseline justify-between gap-4 py-1">
                <dt className="flex shrink-0 items-center gap-1.5 text-sm text-neutral-500">
                  {field.label}
                  {visibilityOf(field.name) !== defaultVisibility ? (
                    <VisibilityChip visibility={visibilityOf(field.name)} />
                  ) : null}
                </dt>
                <dd className="text-right text-sm text-neutral-800">
                  {String(
                    toInputValue(field.kind, candidate[field.name]) === ""
                      ? "—"
                      : toInputValue(field.kind, candidate[field.name]),
                  )}
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <form onSubmit={(event) => void submit(event)} noValidate>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {fields.map((field) => {
                const id = fieldId(field.name);
                const error = errors[field.name];
                const visibility = visibilityOf(field.name);
                const chip =
                  visibility !== defaultVisibility ? (
                    <VisibilityChip visibility={visibility} />
                  ) : null;
                return (
                  <div
                    key={field.name}
                    className={cn(
                      "space-y-1.5",
                      (field.wide ||
                        field.kind === "textarea" ||
                        field.kind === "multiEnum") &&
                        "sm:col-span-2",
                    )}
                  >
                    {field.kind !== "checkbox" ? (
                      <div
                        className="flex items-center gap-1.5"
                        id={`${id}-label`}
                      >
                        <Label htmlFor={id}>{field.label}</Label>
                        {chip}
                      </div>
                    ) : null}

                    {field.kind === "text" ? (
                      <Input
                        id={id}
                        placeholder={field.placeholder}
                        aria-invalid={error !== undefined || undefined}
                        {...form.register(field.name)}
                      />
                    ) : field.kind === "textarea" ? (
                      <Textarea
                        id={id}
                        placeholder={field.placeholder}
                        aria-invalid={error !== undefined || undefined}
                        {...form.register(field.name)}
                      />
                    ) : field.kind === "number" || field.kind === "integer" ? (
                      <Input
                        id={id}
                        inputMode="decimal"
                        placeholder={field.placeholder}
                        aria-invalid={error !== undefined || undefined}
                        {...form.register(field.name)}
                      />
                    ) : field.kind === "date" ? (
                      <Input id={id} type="date" {...form.register(field.name)} />
                    ) : field.kind === "datetime" ? (
                      <Input
                        id={id}
                        type="datetime-local"
                        {...form.register(field.name)}
                      />
                    ) : field.kind === "time" ? (
                      <Input id={id} type="time" {...form.register(field.name)} />
                    ) : field.kind === "select" ? (
                      <NativeSelect id={id} {...form.register(field.name)}>
                        <option value="">Not set</option>
                        {(field.options ?? []).map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : field.kind === "boolSelect" ? (
                      <NativeSelect id={id} {...form.register(field.name)}>
                        {NULLABLE_BOOL_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </NativeSelect>
                    ) : field.kind === "checkbox" ? (
                      <label
                        htmlFor={id}
                        className="flex h-9 cursor-pointer items-center gap-2 text-sm font-medium text-neutral-800"
                      >
                        <Controller
                          control={form.control}
                          name={field.name}
                          render={({ field: controller }) => (
                            <input
                              id={id}
                              type="checkbox"
                              checked={controller.value === true}
                              onChange={(event) =>
                                controller.onChange(event.target.checked)
                              }
                              onBlur={controller.onBlur}
                              className="h-4 w-4 rounded-sm accent-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
                            />
                          )}
                        />
                        {field.label}
                        {chip}
                      </label>
                    ) : field.kind === "rating" ? (
                      <Controller
                        control={form.control}
                        name={field.name}
                        render={({ field: controller }) => (
                          <RatingControl
                            id={id}
                            value={
                              typeof controller.value === "string"
                                ? controller.value
                                : ""
                            }
                            onChange={controller.onChange}
                            onBlur={controller.onBlur}
                          />
                        )}
                      />
                    ) : (
                      // multiEnum
                      <Controller
                        control={form.control}
                        name={field.name}
                        render={({ field: controller }) => {
                          const selected = Array.isArray(controller.value)
                            ? controller.value
                            : [];
                          return (
                            <div className="flex flex-wrap gap-4">
                              {(field.options ?? []).map((option) => {
                                const optionId = `${id}-${option.value}`;
                                return (
                                  <label
                                    key={option.value}
                                    htmlFor={optionId}
                                    className="flex cursor-pointer items-center gap-2 text-sm text-neutral-800"
                                  >
                                    <input
                                      id={optionId}
                                      type="checkbox"
                                      checked={selected.includes(option.value)}
                                      onChange={() =>
                                        controller.onChange(
                                          selected.includes(option.value)
                                            ? selected.filter(
                                                (item) => item !== option.value,
                                              )
                                            : [...selected, option.value],
                                        )
                                      }
                                      onBlur={controller.onBlur}
                                      className="h-4 w-4 rounded-sm accent-brand-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue"
                                    />
                                    {option.label}
                                  </label>
                                );
                              })}
                            </div>
                          );
                        }}
                      />
                    )}

                    {field.help !== undefined ? (
                      <p className="text-xs text-neutral-500">{field.help}</p>
                    ) : null}
                    {error !== undefined ? (
                      <p role="alert" className="text-xs text-danger-text">
                        {typeof error.message === "string"
                          ? error.message
                          : "This value is invalid."}
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>

            {footer}

            <div className="mt-4 flex items-center justify-end gap-3 border-t border-border-default pt-4">
              {errors.root ? (
                <p role="alert" className="mr-auto text-xs text-danger-text">
                  {errors.root.message}
                </p>
              ) : savedAt !== null ? (
                <p aria-live="polite" className="mr-auto text-xs text-success-text">
                  Saved.
                </p>
              ) : isDirty ? (
                <p className="mr-auto text-xs text-warning-text">
                  Unsaved changes
                </p>
              ) : null}
              <Button
                type="submit"
                variant="secondary"
                size="sm"
                disabled={updateCandidate.isPending}
              >
                {updateCandidate.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </form>
        )}
      </CardContent>
    </Card>
  );
}
