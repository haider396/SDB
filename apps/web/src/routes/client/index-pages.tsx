/**
 * P0 placeholder index pages for the client-portal tree. Real pages arrive
 * in Phase P5 (CLAUDE.md build order).
 */
import { ClipboardList, LayoutDashboard } from "lucide-react";
import { PlaceholderPage } from "@/components/patterns/placeholder-page";

export function ClientDashboardPage() {
  return (
    <PlaceholderPage
      breadcrumbs={[{ label: "Dashboard" }]}
      title="Dashboard"
      subtitle="Your hiring at a glance"
      icon={LayoutDashboard}
      phase="Phase P5"
      description="Your open requisitions, candidates awaiting review, and upcoming interviews will appear here."
    />
  );
}

export function ClientRequisitionsPage() {
  return (
    <PlaceholderPage
      breadcrumbs={[{ label: "Dashboard", to: "/client" }, { label: "My requisitions" }]}
      title="My requisitions"
      subtitle="Track every role you have open with us"
      icon={ClipboardList}
      phase="Phase P5"
      description="Requisition tracking and candidate review — approve, reject, or request an interview — will live here."
    />
  );
}
