/**
 * P0 placeholder index pages for the admin tree. Real pages arrive in the
 * phases noted on each (CLAUDE.md build order).
 */
import { BellRing, Settings } from "lucide-react";
import { PlaceholderPage } from "@/components/patterns/placeholder-page";

const HOME = { label: "Admin", to: "/admin" };

export function AttentionQueuePage() {
  return (
    <PlaceholderPage
      breadcrumbs={[{ label: "Attention queue" }]}
      title="Attention queue"
      subtitle="Everything that needs an admin decision, oldest first"
      icon={BellRing}
      phase="Phase P6"
      description="Items needing attention — stalled requisitions, pending approvals, and overdue interviews — will queue here."
    />
  );
}

export function SettingsPage() {
  return (
    <PlaceholderPage
      breadcrumbs={[HOME, { label: "Settings" }]}
      title="Settings"
      subtitle="Taxonomy, users, and portal configuration"
      icon={Settings}
      phase="Phase P2"
      description="Engines, departments, role categories, and user management will live here."
    />
  );
}
