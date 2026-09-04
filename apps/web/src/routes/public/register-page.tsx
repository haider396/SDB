/**
 * Public candidate registration route (T38). Unauthenticated; the renderer
 * talks only to the public registration endpoints and never touches browser
 * storage — a public form may be completed on a shared machine (AC-IF-17's
 * reasoning, applied here).
 *
 * Branded per Haider's request: the shared Business Done Better mark and the
 * gradient strip used on the login card, so the form reads as ours rather than
 * as an anonymous questionnaire. Tokens only — no colour literals (AC-UI-01).
 */
import logoUrl from "@/assets/logo.png";
import { Card, CardContent } from "@/components/ui/card";
import { RegistrationForm } from "@/features/candidate-registration";
import { usePageTitle } from "@/lib/use-page-title";

export function RegisterPage() {
  usePageTitle("Join our talent pool");

  return (
    <div className="min-h-screen bg-surface-page">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-8">
        <header className="mb-8 flex flex-col items-center text-center">
          <img
            src={logoUrl}
            alt="Business Done Better"
            className="mb-6 h-12 w-auto"
          />
          <h1 className="text-3xl font-semibold tracking-tight text-brand-navy-ink">
            Join our talent pool
          </h1>
          <p className="mt-2 max-w-prose text-sm text-neutral-600">
            Tell us about your experience and we will match you with remote
            roles at companies hiring through Staffing Done Better. Nothing is
            saved on this device.
          </p>
        </header>

        <main>
          <Card className="overflow-hidden">
            {/* Brand moment: 4px gradient strip, rounded with the card. */}
            <div aria-hidden="true" className="h-1 bg-gradient-brand" />
            <CardContent className="p-6">
              <RegistrationForm />
            </CardContent>
          </Card>
        </main>

        <footer className="mt-8 text-center text-xs text-neutral-600">
          Your information is handled per our privacy commitments and is never
          shared with a client without your permission.
        </footer>
      </div>
    </div>
  );
}
