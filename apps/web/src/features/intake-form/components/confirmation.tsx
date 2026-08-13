/**
 * Confirmation screen (05 §5 req 9, 01 §3 J1 step 7): requisition reference
 * (with copy-to-clipboard), the review-time expectation, and what happens
 * next. No sign-up is created and none is offered.
 */
import { CheckCircle2, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
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

export function Confirmation({
  requisitionReference,
}: {
  requisitionReference: string;
}) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  async function copyReference() {
    try {
      await navigator.clipboard.writeText(requisitionReference);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  }

  return (
    <Card>
      <CardHeader className="items-center text-center">
        <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-success-subtle">
          <CheckCircle2
            aria-hidden="true"
            className="h-6 w-6 text-success-text"
          />
        </div>
        <CardTitle>Request received</CardTitle>
        <CardDescription>
          Thank you — your hiring request has been submitted. Our team reviews
          new requests within 2 business days.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="rounded-md bg-surface-subtle p-4 text-center">
          <p className="text-xs text-neutral-500">Your reference</p>
          <p className="mt-1 font-mono text-lg font-semibold tracking-tight text-brand-navy-ink">
            {requisitionReference}
          </p>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-2"
            onClick={() => void copyReference()}
          >
            <Copy aria-hidden="true" />
            {copyState === "copied" ? "Copied" : "Copy reference"}
          </Button>
          <p aria-live="polite" className="sr-only">
            {copyState === "copied" ? "Reference copied to clipboard." : ""}
            {copyState === "failed"
              ? "Copying failed — select the reference text to copy it."
              : ""}
          </p>
          <p className="mt-2 text-xs text-neutral-500">
            {copyState === "failed"
              ? "Copying is not available here — select the reference above to copy it."
              : "Keep this handy when contacting us about this request."}
          </p>
        </div>
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
