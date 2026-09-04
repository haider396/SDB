/**
 * A built form, rendered at its public link.
 *
 * Reuses the intake engine wholesale — QuestionField, buildIntakeSchema,
 * visibleQuestions, buildAnswers, StepProgress, ErrorSummary,
 * mapSubmissionError — so a form built on the canvas validates and submits
 * exactly like /register does. The only genuinely new part is the LAYOUT.
 *
 * Consent is unconditional and has no flag: without it a candidate can never be
 * presented to a client, so it is not form content. The typing test and
 * documents steps ARE per-form and come from the payload.
 */
import { useMemo, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { IntakeFormQuestion } from "@sdb/contracts";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import { QuestionField } from "@/features/intake-form/components/question-field";
import { StepProgress } from "@/features/intake-form/components/step-progress";
import { ErrorSummary } from "@/features/intake-form/components/error-summary";
import {
  visibleQuestions,
  type IntakeValues,
} from "@/features/intake-form/conditional";
import {
  mapSubmissionError,
  type SubmissionErrorMap,
} from "@/features/intake-form/error-map";
import { buildIntakeSchema } from "@/features/intake-form/schema-builder";
import { buildAnswers } from "@/features/intake-form/submission";
import { usePublicForm } from "../api";
import { CanvasRenderer } from "./canvas-renderer";
import { formThemeVars } from "./styled-field";

const CONSENT_STEP = "__consent";

export function PublicFormRenderer({ slug }: { slug: string }) {
  const formQuery = usePublicForm(slug);
  const payload = formQuery.data;

  const allQuestions = useMemo<IntakeFormQuestion[]>(
    () => payload?.categories.flatMap((category) => category.questions) ?? [],
    [payload],
  );
  const questionsById = useMemo(
    () => new Map(allQuestions.map((question) => [question.id, question])),
    [allQuestions],
  );
  const schema = useMemo(() => buildIntakeSchema(allQuestions), [allQuestions]);

  const rhf = useForm<IntakeValues>({
    resolver: zodResolver(schema),
    defaultValues: {},
  });
  const values = rhf.watch();
  const visible = useMemo(
    () => visibleQuestions(allQuestions, values),
    [allQuestions, values],
  );
  const visibleKeys = useMemo(
    () => new Set(visible.map((question) => question.key)),
    [visible],
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [consent, setConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<SubmissionErrorMap | null>(null);

  const steps = useMemo(() => {
    if (payload === undefined) return [];
    return [
      ...payload.pages.map((page) => ({
        key: `page-${String(page.index)}`,
        label: page.title,
      })),
      // A literal, unconditional entry. There is no flag to set wrong.
      { key: CONSENT_STEP, label: "Consent" },
    ];
  }, [payload]);

  if (formQuery.isLoading) {
    return <LoadingSkeleton variant="card" rows={4} label="Loading the form…" />;
  }
  // A closed, unknown or draft form all arrive as the same 404 — say nothing
  // about which, and nothing about what the form used to be.
  if (formQuery.isError || payload === undefined) {
    return (
      <div className="space-y-2 text-center">
        <h2 className="text-lg font-semibold text-brand-navy-ink">
          This form is not available
        </h2>
        <p className="text-sm text-neutral-600">
          The link may have expired, or the form is no longer accepting responses.
        </p>
      </div>
    );
  }
  if (submitted) {
    return (
      <div className="space-y-2 text-center">
        <h2 className="text-lg font-semibold text-brand-navy-ink">Thank you</h2>
        <p className="text-sm text-neutral-600">
          Your details are with our team. We will be in touch if there is a match.
        </p>
      </div>
    );
  }

  const isConsentStep = steps[stepIndex]?.key === CONSENT_STEP;
  const currentPage = payload.pages[stepIndex];

  /** Visible questions placed on the current page, in block order. */
  function questionsOnPage(pageIndex: number): IntakeFormQuestion[] {
    return payload!.blocks
      .filter((block) => block.pageIndex === pageIndex && block.questionId !== null)
      .map((block) => questionsById.get(block.questionId!))
      .filter(
        (question): question is IntakeFormQuestion =>
          question !== undefined && visibleKeys.has(question.key),
      );
  }

  async function goNext() {
    if (currentPage !== undefined) {
      const keys = questionsOnPage(currentPage.index).map((q) => q.key);
      const valid = await rhf.trigger(keys);
      if (!valid) return;
    }
    setStepIndex((index) => Math.min(steps.length - 1, index + 1));
  }

  async function submit() {
    setServerError(null);
    setSubmitting(true);
    try {
      const session = await apiFetch<{ sessionId: string }>(
        "/candidate-registrations/session",
        { method: "POST", body: {}, auth: false },
      );
      await apiFetch(
        `/candidate-forms/public/${encodeURIComponent(slug)}/submissions`,
        {
          method: "POST",
          auth: false,
          body: {
            sessionId: session.sessionId,
            formVersionId: payload!.formVersionId,
            formVersionHash: payload!.formVersionHash,
            answers: buildAnswers(visible, rhf.getValues()),
            typingAttempts: [],
            files: [],
            consentToShareProfile: consent,
          },
        },
      );
      setSubmitted(true);
    } catch (error) {
      // ApiError → per-field messages keyed by questionKey (details.fields).
      setServerError(mapSubmissionError(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="sdb-form-scope" style={formThemeVars(payload.theme)}>
      <div className="mx-auto w-full">
        {steps.length > 1 ? (
          <StepProgress
            steps={steps}
            currentIndex={stepIndex}
            onNavigate={(index) => {
              // Backward only: jumping forward would skip validation.
              if (index < stepIndex) setStepIndex(index);
            }}
          />
        ) : null}

        {serverError !== null ? (
          <ErrorSummary
            summary={serverError.summary}
            requestId={serverError.requestId}
            entries={Object.entries(serverError.fieldErrors).map(
              ([questionKey, message]) => ({
                questionKey,
                label:
                  allQuestions.find((q) => q.key === questionKey)?.label ??
                  questionKey,
                message,
              }),
            )}
            onNavigateToField={(questionKey) => {
              const block = payload.blocks.find(
                (candidate) =>
                  candidate.questionId !== null &&
                  questionsById.get(candidate.questionId)?.key === questionKey,
              );
              if (block !== undefined) setStepIndex(block.pageIndex);
            }}
          />
        ) : null}

        {isConsentStep ? (
          <fieldset className="space-y-3 py-4">
            <legend className="sdb-field-label text-sm font-medium">
              Sharing your profile
            </legend>
            <label className="flex items-start gap-2 text-sm text-neutral-700">
              <input
                type="checkbox"
                checked={consent}
                onChange={(event) => setConsent(event.target.checked)}
                className="mt-0.5"
              />
              <span>
                I agree that Staffing Done Better may share my profile with
                prospective clients.
              </span>
            </label>
          </fieldset>
        ) : currentPage !== undefined ? (
          <CanvasRenderer
            blocks={payload.blocks}
            questionsById={questionsById}
            pageIndex={currentPage.index}
            renderQuestion={(question) =>
              visibleKeys.has(question.key) ? (
                <Controller
                  name={question.key}
                  control={rhf.control}
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
              ) : null
            }
          />
        ) : null}

        <div className="mt-6 flex items-center justify-between">
          <Button
            variant="secondary"
            onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
            disabled={stepIndex === 0}
          >
            Back
          </Button>
          {isConsentStep ? (
            <Button onClick={() => void submit()} disabled={!consent || submitting}>
              {submitting ? "Submitting…" : "Submit"}
            </Button>
          ) : (
            <Button onClick={() => void goNext()}>Next</Button>
          )}
        </div>
      </div>
    </div>
  );
}
