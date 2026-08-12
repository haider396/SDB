/**
 * P0 placeholder index pages for the admin tree. Real pages arrive in the
 * phases noted on each (CLAUDE.md build order). The attention queue became
 * a real page in P6 — see features/admin-dashboard.
 */
import { Settings } from "lucide-react";
import { PlaceholderPage } from "@/components/patterns/placeholder-page";

const HOME = { label: "Admin", to: "/admin" };

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
