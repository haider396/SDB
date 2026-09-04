/**
 * /f/:slug — a built candidate form at its shared public link.
 *
 * Mirrors the /register shell exactly (logo, brand strip, card, footer) so a
 * generated form is visibly the same product as the seeded one. Tokens only —
 * no colour literals (AC-UI-01).
 */
import { useParams } from "react-router-dom";
import logoUrl from "@/assets/logo.png";
import { Card, CardContent } from "@/components/ui/card";
import { PublicFormRenderer } from "@/features/form-builder/render/public-form-renderer";
import { usePageTitle } from "@/lib/use-page-title";

export function PublicFormPage() {
  const { slug = "" } = useParams<{ slug: string }>();
  usePageTitle("Apply");

  return (
    <div className="min-h-screen bg-surface-page">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-8">
        <header className="mb-8 text-center">
          <img
            src={logoUrl}
            alt="Business Done Better"
            className="mx-auto mb-6 h-8 w-auto"
          />
        </header>
        <Card className="overflow-hidden">
          {/* The brand moment, matching /register. */}
          <div aria-hidden="true" className="h-1 bg-gradient-brand" />
          <CardContent className="p-0">
            <PublicFormRenderer slug={slug} />
          </CardContent>
        </Card>
        <p className="mt-6 text-center text-xs text-neutral-600">
          Your details are used only to consider you for roles with our clients.
        </p>
      </div>
    </div>
  );
}
