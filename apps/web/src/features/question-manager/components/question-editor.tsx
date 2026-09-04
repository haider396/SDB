/**
 * Question create/edit sheet (03 §2.2), RHF + Zod with schemas composed from
 * @sdb/contracts. The §1.5 guard rails are communicated in place:
 *   - key: auto-slugged from the label at creation, immutable afterwards
 *   - type: locked once the question has answers (409 QUESTION_TYPE_LOCKED)
 *   - validation edits warn that existing answers are not re-validated
 * Server rejections (CIRCULAR_CONDITION, INVALID_VALIDATION_RULE, …) land
 * inline next to the responsible section. Dirty-form guard per AC-UI-09.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { FieldErrors, Resolver } from "react-hook-form";
import { z } from "zod";
import {
  ConditionalOperatorSchema,
  QuestionAudienceSchema,
  type QuestionAudience,
  type QuestionDetail,
  QuestionKeySchema,
  QuestionTypeSchema,
  ValidationRulesSchema,
  type CreateQuestionBody,
  type Question,
  type QuestionCategory,
  type UpdateQuestionBody,
} from "@sdb/contracts";
import { Button } from "@/components/ui/button";
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
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Plus } from "lucide-react";
import { ApiError } from "@/lib/api-client";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import {
  roleCategoryChoices,
  useAllQuestions,
  useCreateCategory,
  useCreateQuestion,
  useTaxonomy,
  useUpdateQuestion,
} from "../api";
import {
  hasOptions,
  isMappedQuestionKey,
  pruneValidation,
  slugifyKey,
  toConditionalDraft,
  QUESTION_TYPE_LABELS,
} from "../guard-rails";
import { ConditionalBuilder } from "./conditional-builder";
import { DraftOptionsEditor, SavedOptionsEditor } from "./options-editor";
import { ValidationRulesEditor } from "./validation-rules-editor";

export type EditorState =
  | { mode: "create"; categoryId: string }
  | { mode: "edit"; question: Question };

/**
 * Bounded mirror of QuestionConditionalSchema — same shape, but the value is
 * restricted to what the builder can produce, keeping react-hook-form's path
 * inference off the recursive JsonValue type.
 */
const ConditionalDraftSchema = z.object({
  questionKey: z.string().min(1),
  operator: ConditionalOperatorSchema,
  value: z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.array(z.string()),
    z.null(),
  ]),
});

const EditorSchema = z.object({
  categoryId: z.string().uuid("Choose a category"),
  label: z.string().min(1, "Label is required").max(500),
  key: QuestionKeySchema.or(z.literal("")),
  helpText: z.string().max(2000),
  placeholder: z.string().max(500),
  questionType: QuestionTypeSchema,
  audience: QuestionAudienceSchema,
  isRequired: z.boolean(),
  validation: ValidationRulesSchema,
  roleCategoryIds: z.array(z.string().uuid()),
  conditional: ConditionalDraftSchema.nullable(),
  options: z.array(
    z.object({ value: z.string(), label: z.string() }),
  ),
});
type EditorValues = z.infer<typeof EditorSchema>;

/**
 * Manual resolver (same pattern as the intake renderer): zodResolver's
 * generics blow TS's instantiation depth on the recursive JsonValue type
 * inside QuestionConditionalSchema.
 */
const editorResolver: Resolver<EditorValues> = async (rawValues) => {
  const result = EditorSchema.safeParse(rawValues);
  if (result.success) {
    return { values: result.data, errors: {} };
  }
  const errors: FieldErrors<EditorValues> = {};
  for (const issue of result.error.issues) {
    const key = String(issue.path[0] ?? "root") as keyof EditorValues;
    if (errors[key] === undefined) {
      errors[key] = { type: "validation", message: issue.message };
    }
  }
  return { values: {}, errors };
};

function initialValues(
  state: EditorState,
  audience: QuestionAudience | undefined,
): EditorValues {
  if (state.mode === "create") {
    return {
      categoryId: state.categoryId,
      label: "",
      key: "",
      helpText: "",
      placeholder: "",
      questionType: "short_text",
      // Pinned when the caller owns the audience; otherwise the field is shown
      // and this is only its starting value.
      audience: audience ?? "client",
      isRequired: false,
      validation: {},
      roleCategoryIds: [],
      conditional: null,
      options: [],
    };
  }
  const { question } = state;
  return {
    categoryId: question.categoryId,
    label: question.label,
    key: question.key,
    helpText: question.helpText ?? "",
    placeholder: question.placeholder ?? "",
    questionType: question.questionType,
    audience: question.audience,
    isRequired: question.isRequired,
    validation: question.validation,
    roleCategoryIds: question.roleCategoryIds,
    conditional: toConditionalDraft(question.conditional),
    options: [],
  };
}

export function QuestionEditor({
  state,
  categories,
  onClose,
  audience,
  onCreated,
}: {
  state: EditorState;
  categories: QuestionCategory[];
  onClose: () => void;
  /**
   * Called with the new question after a successful create.
   *
   * The form builder uses it to drop the question straight onto the canvas —
   * creating a field and then hunting for it in a picker is not one action.
   */
  onCreated?: (question: QuestionDetail) => void;
  /**
   * Pin the audience instead of offering it.
   *
   * The form builder passes "candidate" — it owns the candidate registration
   * form, and a question created there is a candidate question by definition.
   * The Questions page leaves this unset and offers Client / Internal, since a
   * candidate question created there would vanish from its own list.
   */
  audience?: QuestionAudience;
}) {
  const createQuestion = useCreateQuestion();
  const updateQuestion = useUpdateQuestion();
  const taxonomyQuery = useTaxonomy();
  // Controller choices for conditionals come from the same side of the fence.
  const allQuestionsQuery = useAllQuestions(audience);

  const createCategory = useCreateCategory();
  const [newCategoryLabel, setNewCategoryLabel] = useState<string | null>(null);
  const [categoryError, setCategoryError] = useState<string | null>(null);

  const [keyTouched, setKeyTouched] = useState(state.mode === "edit");
  const [rootError, setRootError] = useState<{
    message: string;
    requestId: string | null;
  } | null>(null);
  const [conditionalError, setConditionalError] = useState<string | undefined>();

  const form = useForm<EditorValues>({
    mode: "onBlur",
    resolver: editorResolver,
    defaultValues: initialValues(state, audience),
  });
  const { errors, isDirty } = form.formState;
  const questionType = form.watch("questionType");
  const label = form.watch("label");

  // Auto-slug key preview at creation (03 §2.2) until hand-edited.
  useEffect(() => {
    if (state.mode === "create" && !keyTouched) {
      form.setValue("key", slugifyKey(label));
    }
  }, [state.mode, keyTouched, label, form]);

  // ----- Dirty-form guards (AC-UI-09) -----
  // Discard-confirmation via the app's dialog pattern (05 §4.4) — never
  // window.confirm. `discardPrompt` holds what to do on either choice.
  const [discardPrompt, setDiscardPrompt] = useState<{
    discard: () => void;
    keepEditing: () => void;
  } | null>(null);

  // beforeunload + registration with the layout's single navigation blocker
  // (lib/use-dirty-guard.ts — one useBlocker per page). Blocked in-app
  // navigation opens this editor's own discard dialog.
  const onBlocked = useCallback(
    (proceed: () => void, reset: () => void) => {
      setDiscardPrompt({ discard: proceed, keepEditing: reset });
    },
    [],
  );
  useDirtyGuard(isDirty, { onBlocked });

  const requestClose = () => {
    if (isDirty) {
      setDiscardPrompt({
        discard: onClose,
        keepEditing: () => undefined,
      });
      return;
    }
    onClose();
  };

  const editing = state.mode === "edit" ? state.question : null;
  const answerCount = editing?.answerCount ?? 0;
  const typeLocked = editing !== null && answerCount > 0;
  const isMapped = editing !== null && isMappedQuestionKey(editing.key);

  const conditionalCandidates = useMemo(
    () =>
      (allQuestionsQuery.data ?? []).filter(
        (candidate) =>
          candidate.archivedAt === null &&
          (editing === null || candidate.id !== editing.id) &&
          (editing === null ||
            candidate.conditional?.questionKey !== editing.key),
      ),
    [allQuestionsQuery.data, editing],
  );

  const roleChoices = roleCategoryChoices(taxonomyQuery.data);

  const mapServerError = (cause: unknown) => {
    if (cause instanceof ApiError) {
      switch (cause.code) {
        case "CIRCULAR_CONDITION":
          setConditionalError(cause.message);
          return;
        case "INVALID_VALIDATION_RULE":
          form.setError("validation", {
            type: "server",
            message: cause.message,
          });
          return;
        case "QUESTION_TYPE_LOCKED":
          form.setError("questionType", {
            type: "server",
            message:
              "The type is locked because this question already has answers. Create a new question and deactivate this one instead.",
          });
          return;
        default:
          setRootError({ message: cause.message, requestId: cause.requestId });
          return;
      }
    }
    setRootError({
      message: "Could not save the question. Please try again.",
      requestId: null,
    });
  };

  /**
   * Create a category and select it, without leaving the half-filled question.
   *
   * The audience is inherited from this editor: a category made while building
   * a candidate form is a candidate category, which is what keeps it out of the
   * Questions page and in the builder's own picker (0025). The server rejects a
   * question whose category sits on the other side of that fence, so getting
   * this wrong would fail at save rather than silently misfile the question.
   *
   * setValue rather than waiting for the refetch: the new id is valid the
   * moment the POST returns, and the option appears when the invalidated
   * categories query lands a beat later.
   */
  const addCategory = async () => {
    const label = (newCategoryLabel ?? "").trim();
    if (label === "") return;
    setCategoryError(null);
    try {
      const created = await createCategory.mutateAsync({
        label,
        ...(audience === undefined ? {} : { audience }),
      });
      form.setValue("categoryId", created.id, { shouldDirty: true });
      setNewCategoryLabel(null);
    } catch (cause) {
      setCategoryError(
        cause instanceof ApiError
          ? cause.message
          : "Could not create the category.",
      );
    }
  };

  const onSubmit = async (values: EditorValues) => {
    setRootError(null);
    setConditionalError(undefined);

    const validation = pruneValidation(values.questionType, values.validation);
    const completeOptions = values.options.filter(
      (option) => option.label.trim().length > 0 && option.value.length > 0,
    );

    try {
      if (state.mode === "create") {
        if (hasOptions(values.questionType) && completeOptions.length === 0) {
          form.setError("options", {
            type: "validate",
            message: "Add at least one option for a select question.",
          });
          return;
        }
        const body: CreateQuestionBody = {
          categoryId: values.categoryId,
          ...(values.key !== "" ? { key: values.key } : {}),
          label: values.label,
          helpText: values.helpText === "" ? null : values.helpText,
          placeholder: values.placeholder === "" ? null : values.placeholder,
          questionType: values.questionType,
          audience: audience ?? values.audience,
          isRequired: values.isRequired,
          validation,
          roleCategoryIds: values.roleCategoryIds,
          conditional: values.conditional,
          ...(hasOptions(values.questionType)
            ? { options: completeOptions }
            : {}),
        };
        const created = await createQuestion.mutateAsync(body);
        onCreated?.(created);
      } else {
        const body: UpdateQuestionBody = {
          categoryId: values.categoryId,
          label: values.label,
          helpText: values.helpText === "" ? null : values.helpText,
          placeholder: values.placeholder === "" ? null : values.placeholder,
          audience: audience ?? values.audience,
          isRequired: values.isRequired,
          validation,
          roleCategoryIds: values.roleCategoryIds,
          conditional: values.conditional,
          ...(!typeLocked && values.questionType !== state.question.questionType
            ? { questionType: values.questionType }
            : {}),
        };
        await updateQuestion.mutateAsync({
          id: state.question.id,
          categoryId: state.question.categoryId,
          body,
        });
      }
      form.reset(values); // clears isDirty so closing needs no confirm
      onClose();
    } catch (cause) {
      mapServerError(cause);
    }
  };

  const isSaving = createQuestion.isPending || updateQuestion.isPending;

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) requestClose();
      }}
    >
      <SheetContent aria-describedby={undefined}>
        <SheetHeader>
          <SheetTitle>
            {state.mode === "create"
              ? "New question"
              : `Edit “${state.question.label}”`}
          </SheetTitle>
          {editing !== null ? (
            <SheetDescription>
              {answerCount === 1 ? "1 answer" : `${answerCount} answers`} so
              far
              {isMapped
                ? " · mapped question — its key and lifecycle are protected"
                : ""}
            </SheetDescription>
          ) : null}
        </SheetHeader>

        <form
          noValidate
          className="flex min-h-0 flex-1 flex-col"
          onSubmit={(event) => {
            event.preventDefault();
            void form.handleSubmit(onSubmit)(event);
          }}
        >
          <SheetBody className="space-y-5">
            {rootError !== null ? (
              <div
                role="alert"
                className="rounded-md bg-danger-subtle px-3 py-2 text-sm text-danger-text"
              >
                <p>{rootError.message}</p>
                {rootError.requestId !== null ? (
                  <p className="mt-1 font-mono text-xs">
                    Request ID: {rootError.requestId}
                  </p>
                ) : null}
              </div>
            ) : null}

            <div className="space-y-1.5">
              {/* The action sits on the label row, not under the field: a bare
                  link wedged beneath the select read as leftover markup next to
                  properly styled controls. */}
              <div className="flex items-baseline justify-between gap-2">
                <Label htmlFor="question-category">Category</Label>
                {newCategoryLabel === null ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="-my-1 h-auto px-2 py-1 text-2xs font-medium"
                    onClick={() => {
                      setNewCategoryLabel("");
                      setCategoryError(null);
                    }}
                  >
                    <Plus className="mr-1 h-3 w-3" aria-hidden="true" />
                    New category
                  </Button>
                ) : null}
              </div>
              <NativeSelect
                id="question-category"
                {...form.register("categoryId")}
              >
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.label}
                  </option>
                ))}
              </NativeSelect>

              {/*
                Categories group answers on the candidate's record, so a form
                asking about something the existing sections do not cover needs
                a heading of its own. Without this it is a dead end: candidate
                categories are managed nowhere else.
              */}
              {newCategoryLabel !== null ? (
                <div className="space-y-2 rounded-md border border-border-default bg-surface-subtle p-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="question-editor-new-category">New category</Label>
                    <Input
                      id="question-editor-new-category"
                      value={newCategoryLabel}
                      placeholder="e.g. Your portfolio"
                      aria-invalid={categoryError !== null || undefined}
                      aria-describedby="question-editor-new-category-help"
                      onKeyDown={(event) => {
                        // Enter must not submit the whole question form.
                        if (event.key === "Enter") {
                          event.preventDefault();
                          void addCategory();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setNewCategoryLabel(null);
                        }
                      }}
                      onChange={(event) => setNewCategoryLabel(event.target.value)}
                    />
                    <p id="question-editor-new-category-help" className="text-2xs text-neutral-600">
                      Groups these answers under their own heading on the
                      candidate&rsquo;s record.
                    </p>
                  </div>
                  {categoryError !== null ? (
                    <p role="alert" className="text-xs text-danger-text">
                      {categoryError}
                    </p>
                  ) : null}
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      onClick={() => setNewCategoryLabel(null)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      disabled={
                        newCategoryLabel.trim() === "" || createCategory.isPending
                      }
                      onClick={() => void addCategory()}
                    >
                      {createCategory.isPending ? "Adding…" : "Add category"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="question-label">Label</Label>
              <Input
                id="question-label"
                aria-invalid={errors.label !== undefined || undefined}
                {...form.register("label")}
              />
              {errors.label?.message !== undefined ? (
                <p className="text-xs text-danger-text">
                  {errors.label.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="question-key">Key</Label>
              {state.mode === "create" ? (
                <>
                  <Input
                    id="question-key"
                    className="font-mono"
                    {...form.register("key", {
                      onChange: () => setKeyTouched(true),
                    })}
                  />
                  <p className="text-xs text-neutral-500">
                    Auto-generated from the label. Editable now, immutable
                    after creation — it is the reporting join key.
                  </p>
                  {errors.key?.message !== undefined ? (
                    <p className="text-xs text-danger-text">
                      {errors.key.message}
                    </p>
                  ) : null}
                </>
              ) : (
                <>
                  <Input
                    id="question-key"
                    className="font-mono"
                    value={state.question.key}
                    readOnly
                    aria-readonly="true"
                  />
                  <p className="text-xs text-neutral-500">
                    Keys are immutable after creation — this one joins every
                    historical answer.
                  </p>
                </>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="question-help-text">Help text</Label>
              <Textarea
                id="question-help-text"
                rows={2}
                {...form.register("helpText")}
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="question-placeholder">Placeholder</Label>
              <Input
                id="question-placeholder"
                {...form.register("placeholder")}
              />
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="question-type">Type</Label>
                <NativeSelect
                  id="question-type"
                  disabled={typeLocked}
                  aria-invalid={errors.questionType !== undefined || undefined}
                  {...form.register("questionType")}
                >
                  {QuestionTypeSchema.options.map((type) => (
                    <option key={type} value={type}>
                      {QUESTION_TYPE_LABELS[type]}
                    </option>
                  ))}
                </NativeSelect>
                {typeLocked ? (
                  <p className="text-xs text-neutral-500">
                    Locked: this question has{" "}
                    {answerCount === 1 ? "1 answer" : `${answerCount} answers`}
                    . Changing type would corrupt reporting — create a new
                    question and deactivate this one instead.
                  </p>
                ) : null}
                {errors.questionType?.message !== undefined ? (
                  <p role="alert" className="text-xs text-danger-text">
                    {errors.questionType.message}
                  </p>
                ) : null}
              </div>

              {audience === undefined ? (
                <div className="space-y-1.5">
                  <Label htmlFor="question-audience">Audience</Label>
                  <NativeSelect
                    id="question-audience"
                    {...form.register("audience")}
                  >
                    <option value="client">
                      Client — shown on intake forms
                    </option>
                    <option value="internal">Internal — admin only</option>
                  </NativeSelect>
                  <p className="text-2xs text-neutral-600">
                    Candidate questions are built in Forms, alongside the form
                    that asks them.
                  </p>
                </div>
              ) : null}
            </div>

            <label className="flex items-center gap-2 text-sm font-medium text-neutral-800">
              <input type="checkbox" {...form.register("isRequired")} />
              Required
            </label>

            <Separator />

            <section aria-label="Validation rules" className="space-y-2">
              <h3 className="text-sm font-semibold text-brand-navy-ink">
                Validation
              </h3>
              {answerCount > 0 ? (
                <p className="text-xs text-warning-text">
                  Existing answers are not re-validated — new rules apply to
                  future submissions only.
                </p>
              ) : null}
              <Controller
                control={form.control}
                name="validation"
                render={({ field }) => (
                  <ValidationRulesEditor
                    questionType={questionType}
                    value={field.value}
                    onChange={field.onChange}
                  />
                )}
              />
              {errors.validation?.message !== undefined ? (
                <p role="alert" className="text-xs text-danger-text">
                  {errors.validation.message}
                </p>
              ) : null}
            </section>

            {hasOptions(questionType) ? (
              <>
                <Separator />
                <section aria-label="Options" className="space-y-2">
                  <h3 className="text-sm font-semibold text-brand-navy-ink">
                    Options
                  </h3>
                  {editing !== null ? (
                    <SavedOptionsEditor
                      questionId={editing.id}
                      categoryId={editing.categoryId}
                      options={editing.options}
                    />
                  ) : (
                    <Controller
                      control={form.control}
                      name="options"
                      render={({ field }) => (
                        <DraftOptionsEditor
                          value={field.value}
                          onChange={field.onChange}
                        />
                      )}
                    />
                  )}
                  {errors.options?.message !== undefined ? (
                    <p role="alert" className="text-xs text-danger-text">
                      {errors.options.message}
                    </p>
                  ) : null}
                </section>
              </>
            ) : null}

            <Separator />

            <section aria-label="Role category scoping" className="space-y-2">
              <h3 className="text-sm font-semibold text-brand-navy-ink">
                Role categories
              </h3>
              <p className="text-xs text-neutral-500">
                Scope this question to specific role categories, or leave all
                unticked to ask it universally.
              </p>
              <Controller
                control={form.control}
                name="roleCategoryIds"
                render={({ field }) => (
                  <div className="space-y-1">
                    {roleChoices.map((choice) => (
                      <label
                        key={choice.id}
                        className="flex items-center gap-2 text-sm text-neutral-800"
                      >
                        <input
                          type="checkbox"
                          checked={field.value.includes(choice.id)}
                          onChange={(event) =>
                            field.onChange(
                              event.target.checked
                                ? [...field.value, choice.id]
                                : field.value.filter(
                                    (id: string) => id !== choice.id,
                                  ),
                            )
                          }
                        />
                        {choice.pathLabel}
                      </label>
                    ))}
                    {roleChoices.length === 0 ? (
                      <p className="text-xs text-neutral-500">
                        {taxonomyQuery.isPending
                          ? "Loading role categories…"
                          : "No role categories available."}
                      </p>
                    ) : null}
                  </div>
                )}
              />
            </section>

            <Separator />

            <section aria-label="Conditional visibility" className="space-y-2">
              <h3 className="text-sm font-semibold text-brand-navy-ink">
                Conditional visibility
              </h3>
              <Controller
                control={form.control}
                name="conditional"
                render={({ field }) => (
                  <ConditionalBuilder
                    value={field.value}
                    onChange={(next) => {
                      setConditionalError(undefined);
                      field.onChange(next);
                    }}
                    candidates={conditionalCandidates}
                    serverError={conditionalError}
                  />
                )}
              />
            </section>
          </SheetBody>

          <SheetFooter>
            <Button type="button" variant="secondary" onClick={requestClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSaving}>
              {isSaving
                ? "Saving…"
                : state.mode === "create"
                  ? "Create question"
                  : "Save changes"}
            </Button>
          </SheetFooter>
        </form>

        <Dialog
          open={discardPrompt !== null}
          onOpenChange={(open) => {
            if (!open && discardPrompt !== null) {
              discardPrompt.keepEditing();
              setDiscardPrompt(null);
            }
          }}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Discard unsaved changes?</DialogTitle>
              <DialogDescription>
                This question has edits that have not been saved. Discarding
                cannot be undone.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="secondary"
                onClick={() => {
                  discardPrompt?.keepEditing();
                  setDiscardPrompt(null);
                }}
              >
                Keep editing
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  const prompt = discardPrompt;
                  setDiscardPrompt(null);
                  prompt?.discard();
                }}
              >
                Discard changes
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </SheetContent>
    </Sheet>
  );
}
