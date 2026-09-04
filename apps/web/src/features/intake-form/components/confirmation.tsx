/**
 * Confirmation screen (05 §5 req 9, 01 §3 J1 step 7): the review-time
 * expectation and what happens next. No sign-up is created and none is offered.
 *
 * DEVIATION from 05 §5 req 9: the requisition reference (and its
 * copy-to-clipboard control) was removed at the client's request — see
 * docs/CHANGE-REQUESTS-2026-08-13.md T2. Rebecca's position is that the
 * REQ id is internal ("that's a database thing, clients don't care"). The
 * API still returns `requisitionReference` and AC-IF-14 still holds; it is
 * simply no longer surfaced here.
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
  "Our team reviews your request and confirms the brief.",
  "We source and vet candidates matched to what you described.",
  "We contact you at the email you provided to agree next steps.",
] as const;

export function Confirmation() {
  return (
    <Card>
      <CardHeader className="items-center text-center">
        <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-success-subtle">
          <CheckCircle2
            aria-hidden="true"
            className="h-6 w-6 text-success-text"
          />
        </div>
        <CardTitle className="text-3xl">Request received</CardTitle>
        <CardDescription>
          Thank you — your hiring request has been submitted. Our team reviews
          new requests within 2 business days.
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
