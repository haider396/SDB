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
 *
 * ⚠ Until Sep 2026 that last sentence was a lie: this component read NEITHER
 * flag. An admin ticked "collect documents", saw a Documents step in the
 * builder's Preview, published — and candidates were never asked for a CV,
 * because `steps` was built from `payload.pages` alone and `submit()` posted
 * `files: []` unconditionally. The tail is now assembled from `payload.form.*`
 * in the SAME order the Preview and /register use (pages → typing → documents
 * → consent), from the SAME components /register renders, so the two public
 * paths cannot silently drift apart again.
 */
import { useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import type {
  FormBlock,
  IntakeFormQuestion,
  TypingAttempt,
} from "@sdb/contracts";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/api-client";
import { startRegistrationSession } from "@/features/candidate-registration/api";
import { ConsentStep } from "@/features/candidate-registration/components/consent-step";
import { DocumentsStep } from "@/features/candidate-registration/components/documents-step";
import { TypingTest } from "@/features/candidate-registration/components/typing-test";
import type { AttachedFile } from "@/features/candidate-registration/types";
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
import {
  activeRowErrors,
  readRows,
  repeatingGroupConfig,
  summaryEntriesFor,
} from "@/features/intake-form/repeating-group";
import { buildIntakeSchema } from "@/features/intake-form/schema-builder";
import { buildAnswers } from "@/features/intake-form/submission";
import { usePublicForm } from "../api";
import { extraGridRowsFor, shiftForGrowth } from "../layout-growth";
import { CanvasRenderer } from "./canvas-renderer";
import { formThemeVars } from "./styled-field";

/** The steps the canvas does not own. Same keys and order as /register. */
const TYPING_STEP = "__typing";
const DOCUMENTS_STEP = "__documents";
const CONSENT_STEP = "__consent";

/** A stable empty list for the render before the payload arrives. */
const NO_BLOCKS: readonly FormBlock[] = [];

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

  /**
   * Fill-time canvas growth.
   *
   * The canvas places every block at an explicit grid row, so a repeating
   * group the candidate has added rows to renders ON TOP of the block beneath
   * it. block-height.ts sizes such a block for its base state only; the rows
   * above that are made room for here, and only here.
   *
   * On a form with no repeating group `extras` is empty, `shiftForGrowth`
   * returns `payload.blocks` BY REFERENCE, and CanvasRenderer therefore sees
   * the same array it saw before this feature existed (AC-FB-11). Do not
   * "simplify" either of these to an unconditional map().
   */
  const extras = useMemo(() => {
    const byBlockId = new Map<string, number>();
    if (payload === undefined) return byBlockId;
    for (const block of payload.blocks) {
      if (block.questionId === null) continue;
      const question = questionsById.get(block.questionId);
      if (question === undefined) continue;
      const config = repeatingGroupConfig(question);
      if (config === null) continue;
      const extra = extraGridRowsFor(
        config,
        readRows(values[question.key]).length,
      );
      if (extra > 0) byBlockId.set(block.id, extra);
    }
    return byBlockId;
  }, [payload, questionsById, values]);
  const grownBlocks = useMemo(
    () => shiftForGrowth(payload?.blocks ?? NO_BLOCKS, extras),
    [payload, extras],
  );

  const [stepIndex, setStepIndex] = useState(0);
  const [consent, setConsent] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [serverError, setServerError] = useState<SubmissionErrorMap | null>(null);
  const [typingAttempts, setTypingAttempts] = useState<TypingAttempt[]>([]);
  const [manualWpm, setManualWpm] = useState("");
  const [files, setFiles] = useState<AttachedFile[]>([]);

  /**
   * The registration session, created lazily on the first upload — a visitor
   * who opens the link and leaves should not create a row.
   *
   * The ref holds the PROMISE, not the resolved id: DocumentsStep can start a
   * CV and a photo upload before either resolves, and two `ensureSession()`
   * calls racing to POST would stage the two files against two different
   * sessions — at which point submit attaches whichever one it happened to
   * send and the other file is silently lost (attachRegistrationFiles matches
   * on session_id).
   */
  const sessionRef = useRef<Promise<string> | null>(null);
  function ensureSession(): Promise<string> {
    if (sessionRef.current === null) {
      sessionRef.current = startRegistrationSession()
        .then((session) => session.sessionId)
        .catch((cause: unknown) => {
          // Never cache a rejection: a retry after a dropped connection has to
          // be able to ask for a session again.
          sessionRef.current = null;
          throw cause;
        });
    }
    return sessionRef.current;
  }

  /**
   * Double-submit guard. `submitting` state is not enough on its own — two
   * clicks in the same tick both read the pre-render `false` and both post,
   * which is how duplicate candidates get created. The ref flips
   * synchronously; the state still drives the button's label and disabled
   * attribute.
   */
  const submitLock = useRef(false);

  const steps = useMemo(() => {
    if (payload === undefined) return [];
    return [
      ...payload.pages.map((page) => ({
        key: `page-${String(page.index)}`,
        label: page.title,
      })),
      // Per-form, exactly as the builder's Preview shows them.
      ...(payload.form.hasTypingTest
        ? [{ key: TYPING_STEP, label: "Typing speed" }]
        : []),
      ...(payload.form.hasDocumentsStep
        ? [{ key: DOCUMENTS_STEP, label: "Documents" }]
        : []),
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

  const currentStepKey = steps[stepIndex]?.key;
  const isConsentStep = currentStepKey === CONSENT_STEP;
  const isTypingStep = currentStepKey === TYPING_STEP;
  const isDocumentsStep = currentStepKey === DOCUMENTS_STEP;
  // Pages occupy the leading step slots, so the index maps straight across;
  // the tail steps fall off the end and leave this undefined.
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
    if (submitLock.current) return;
    submitLock.current = true;
    setServerError(null);
    setSubmitting(true);
    try {
      // The same session the uploads were staged against, or a fresh one when
      // this form has no documents step and nothing has needed one yet.
      const sessionId = await ensureSession();
      await apiFetch(
        `/candidate-forms/public/${encodeURIComponent(slug)}/submissions`,
        {
          method: "POST",
          auth: false,
          body: {
            sessionId,
            formVersionId: payload!.formVersionId,
            formVersionHash: payload!.formVersionHash,
            answers: buildAnswers(visible, rhf.getValues()),
            // Both are populated only by the tail steps above, which only
            // exist when the flag is on — so a form with the flags off still
            // posts the empty arrays the server's step guards demand
            // (candidate-form-submission.service.ts 422s on either).
            typingAttempts,
            files: files.map((file) => ({
              fileId: file.fileId,
              fileType: file.fileType,
            })),
            consentToShareProfile: consent,
          },
        },
      );
      setSubmitted(true);
    } catch (error) {
      // ApiError → per-field messages keyed by questionKey (details.fields).
      setServerError(mapSubmissionError(error));
    } finally {
      submitLock.current = false;
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
            // flatMap: a repeating group contributes one line per failing
            // cell, each anchored at that cell rather than at the table.
            entries={Object.entries(serverError.fieldErrors).flatMap(
              ([questionKey, message]) => {
                const question = allQuestions.find(
                  (q) => q.key === questionKey,
                );
                return question === undefined
                  ? [{ questionKey, label: questionKey, message }]
                  : summaryEntriesFor(
                      question,
                      message,
                      serverError.rowErrors[questionKey],
                    );
              },
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

        {/* Named region per step: the canvas pages carry their own headings,
            the tail steps do not, and without a name a screen-reader user
            arriving at "Documents" has only the progress bar to go on. */}
        <section aria-label={steps[stepIndex]?.label ?? "Step"}>
          {isTypingStep ? (
            <div className="py-4">
              <TypingTest
                attempts={typingAttempts}
                onAttemptsChange={setTypingAttempts}
                manualWpm={manualWpm}
                onManualWpmChange={setManualWpm}
              />
            </div>
          ) : isDocumentsStep ? (
            <div className="py-4">
              <DocumentsStep
                files={files}
                onFilesChange={setFiles}
                ensureSession={ensureSession}
              />
            </div>
          ) : isConsentStep ? (
            <div className="py-4">
              {/* The same component /register renders, rather than a second
                  wording of the same promise — the two used to disagree about
                  what the candidate was agreeing to. `error` stays null here
                  because this renderer gates Submit on the checkbox instead. */}
              <ConsentStep
                consent={consent}
                onConsentChange={setConsent}
                error={null}
              />
            </div>
          ) : currentPage !== undefined ? (
            <CanvasRenderer
              blocks={grownBlocks}
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
                        // zodResolver nests a repeating group's issues under
                        // the field name, so fieldState.error carries the whole
                        // rows tree — not just a message.
                        rowErrors={activeRowErrors(
                          fieldState.error,
                          serverError?.rowErrors[question.key],
                        )}
                      />
                    )}
                  />
                ) : null
              }
            />
          ) : null}
        </section>

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
