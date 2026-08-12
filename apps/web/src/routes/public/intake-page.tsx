/**
 * Public intake form route. The dynamic form renderer (05-FRONTEND.md §5)
 * is delivered in P1; this P0 page establishes the public route tree.
 */
import { FileText } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";

export function IntakePage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-content items-center justify-center p-8">
      <div className="w-full max-w-lg">
        <EmptyState
          icon={FileText}
          title="Staffing intake form"
          description="The intake form opens here in Phase P1. If you were sent a link early, check back shortly or contact your Staffing Done Better representative."
        />
      </div>
    </div>
  );
}
