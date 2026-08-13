/**
 * Persistent left sidebar: 264px expanded, 64px collapsed, state remembered
 * per user (05-FRONTEND.md §4.1). Chrome uses --brand-navy (§3.5).
 */
import type { LucideIcon } from "lucide-react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { NavLink } from "react-router-dom";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useUiStore } from "@/stores/ui-store";
import logoUrl from "@/assets/logo.png";

export interface SidebarNavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
  /** Pending-action count rendered as a pill; omitted or 0 renders nothing. */
  badgeCount?: number;
}

export interface SidebarProps {
  items: SidebarNavItem[];
  /** Short product-area label under the wordmark, e.g. "Admin" or "Client portal". */
  areaLabel: string;
}

export function Sidebar({ items, areaLabel }: SidebarProps) {
  const isCollapsed = useUiStore((state) => state.isSidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  return (
    <TooltipProvider delayDuration={150}>
      <aside
        className={cn(
          "flex h-screen shrink-0 flex-col bg-brand-navy text-brand-on-dark transition-all duration-base ease-out",
          isCollapsed ? "w-sidebar-collapsed" : "w-sidebar-expanded",
        )}
      >
        <div
          className={cn(
            "flex h-14 items-center gap-2 border-b border-brand-navy-hover",
            isCollapsed ? "justify-center px-0" : "px-4",
          )}
        >
          {isCollapsed ? (
            <span
              aria-hidden="true"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gradient-brand text-sm font-bold"
            >
              SD
            </span>
          ) : (
            <>
              {/* The lock-up is navy-on-transparent; a light chip keeps it
                  legible on the navy chrome. */}
              <span className="flex shrink-0 items-center rounded-md bg-brand-on-dark px-2 py-1">
                <img
                  src={logoUrl}
                  alt="Business Done Better"
                  className="h-6 w-auto"
                />
              </span>
              <p className="min-w-0 truncate text-xs font-medium leading-tight text-brand-teal">
                {areaLabel}
              </p>
            </>
          )}
        </div>

        <nav aria-label="Primary" className="flex-1 overflow-y-auto py-4">
          <ul className="space-y-1 px-2">
            {items.map((item) => {
              const link = (
                <NavLink
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "flex h-10 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors duration-fast",
                      isCollapsed && "justify-center px-0",
                      isActive
                        ? "bg-brand-blue text-brand-on-dark"
                        : "text-neutral-300 hover:bg-brand-navy-hover hover:text-brand-on-dark",
                    )
                  }
                >
                  <item.icon aria-hidden="true" className="h-5 w-5 shrink-0" />
                  {!isCollapsed ? <span className="truncate">{item.label}</span> : null}
                  {isCollapsed ? <span className="sr-only">{item.label}</span> : null}
                  {item.badgeCount !== undefined && item.badgeCount > 0 ? (
                    isCollapsed ? (
                      <span className="sr-only">
                        {item.badgeCount} pending action
                        {item.badgeCount === 1 ? "" : "s"}
                      </span>
                    ) : (
                      <span className="ml-auto inline-flex min-w-[1.25rem] items-center justify-center rounded-full bg-brand-teal px-1.5 py-0.5 text-[11px] font-semibold tabular-nums text-brand-navy">
                        {item.badgeCount}
                        <span className="sr-only">
                          {" "}
                          pending action{item.badgeCount === 1 ? "" : "s"}
                        </span>
                      </span>
                    )
                  ) : null}
                </NavLink>
              );

              return (
                <li key={item.to}>
                  {isCollapsed ? (
                    <Tooltip>
                      <TooltipTrigger asChild>{link}</TooltipTrigger>
                      <TooltipContent side="right">{item.label}</TooltipContent>
                    </Tooltip>
                  ) : (
                    link
                  )}
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-brand-navy-hover p-2">
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!isCollapsed}
            className={cn(
              "flex h-10 w-full items-center gap-3 rounded-md px-3 text-sm text-neutral-300 transition-colors duration-fast hover:bg-brand-navy-hover hover:text-brand-on-dark",
              isCollapsed && "justify-center px-0",
            )}
          >
            {isCollapsed ? (
              <PanelLeftOpen aria-hidden="true" className="h-5 w-5" />
            ) : (
              <>
                <PanelLeftClose aria-hidden="true" className="h-5 w-5" />
                <span>Collapse</span>
              </>
            )}
          </button>
        </div>
      </aside>
    </TooltipProvider>
  );
}
