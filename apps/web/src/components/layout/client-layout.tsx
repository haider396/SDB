/**
 * Client-portal shell (05-FRONTEND.md §2, §4.1). Entirely separate from the
 * admin layout — no runtime role branching inside pages.
 *
 * Nav badges surface the dashboard's pending-action counts (principal
 * approvals + candidates awaiting review). The query is shared with the
 * dashboard page's cache entry; a failure here just renders no badges.
 */
import { ClipboardList, LayoutDashboard } from "lucide-react";
import { Suspense, useState } from "react";
import { Outlet } from "react-router-dom";
import {
  MobileNavDrawer,
  Sidebar,
  type SidebarContact,
  type SidebarNavItem,
} from "@/components/layout/sidebar";
import { TopBar } from "@/components/layout/top-bar";
import { LoadingSkeleton } from "@/components/patterns/loading-skeleton";
import { DirtyNavigationBlocker } from "@/lib/use-dirty-guard";
import { useClientDashboard } from "@/features/client-portal/api";

// TODO(client): confirm the SDB contact address for the portal footer.
const SDB_CONTACT_EMAIL = "rebecca@teamdonebetter.com";

const CLIENT_CONTACT: SidebarContact = {
  prompt: "Questions?",
  linkLabel: "Contact your SDB team",
  email: SDB_CONTACT_EMAIL,
};

export function ClientLayout() {
  const dashboardQuery = useClientDashboard();
  const [isNavOpen, setNavOpen] = useState(false);
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
      <DirtyNavigationBlocker />
      <Sidebar items={items} areaLabel="Client portal" contact={CLIENT_CONTACT} />
      <MobileNavDrawer
        items={items}
        areaLabel="Client portal"
        contact={CLIENT_CONTACT}
        open={isNavOpen}
        onOpenChange={setNavOpen}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar onOpenNav={() => setNavOpen(true)} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-content px-4 py-6 md:px-8 md:py-8">
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
