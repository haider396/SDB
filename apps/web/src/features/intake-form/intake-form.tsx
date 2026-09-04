/**
 * Intake form renderer — 05-FRONTEND.md §5, requirements 1–9.
 *
 * Multi-step: one "Role" step (cascading taxonomy selects) followed by one
 * step per question category. All answer state lives in react-hook-form,
 * in memory only — nothing is ever written to localStorage/sessionStorage
 * (AC-IF-17); in the default public mode both data hooks call the API with
 * `auth: false` so the Supabase client is never initialised on that page.
 *
 * One engine, two entry points (03 §3.5): `mode="portal"` renders the same
 * form inside the authenticated client portal for a second hire — GETs
 * carry a bearer token, `prefill` answers (company/contact, from the
 * client record) render read-only, and submission goes to
 * POST /requisitions, with `onSubmitted` receiving the new requisition.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import type { FieldErrors, Resolver } from "react-hook-form";
import { FileQuestion } from "lucide-react";
import type {
  InPortalRequisitionResponse,
  IntakeFormCategory,
  IntakeFormQuestion,
  IntakeSubmissionResponse,
} from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/patterns/empty-state";
import { ErrorState } from "@/components/patterns/error-state";
import { useDirtyGuard } from "@/lib/use-dirty-guard";
import {
  useIntakeForm,
  usePublicTaxonomy,
  useSubmitInPortalRequisition,
  useSubmitIntake,
} from "./api";
import { isQuestionVisible, type IntakeValues } from "./conditional";
import { mapSubmissionError, type SubmissionErrorMap } from "./error-map";
import { validateIntakeValues } from "./schema-builder";
import { buildSubmission } from "./submission";
import { Confirmation } from "./components/confirmation";
import {
  ErrorSummary,
  focusField,
  type SummaryEntry,
} from "./components/error-summary";
import { IntakeFormSkeleton } from "./components/intake-form-skeleton";
import { QuestionField } from "./components/question-field";
import { StepProgress, type ProgressStep } from "./components/step-progress";
import {
  EMPTY_TAXONOMY_SELECTION,
  TaxonomyStep,
  validateTaxonomySelection,
  type TaxonomyErrors,
  type TaxonomySelection,
} from "./components/taxonomy-step";

const ROLE_STEP: ProgressStep = { key: "__role", label: "Role", questionCount: 3 };

function bySortOrder<T extends { sortOrder: number }>(a: T, b: T): number {
  return a.sortOrder - b.sortOrder;
}

/** A prefilled answer rendered read-only (03 §3.5 in-portal mode). */
function PrefilledField({
  question,
  value,
}: {
  question: IntakeFormQuestion;
  value: string;
}) {
  const id = `field-${question.key}`;
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{question.label}</Label>
      <Input id={id} value={value} readOnly aria-describedby={`${id}-note`} />
      <p id={`${id}-note`} className="text-xs text-neutral-500">
        Prefilled from your account and cannot be edited here.
      </p>
    </div>
  );
}

export interface IntakeFormProps {
  /**
   * "public" (default): unauthenticated, POST /intake-submissions.
   * "portal": authenticated in-portal second hire (03 §3.5), POST
   * /requisitions attaching to the caller's own client.
   */
  mode?: "public" | "portal";
  /** Portal mode: read-only answers by questionKey (company/contact). */
  prefill?: Readonly<Record<string, string>>;
  /** Portal mode: called on success instead of the public confirmation. */
  onSubmitted?: (result: InPortalRequisitionResponse) => void;
}

export function IntakeForm({
  mode = "public",
  prefill,
  onSubmitted,
}: IntakeFormProps = {}) {
  const isPortal = mode === "portal";
  const taxonomyQuery = usePublicTaxonomy(isPortal);
  const [selection, setSelection] = useState<TaxonomySelection>(
    EMPTY_TAXONOMY_SELECTION,
  );
  const [taxonomyErrors, setTaxonomyErrors] = useState<TaxonomyErrors>({});
  const formQuery = useIntakeForm(selection.roleCategoryId, isPortal);
  const submitMutation = useSubmitIntake();
  const submitInPortalMutation = useSubmitInPortalRequisition();
  const isSubmitting = isPortal
    ? submitInPortalMutation.isPending
    : submitMutation.isPending;

  const [stepIndex, setStepIndex] = useState(0);
  const [announcement, setAnnouncement] = useState("");
  const [serverError, setServerError] = useState<SubmissionErrorMap | null>(
    null,
  );
  const [submitted, setSubmitted] = useState<IntakeSubmissionResponse | null>(
    null,
  );

  const categories: IntakeFormCategory[] = useMemo(
    () =>
      (formQuery.data?.categories ?? [])
        .slice()
        .sort(bySortOrder)
        .map((category) => ({
          ...category,
          questions: category.questions.slice().sort(bySortOrder),
        })),
    [formQuery.data],
  );
  const allQuestions: IntakeFormQuestion[] = useMemo(
    () => categories.flatMap((category) => category.questions),
    [categories],
  );

  // The resolver reads questions through a ref so a role-category refetch
  // (05 §5 req 1) never rebuilds the form state.
  const questionsRef = useRef<IntakeFormQuestion[]>([]);
  useEffect(() => {
    questionsRef.current = allQuestions;
  }, [allQuestions]);

  const resolver = useMemo<Resolver<IntakeValues>>(
    () => async (rawValues) => {
      const values = rawValues as IntakeValues;
      const visible = questionsRef.current.filter((question) =>
        isQuestionVisible(question, questionsRef.current, values),
      );
      const result = validateIntakeValues(visible, values);
      if (result.values !== null) {
        return { values: result.values, errors: {} };
      }
      const errors: FieldErrors<IntakeValues> = {};
      for (const [key, message] of Object.entries(result.errors)) {
        errors[key] = { type: "validation", message };
      }
      return { values: {}, errors };
    },
    [],
  );

  const form = useForm<IntakeValues>({
    mode: "onBlur",
    reValidateMode: "onBlur",
    resolver,
    // Prefilled (read-only) answers participate in validation, conditional
    // visibility, and submission exactly like typed ones.
    defaultValues: prefill === undefined ? {} : { ...prefill },
  });
  const values = form.watch();
  const { errors: fieldErrors, isDirty } = form.formState;

  // Unsaved-changes guard (05 §4.4, AC-UI-09). Both modes confirm before
  // tab close; in portal mode the registration additionally arms the client
  // layout's single in-app navigation blocker (UX 3.5 — the public page has
  // no in-app navigation, and mounts no blocker).
  useDirtyGuard(isDirty && submitted === null);

  const visibleByCategory = (category: IntakeFormCategory) =>
    category.questions.filter((question) =>
      isQuestionVisible(question, allQuestions, values),
    );

  // Per-step question counts feed the visible "Step n of N · k questions"
  // line; counts follow conditional visibility, so they shift as answers do.
  const steps: ProgressStep[] = [
    ROLE_STEP,
    ...categories.map((category) => ({
      key: category.key,
      label: category.label,
      questionCount: visibleByCategory(category).length,
    })),
  ];

  // A category step whose questions are ALL conditionally hidden is skipped
  // on Next/Back (UX 3.5). Its pill stays; landing on it directly (via the
  // pill) still renders the "no questions apply" note.
  const isSkippableStep = (index: number): boolean => {
    if (index === 0) return false;
    const category = categories[index - 1];
    return category !== undefined && visibleByCategory(category).length === 0;
  };
  const nextEnabledStep = (from: number): number | null => {
    for (let index = from + 1; index < steps.length; index += 1) {
      if (!isSkippableStep(index)) return index;
    }
    return null;
  };
  const previousEnabledStep = (from: number): number => {
    for (let index = from - 1; index > 0; index -= 1) {
      if (!isSkippableStep(index)) return index;
    }
    return 0;
  };

  const stepIndexOfQuestion = (questionKey: string): number => {
    const categoryIndex = categories.findIndex((category) =>
      category.questions.some((question) => question.key === questionKey),
    );
    return categoryIndex === -1 ? stepIndex : categoryIndex + 1;
  };

  const goToStep = (index: number, skippedLabels: string[] = []) => {
    const step = steps[index];
    if (step === undefined) return;
    setStepIndex(index);
    const skipNote =
      skippedLabels.length > 0
        ? `Skipped ${skippedLabels.join(", ")} — no questions apply. `
        : "";
    setAnnouncement(
      `${skipNote}Step ${index + 1} of ${steps.length}: ${step.label}`,
    );
    if (typeof window.scrollTo === "function") {
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  };

  /** Labels of the skippable steps strictly between two step indexes. */
  const skippedLabelsBetween = (from: number, to: number): string[] => {
    const labels: string[] = [];
    for (let index = from + 1; index < to; index += 1) {
      if (isSkippableStep(index)) {
        const label = steps[index]?.label;
        if (label !== undefined) labels.push(label);
      }
    }
    return labels;
  };

  const navigateToField = (questionKey: string) => {
    goToStep(stepIndexOfQuestion(questionKey));
    requestAnimationFrame(() => focusField(questionKey));
  };

  const handleNext = async () => {
    if (stepIndex === 0) {
      const errors = validateTaxonomySelection(selection);
      setTaxonomyErrors(errors);
      if (Object.keys(errors).length > 0) return;
      const next = nextEnabledStep(0);
      if (next !== null) goToStep(next, skippedLabelsBetween(0, next));
      return;
    }
    const category = categories[stepIndex - 1];
    if (category === undefined) return;
    const keys = visibleByCategory(category).map((question) => question.key);
    const valid = await form.trigger(keys);
    if (!valid) {
      const firstInvalid = keys.find((key) => form.getFieldState(key).invalid);
      if (firstInvalid !== undefined) focusField(firstInvalid);
      return;
    }
    const next = nextEnabledStep(stepIndex);
    if (next !== null) goToStep(next, skippedLabelsBetween(stepIndex, next));
  };

  const onValid = async (parsedValues: IntakeValues) => {
    setServerError(null);
    const formDefinition = formQuery.data;
    if (formDefinition === undefined || selection.roleCategoryId === undefined) {
      return;
    }
    const submission = buildSubmission(
      formDefinition.formVersionHash,
      selection.roleCategoryId,
      questionsRef.current,
      parsedValues,
    );
    try {
      if (isPortal) {
        const result = await submitInPortalMutation.mutateAsync(submission);
        setAnnouncement(
          "Your request was submitted.",
        );
        onSubmitted?.(result);
        return;
      }
      const result = await submitMutation.mutateAsync(submission);
      setSubmitted(result);
      setAnnouncement(
        "Your request was submitted.",
      );
    } catch (error) {
      const mapped = mapSubmissionError(error);
      for (const [key, message] of Object.entries(mapped.fieldErrors)) {
        form.setError(key, { type: "server", message });
      }
      setServerError(mapped);
      setAnnouncement(mapped.summary);
      const firstKey = questionsRef.current
        .map((question) => question.key)
        .find((key) => mapped.fieldErrors[key] !== undefined);
      if (firstKey !== undefined) {
        navigateToField(firstKey);
      } else {
        document.getElementById("intake-error-summary")?.focus();
      }
    }
  };

  const onInvalid = (submitErrors: FieldErrors<IntakeValues>) => {
    setAnnouncement("Some answers need attention before submitting.");
    const firstKey = questionsRef.current
      .map((question) => question.key)
      .find((key) => submitErrors[key] !== undefined);
    if (firstKey !== undefined) navigateToField(firstKey);
  };

  // ----- States (05 §4.3) -----
  if (taxonomyQuery.isPending || (formQuery.isPending && !formQuery.data)) {
    return <IntakeFormSkeleton />;
  }
  if (taxonomyQuery.isError || formQuery.isError) {
    return (
      <ErrorState
        error={taxonomyQuery.isError ? taxonomyQuery.error : formQuery.error}
        onRetry={() => {
          if (taxonomyQuery.isError) void taxonomyQuery.refetch();
          if (formQuery.isError) void formQuery.refetch();
        }}
      />
    );
  }
  const taxonomy = taxonomyQuery.data;
  if (taxonomy === undefined) {
    return <IntakeFormSkeleton />;
  }
  // Empty state (AC-UI-02): the form has no questions at all. Before a role
  // is chosen only universal questions exist, so the role step must still
  // render even when the universal set is empty.
  if (allQuestions.length === 0 && selection.roleCategoryId !== undefined) {
    return (
      <EmptyState
        icon={FileQuestion}
        title="The intake form is not available"
        description="There are no questions configured for this form right now. Please check back shortly or contact your Staffing Done Better representative."
      />
    );
  }
  if (submitted !== null) {
    return (
      <div className="space-y-4">
        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
        <Confirmation />
      </div>
    );
  }

  // Last step = nothing enabled after this one (trailing all-hidden steps
  // are skipped, so Submit can surface earlier than the final pill).
  const isLastStep = nextEnabledStep(stepIndex) === null;
  const currentCategory =
    stepIndex > 0 ? categories[stepIndex - 1] : undefined;
  const summaryEntries: SummaryEntry[] = allQuestions
    .filter((question) => fieldErrors[question.key] !== undefined)
    .map((question) => ({
      questionKey: question.key,
      label: question.label,
      message:
        fieldErrors[question.key]?.message ?? "This answer needs attention.",
    }));
  /**
   * Summary for SERVER errors only.
   *
   * 05 §4.4 asks for "errors summarised at the top with anchor links to each
   * field", and that earns its place when the offending field is on another
   * step or otherwise off-screen — which is exactly the server-error case,
   * since the server validates every step at once.
   *
   * It does NOT earn its place for client-side required checks: those fields
   * are on the step you are looking at, already carry an inline message
   * directly beneath them, and the banner just restates all of them at once —
   * which reads as a wall of red rather than as help. Client-side errors are
   * inline only.
   */
  const showSummary = serverError !== null;

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit(onValid, onInvalid)(event);
      }}
      className="space-y-6"
    >
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      <StepProgress
        steps={steps}
        currentIndex={stepIndex}
        onNavigate={goToStep}
      />

      {showSummary ? (
        <ErrorSummary
          summary={
            serverError?.summary ??
            "Some answers need attention. Fix the items below and submit again."
          }
          entries={summaryEntries}
          requestId={serverError?.requestId ?? null}
          onNavigateToField={navigateToField}
        />
      ) : null}

      {formQuery.isFetching ? (
        <p aria-live="polite" className="text-xs text-neutral-500">
          Updating questions for your selected role…
        </p>
      ) : null}

      {stepIndex === 0 ? (
        <section aria-label="Role" className="rounded-lg bg-surface-raised p-6 shadow-sm">
          <h2 className="text-lg font-semibold tracking-tight text-brand-navy-ink">
            Who are you hiring?
          </h2>
          <p className="mt-1 text-sm text-neutral-500">
            Pick the part of your business this hire supports. Role-specific
            questions are added based on your choice.
          </p>
          <div className="mt-5">
            <TaxonomyStep
              taxonomy={taxonomy}
              selection={selection}
              errors={taxonomyErrors}
              onChange={(next) => {
                setSelection(next);
                setTaxonomyErrors({});
              }}
            />
          </div>
        </section>
      ) : currentCategory !== undefined ? (
        <section
          aria-label={currentCategory.label}
          className="rounded-lg bg-surface-raised p-6 shadow-sm"
        >
          <h2 className="text-lg font-semibold tracking-tight text-brand-navy-ink">
            {currentCategory.label}
          </h2>
          {currentCategory.description !== null ? (
            <p className="mt-1 text-sm text-neutral-500">
              {currentCategory.description}
            </p>
          ) : null}
          <div className="mt-5 space-y-5">
            {visibleByCategory(currentCategory).length === 0 ? (
              <p className="text-sm text-neutral-500">
                No questions in this section apply to your earlier answers.
              </p>
            ) : (
              visibleByCategory(currentCategory).map((question) =>
                prefill !== undefined && question.key in prefill ? (
                  <PrefilledField
                    key={question.id}
                    question={question}
                    value={prefill[question.key] ?? ""}
                  />
                ) : (
                  <Controller
                    key={question.id}
                    control={form.control}
                    name={question.key}
                    render={({ field, fieldState }) => (
                      <QuestionField
                        question={question}
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        error={fieldState.error?.message}
                      />
                    )}
                  />
                ),
              )
            )}
          </div>
        </section>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            const previous = previousEnabledStep(stepIndex);
            goToStep(previous, skippedLabelsBetween(previous, stepIndex));
          }}
          className={stepIndex === 0 ? "invisible" : undefined}
        >
          Back
        </Button>
        {isLastStep ? (
          // Disabled only while in flight — never for validation state
          // (05 §4.4): submit and show people what is wrong.
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Submitting…" : "Submit request"}
          </Button>
        ) : (
          <Button type="button" onClick={() => void handleNext()}>
            Next
          </Button>
        )}
      </div>
    </form>
  );
}
