/**
 * Consent step (T38).
 *
 * Deliberately NOT a configurable question. Without
 * `has_consent_to_share_profile` a candidate can never be presented to a
 * client — the API rejects the attempt with 422 CONSENT_MISSING (AC-PL-05) —
 * so leaving it to editable form content would let a well-meaning edit quietly
 * break the pipeline. Capturing it here, from the candidate, with a timestamp,
 * is also a stronger record than an admin ticking a box later.
 */
import { ShieldCheck } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface Props {
  consent: boolean;
  onConsentChange: (value: boolean) => void;
  error: string | null;
}

export function ConsentStep({ consent, onConsentChange, error }: Props) {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="space-y-3 p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck aria-hidden="true" className="h-4 w-4 text-brand-blue" />
            <h3 className="text-sm font-semibold text-brand-navy-ink">
              How we use your information
            </h3>
          </div>
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-neutral-600">
            <li>
              Our recruiters review your profile and may contact you about roles
              that fit.
            </li>
            <li>
              We share your profile with a client company only when we put you
              forward for one of their roles.
            </li>
            <li>
              Your contact details stay hidden from the client until an
              interview is arranged.
            </li>
            <li>You can ask us to remove your profile at any time.</li>
          </ul>
        </CardContent>
      </Card>

      <label className="flex cursor-pointer items-start gap-3 text-sm text-neutral-800">
        <input
          type="checkbox"
          checked={consent}
          onChange={(event) => onConsentChange(event.target.checked)}
          aria-describedby={error !== null ? "consent-error" : undefined}
          className="mt-0.5 h-4 w-4"
        />
        <span>
          I agree that Staffing Done Better may store my information and share
          my profile with client companies when putting me forward for a role.
        </span>
      </label>

      {error !== null ? (
        <p id="consent-error" role="alert" className="text-sm text-danger-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
