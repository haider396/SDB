/**
 * Client-portal shell (05-FRONTEND.md §2, §4.1). Entirely separate from the
 * admin layout — no runtime role branching inside pages.
 */
import { ClipboardList, LayoutDashboard } from "lucide-react";
import { Outlet } from "react-router-dom";
import { Sidebar, type SidebarNavItem } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";

const CLIENT_NAV: SidebarNavItem[] = [
  { label: "Dashboard", to: "/client", icon: LayoutDashboard, end: true },
  { label: "My requisitions", to: "/client/requisitions", icon: ClipboardList },
];

export function ClientLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-surface-page">
      <Sidebar items={CLIENT_NAV} areaLabel="Client portal" />
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
