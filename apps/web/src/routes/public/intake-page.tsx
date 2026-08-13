/**
 * Public intake form route (05-FRONTEND.md §5, 01 §3 J1). Unauthenticated;
 * the renderer talks to the two public endpoints only and never touches
 * browser storage (AC-IF-17).
 *
 * The time estimate is derived from the actual question count (~4 questions
 * per minute, rounded up to 5-minute bands — UX 3.5). The universal form is
 * fetched here with the SAME query key the renderer uses, so this costs no
 * extra request.
 */
import { IntakeForm, useIntakeForm } from "@/features/intake-form";
import { usePageTitle } from "@/lib/use-page-title";

/** ~4 questions/minute, rounded up to a 5-minute band, capped at 15. */
export function estimateMinutes(questionCount: number): number {
  const minutes = questionCount / 4;
  return Math.min(15, Math.max(5, Math.ceil(minutes / 5) * 5));
}

/** The 3 role selects + a sensible default before the form loads. */
const DEFAULT_QUESTION_COUNT = 20;

export function IntakePage() {
  usePageTitle("Tell us who you need");
  // Same key as the renderer's initial fetch — shared cache, no double call.
  const formQuery = useIntakeForm(undefined);
  const questionCount =
    formQuery.data === undefined
      ? DEFAULT_QUESTION_COUNT
      : formQuery.data.categories.reduce(
          (total, category) => total + category.questions.length,
          3,
        );
  const minutes = estimateMinutes(questionCount);

  return (
    <div className="min-h-screen bg-surface-page">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-8">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-brand-navy-ink">
            Tell us who you need
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Answer a few questions about your business and the role. It takes
            about {minutes} minutes, and nothing is saved on this device.
          </p>
        </header>
        <main>
          <IntakeForm />
        </main>
      </div>
    </div>
  );
}
