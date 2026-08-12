/**
 * Public intake form route (05-FRONTEND.md §5, 01 §3 J1). Unauthenticated;
 * the renderer talks to the two public endpoints only and never touches
 * browser storage (AC-IF-17).
 */
import { IntakeForm } from "@/features/intake-form";

export function IntakePage() {
  return (
    <div className="min-h-screen bg-surface-page">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-8">
        <header className="mb-8">
          <h1 className="text-2xl font-semibold tracking-tight text-brand-navy-ink">
            Tell us who you need
          </h1>
          <p className="mt-1 text-sm text-neutral-500">
            Answer a few questions about your business and the role. It takes
            about five minutes, and nothing is saved on this device.
          </p>
        </header>
        <main>
          <IntakeForm />
        </main>
      </div>
    </div>
  );
}
