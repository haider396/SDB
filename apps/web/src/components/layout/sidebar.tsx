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

export interface SidebarNavItem {
  label: string;
  to: string;
  icon: LucideIcon;
  end?: boolean;
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
          <span
            aria-hidden="true"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-gradient-brand text-sm font-bold"
          >
            SD
          </span>
          {!isCollapsed ? (
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">
                Staffing Done Better
              </p>
              <p className="truncate text-xs leading-tight text-brand-teal">
                {areaLabel}
              </p>
            </div>
          ) : null}
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
