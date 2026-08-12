/**
 * Client-portal shell (05-FRONTEND.md §2, §4.1). Entirely separate from the
 * admin layout — no runtime role branching inside pages.
 *
 * Nav badges surface the dashboard's pending-action counts (principal
 * approvals + candidates awaiting review). The query is shared with the
 * dashboard page's cache entry; a failure here just renders no badges.
 */
import { ClipboardList, LayoutDashboard } from "lucide-react";
import { Outlet } from "react-router-dom";
import { Sidebar, type SidebarNavItem } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { useClientDashboard } from "@/features/client-portal/api";

export function ClientLayout() {
  const dashboardQuery = useClientDashboard();
  const pendingActions = dashboardQuery.data?.pendingActions;
  const principalCount = pendingActions?.principalApprovals.length ?? 0;
  const reviewCount = pendingActions?.candidatesAwaitingReview.length ?? 0;

  const items: SidebarNavItem[] = [
    {
      label: "Dashboard",
      to: "/client",
      icon: LayoutDashboard,
      end: true,
      badgeCount: principalCount + reviewCount,
    },
    {
      label: "My requisitions",
      to: "/client/requisitions",
      icon: ClipboardList,
      badgeCount: reviewCount,
    },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-surface-page">
      <Sidebar items={items} areaLabel="Client portal" />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-content px-8 py-8">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
