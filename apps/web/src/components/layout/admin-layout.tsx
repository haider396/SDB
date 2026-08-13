/**
 * Admin shell (05-FRONTEND.md §2, §4.1): navy sidebar (persistent ≥lg,
 * drawer below), top bar, content area max 1440px with 32px gutters (16px
 * below md). Admin and client trees never share a layout.
 */
import {
  BarChart3,
  BellRing,
  Building2,
  ClipboardList,
  FileText,
  ListChecks,
  Send,
  Settings,
  Users,
} from "lucide-react";
import { Suspense, useState } from "react";
import { Outlet } from "react-router-dom";
import {
  MobileNavDrawer,
  Sidebar,
  type SidebarNavItem,
} from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { DirtyNavigationBlocker } from "@/lib/use-dirty-guard";
import { useAttentionQueueTotal } from "@/features/admin-dashboard";

const ADMIN_NAV: SidebarNavItem[] = [
  { label: "Attention queue", to: "/admin", icon: BellRing, end: true },
  { label: "Clients", to: "/admin/clients", icon: Building2 },
  { label: "Requisitions", to: "/admin/requisitions", icon: ClipboardList },
  { label: "Candidates", to: "/admin/candidates", icon: Users },
  { label: "Questions", to: "/admin/questions", icon: ListChecks },
  { label: "Stats", to: "/admin/stats", icon: BarChart3 },
  { label: "Reports", to: "/admin/reports/rejection-reasons", icon: FileText },
  { label: "Notifications", to: "/admin/notifications", icon: Send },
  { label: "Settings", to: "/admin/settings", icon: Settings },
];

export function AdminLayout() {
  // Pending-work pill on the queue nav item (renders only when > 0).
  const queueTotal = useAttentionQueueTotal();
  const [isNavOpen, setNavOpen] = useState(false);
  const nav = ADMIN_NAV.map((item) =>
    item.to === "/admin" && queueTotal !== undefined && queueTotal > 0
      ? { ...item, badgeCount: queueTotal }
      : item,
  );
  return (
    <div className="flex h-screen overflow-hidden bg-surface-page">
      <DirtyNavigationBlocker />
      <Sidebar items={nav} areaLabel="Admin" />
      <MobileNavDrawer
        items={nav}
        areaLabel="Admin"
        open={isNavOpen}
        onOpenChange={setNavOpen}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenNav={() => setNavOpen(true)} />
        {/* main scrolls the page; the flex chain lets a page opt into a
            fixed-height layout by giving its root `flex-1 min-h-0` (list
            pages: fixed filters, scrolling table). Pages without that root
            keep the old behaviour — content grows and main scrolls. */}
        <main className="flex flex-1 flex-col overflow-y-auto">
          <div className="mx-auto flex w-full max-w-content flex-1 flex-col px-4 py-6 md:px-8 md:py-8">
            <Suspense
              fallback={
                <LoadingSkeleton variant="card" rows={3} label="Loading…" />
              }
            >
              <Outlet />
            </Suspense>
          </div>
        </main>
      </div>
    </div>
  );
}
