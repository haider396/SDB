/**
 * Public candidate registration form (T38).
 *
 * Reuses the intake engine's field-level machinery rather than duplicating it:
 * `QuestionField` (the exhaustive type→component map), `buildIntakeSchema`
 * (Zod built from the question definitions), `visibleQuestions` (conditional
 * evaluation), `buildAnswers` (wire shape), `StepProgress`, and
 * `mapSubmissionError`. Only the orchestration differs — there is no taxonomy
 * cascade here, and two extra steps (typing test, documents) sit alongside the
 * configurable question categories.
 *
 * Nothing is persisted to localStorage or sessionStorage: a public form may be
 * filled on a shared machine, which is the reasoning behind AC-IF-17 and
 * applies identically here.
 */
import { useMemo, useRef, useState } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type { IntakeFormQuestion } from "@sdb/contracts";
import { Button } from "@/components/ui/button";
import { ErrorState } from "@/components/patterns/error-state";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { QuestionField } from "@/features/intake-form/components/question-field";
import { StepProgress } from "@/features/intake-form/components/step-progress";
import { ErrorSummary } from "@/features/intake-form/components/error-summary";
import { visibleQuestions, type IntakeValues } from "@/features/intake-form/conditional";
import { mapSubmissionError, type SubmissionErrorMap } from "@/features/intake-form/error-map";
import { buildIntakeSchema } from "@/features/intake-form/schema-builder";
import { buildAnswers } from "@/features/intake-form/submission";
import { startRegistrationSession, useRegistrationForm, useSubmitRegistration } from "./api";
import { RegistrationConfirmation } from "./components/confirmation";
import { ConsentStep } from "./components/consent-step";
import { DocumentsStep } from "./components/documents-step";
import { TypingTest } from "./components/typing-test";
import type { AttachedFile } from "./types";

/** The two steps the question engine does not own. */
const TYPING_STEP_KEY = "__typing";
const DOCUMENTS_STEP_KEY = "__documents";
const CONSENT_STEP_KEY = "__consent";

export function RegistrationForm() {
  const formQuery = useRegistrationForm();
  const submitMutation = useSubmitRegistration();

  const [stepIndex, setStepIndex] = useState(0);
  const [submitted, setSubmitted] = useState(false);
  const [serverError, setServerError] = useState<SubmissionErrorMap | null>(null);
  const [typingAttempts, setTypingAttempts] = useState<
    { wpm: number; accuracy: number; durationSeconds: number }[]
  >([]);
  const [manualWpm, setManualWpm] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);
  const [consent, setConsent] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);

  // The session is created lazily on first upload — a visitor who browses and
  // leaves should not create a row.
  const sessionRef = useRef<string | null>(null);
  async function ensureSession(): Promise<string> {
    if (sessionRef.current !== null) return sessionRef.current;
    const session = await startRegistrationSession();
    sessionRef.current = session.sessionId;
    return session.sessionId;
  }

  const categories = useMemo(
    () =>
      (formQuery.data?.categories ?? [])
        .slice()
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [formQuery.data],
  );

  const allQuestions = useMemo(
    () => categories.flatMap((category) => category.questions),
    [categories],
  );

  const schema = useMemo(() => buildIntakeSchema(allQuestions), [allQuestions]);

  const form = useForm<IntakeValues>({
    resolver: zodResolver(schema),
    mode: "onBlur",
    defaultValues: {},
  });

  const values = form.watch();
  const visible = useMemo(
    () => visibleQuestions(allQuestions, values),
    [allQuestions, values],
  );
  const visibleKeys = useMemo(
    () => new Set(visible.map((question) => question.key)),
    [visible],
  );

  const steps = useMemo(
    () => [
      ...categories.map((category) => ({
        key: category.key,
        label: category.label,
      })),
      { key: TYPING_STEP_KEY, label: "Typing speed" },
      { key: DOCUMENTS_STEP_KEY, label: "Documents" },
      { key: CONSENT_STEP_KEY, label: "Consent" },
    ],
    [categories],
  );

  if (formQuery.isLoading) {
    return <LoadingSkeleton variant="card" rows={4} label="Loading the form…" />;
  }
  if (formQuery.isError) {
    return (
      <ErrorState
        error={formQuery.error}
        onRetry={() => void formQuery.refetch()}
      />
    );
  }
  if (submitted) return <RegistrationConfirmation />;

  const currentStep = steps[stepIndex];
  const currentCategory = categories[stepIndex];
  const isLastStep = stepIndex === steps.length - 1;

  /** Questions on this step that are currently visible. */
  const stepQuestions: IntakeFormQuestion[] =
    currentCategory === undefined
      ? []
      : currentCategory.questions.filter((question) =>
          visibleKeys.has(question.key),
        );

  async function goNext() {
    if (currentCategory !== undefined) {
      // Validate only this step's visible fields before advancing.
      const ok = await form.trigger(
        stepQuestions.map((question) => question.key),
      );
      if (!ok) return;
    }
    setStepIndex((index) => Math.min(index + 1, steps.length - 1));
  }

  async function handleSubmit() {
    setServerError(null);
    setConsentError(null);
    if (!consent) {
      setConsentError(
        "We need your permission to share your profile before we can continue.",
      );
      return;
    }
    const ok = await form.trigger();
    if (!ok) return;

    const hash = formQuery.data?.formVersionHash ?? "";
    const sessionId =
      sessionRef.current ?? (files.length > 0 ? await ensureSession() : null);

    try {
      await submitMutation.mutateAsync({
        // A session is required by the API; create one now if uploads never did.
        sessionId: sessionId ?? (await ensureSession()),
        formVersionHash: hash,
        answers: buildAnswers(visible, form.getValues()),
        typingAttempts,
        files: files.map((file) => ({
          fileId: file.fileId,
          fileType: file.fileType,
        })),
        consentToShareProfile: consent,
      });
      setSubmitted(true);
    } catch (cause) {
      const mapped = mapSubmissionError(cause);
      for (const [key, message] of Object.entries(mapped.fieldErrors)) {
        form.setError(key, { type: "server", message });
      }
      setServerError(mapped);
    }
  }

  return (
    <div className="space-y-6">
      <StepProgress
        steps={steps}
        currentIndex={stepIndex}
        // Backward navigation only — jumping ahead would skip validation.
        onNavigate={(index) => {
          if (index < stepIndex) setStepIndex(index);
        }}
      />

      {serverError !== null ? (
        <ErrorSummary
          summary={serverError.summary}
          requestId={serverError.requestId}
          entries={Object.entries(serverError.fieldErrors).map(
            ([questionKey, message]) => ({
              questionKey,
              label:
                allQuestions.find((question) => question.key === questionKey)
                  ?.label ?? questionKey,
              message,
            }),
          )}
          onNavigateToField={(questionKey) => {
            // Server errors can point at a field on an earlier step; move
            // there first so the anchor exists before focus is attempted.
            const target = categories.findIndex((category) =>
              category.questions.some(
                (question) => question.key === questionKey,
              ),
            );
            if (target >= 0) setStepIndex(target);
          }}
        />
      ) : null}

      <section aria-label={currentStep?.label ?? "Step"} className="space-y-5">
        <h2 className="text-lg font-semibold tracking-tight text-brand-navy-ink">
          {currentStep?.label}
        </h2>

        {currentCategory !== undefined ? (
          <>
            {currentCategory.description !== null ? (
              <p className="text-sm text-neutral-600">
                {currentCategory.description}
              </p>
            ) : null}
            <div className="space-y-5">
              {stepQuestions.map((question) => (
                <Controller
                  key={question.key}
                  name={question.key}
                  control={form.control}
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
              ))}
            </div>
          </>
        ) : currentStep?.key === TYPING_STEP_KEY ? (
          <TypingTest
            attempts={typingAttempts}
            onAttemptsChange={setTypingAttempts}
            manualWpm={manualWpm}
            onManualWpmChange={setManualWpm}
          />
        ) : currentStep?.key === DOCUMENTS_STEP_KEY ? (
          <DocumentsStep
            files={files}
            onFilesChange={setFiles}
            ensureSession={ensureSession}
          />
        ) : (
          <ConsentStep
            consent={consent}
            onConsentChange={setConsent}
            error={consentError}
          />
        )}
      </section>

      <div className="flex items-center justify-between gap-3">
        <Button
          type="button"
          variant="secondary"
          disabled={stepIndex === 0}
          onClick={() => setStepIndex((index) => Math.max(index - 1, 0))}
        >
          Back
        </Button>
        {isLastStep ? (
          <Button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={submitMutation.isPending}
          >
            {submitMutation.isPending ? "Submitting…" : "Submit registration"}
          </Button>
        ) : (
          <Button type="button" onClick={() => void goNext()}>
            Next
          </Button>
        )}
      </div>
    </div>
  );
}
