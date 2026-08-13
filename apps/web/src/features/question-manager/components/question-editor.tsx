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
import { ApiError } from "@/lib/api-client";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import {
  roleCategoryChoices,
  useAllQuestions,
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

function initialValues(state: EditorState): EditorValues {
  if (state.mode === "create") {
    return {
      categoryId: state.categoryId,
      label: "",
      key: "",
      helpText: "",
      placeholder: "",
      questionType: "short_text",
      audience: "client",
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
}: {
  state: EditorState;
  categories: QuestionCategory[];
  onClose: () => void;
}) {
  const createQuestion = useCreateQuestion();
  const updateQuestion = useUpdateQuestion();
  const taxonomyQuery = useTaxonomy();
  const allQuestionsQuery = useAllQuestions();

  const [keyTouched, setKeyTouched] = useState(state.mode === "edit");
  const [rootError, setRootError] = useState<{
    message: string;
    requestId: string | null;
  } | null>(null);
  const [conditionalError, setConditionalError] = useState<string | undefined>();

  const form = useForm<EditorValues>({
    mode: "onBlur",
    resolver: editorResolver,
    defaultValues: initialValues(state),
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
          audience: values.audience,
          isRequired: values.isRequired,
          validation,
          roleCategoryIds: values.roleCategoryIds,
          conditional: values.conditional,
          ...(hasOptions(values.questionType)
            ? { options: completeOptions }
            : {}),
        };
        await createQuestion.mutateAsync(body);
      } else {
        const body: UpdateQuestionBody = {
          categoryId: values.categoryId,
          label: values.label,
          helpText: values.helpText === "" ? null : values.helpText,
          placeholder: values.placeholder === "" ? null : values.placeholder,
          audience: values.audience,
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
              <Label htmlFor="question-category">Category</Label>
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

              <div className="space-y-1.5">
                <Label htmlFor="question-audience">Audience</Label>
                <NativeSelect
                  id="question-audience"
                  {...form.register("audience")}
                >
                  <option value="client">Client — shown on intake forms</option>
                  <option value="internal">Internal — admin only</option>
                </NativeSelect>
              </div>
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
