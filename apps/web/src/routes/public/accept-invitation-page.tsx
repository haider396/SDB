/**
 * Public invitation-acceptance route (POST /auth/accept-invitation).
 * The full flow ships with access granting in P2; this P0 page establishes
 * the route.
 */
import { MailOpen } from "lucide-react";
import { EmptyState } from "@/components/patterns/empty-state";

export function AcceptInvitationPage() {
  return (
    <div className="mx-auto flex min-h-screen max-w-content items-center justify-center p-8">
      <div className="w-full max-w-lg">
        <EmptyState
          icon={MailOpen}
          title="Accept your invitation"
          description="Invitation acceptance opens here in Phase P2. If you received an invitation email, keep it — the link will work once the portal opens."
        />
      </div>
    </div>
  );
}
