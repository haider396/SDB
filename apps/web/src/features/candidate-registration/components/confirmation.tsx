/**
 * Registration confirmation.
 *
 * No reference number is shown — consistent with the decision taken for the
 * client intake confirmation (T2): identifiers are internal. A registrant who
 * needs to reach us does so by email, not by quoting an id.
 */
import { CheckCircle2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const NEXT_STEPS = [
  "Our recruiters review your profile — usually within a few working days.",
  "If your experience fits a role we are hiring for, we will email you.",
  "We may ask for a short call before putting you forward to a client.",
] as const;

export function RegistrationConfirmation() {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-success-subtle">
          <CheckCircle2
            aria-hidden="true"
            className="h-6 w-6 text-success-text"
          />
        </div>
        <CardTitle className="text-3xl">You&rsquo;re registered</CardTitle>
        <CardDescription>
          Thank you — your profile is with our recruitment team.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <div>
          <h2 className="text-sm font-semibold text-neutral-800">
            What happens next
          </h2>
          <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-neutral-600">
            {NEXT_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </div>
      </CardContent>
    </Card>
  );
}
