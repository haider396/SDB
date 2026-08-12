/**
 * Admin shell (05-FRONTEND.md §2, §4.1): navy sidebar, top bar, content area
 * max 1440px with 32px gutters. Admin and client trees never share a layout.
 */
import {
  BellRing,
  Building2,
  ClipboardList,
  ListChecks,
  Settings,
  Users,
} from "lucide-react";
import { Outlet } from "react-router-dom";
import { Sidebar, type SidebarNavItem } from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";

const ADMIN_NAV: SidebarNavItem[] = [
  { label: "Attention queue", to: "/admin", icon: BellRing, end: true },
  { label: "Clients", to: "/admin/clients", icon: Building2 },
  { label: "Requisitions", to: "/admin/requisitions", icon: ClipboardList },
  { label: "Candidates", to: "/admin/candidates", icon: Users },
  { label: "Questions", to: "/admin/questions", icon: ListChecks },
  { label: "Settings", to: "/admin/settings", icon: Settings },
];

export function AdminLayout() {
  return (
    <div className="flex h-screen overflow-hidden bg-surface-page">
      <Sidebar items={ADMIN_NAV} areaLabel="Admin" />
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
