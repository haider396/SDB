/**
 * P0 placeholder index pages for the admin tree. Real pages arrive in the
 * phases noted on each (CLAUDE.md build order).
 */
import {
  BellRing,
  Building2,
  ClipboardList,
  ListChecks,
  Settings,
  Users,
} from "lucide-react";
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

export function ClientsPage() {
  return (
    <PlaceholderPage
      breadcrumbs={[HOME, { label: "Clients" }]}
      title="Clients"
      subtitle="Client companies, members, and portal access"
      icon={Building2}
      phase="Phase P2"
      description="Client management — companies, access granting, and the principal approval flow — will live here."
    />
  );
}

export function RequisitionsPage() {
  return (
    <PlaceholderPage
      breadcrumbs={[HOME, { label: "Requisitions" }]}
      title="Requisitions"
      subtitle="Every open role across all clients"
      icon={ClipboardList}
      phase="Phase P2"
      description="The full requisition list with filters by status, client, engine, and role category will live here."
    />
  );
}

export function CandidatesPage() {
  return (
    <PlaceholderPage
      breadcrumbs={[HOME, { label: "Candidates" }]}
      title="Candidates"
      subtitle="The talent pool across all requisitions"
      icon={Users}
      phase="Phase P3"
      description="Candidate profiles, file uploads, and the inbound webhook feed will live here."
    />
  );
}

export function QuestionsPage() {
  return (
    <PlaceholderPage
      breadcrumbs={[HOME, { label: "Questions" }]}
      title="Questions"
      subtitle="Intake form questions and categories"
      icon={ListChecks}
      phase="Phase P1"
      description="The two-pane question manager with drag reordering and live form preview will live here."
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
