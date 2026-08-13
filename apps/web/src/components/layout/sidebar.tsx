/**
 * App navigation chrome (05-FRONTEND.md §4.1), two renderings of one nav:
 *
 * - ≥lg: persistent left sidebar — 264px expanded, 64px collapsed, state
 *   remembered per user, exactly as before (UX 1.5 keeps this untouched).
 * - <lg: off-canvas drawer (MobileNavDrawer), hidden by default, opened from
 *   the top bar's hamburger. Built on the Radix dialog primitive so overlay,
 *   focus trap, and Escape-to-close come for free; navigating closes it.
 *
 * Chrome uses --brand-navy (§3.5).
 */
import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { LucideIcon } from "lucide-react";
import { Mail, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
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

/** Footer contact block ("Questions? Contact your SDB team"). */
export interface SidebarContact {
  prompt: string;
  linkLabel: string;
  email: string;
}

export interface SidebarProps {
  items: SidebarNavItem[];
  /** Short product-area label under the wordmark, e.g. "Admin" or "Client portal". */
  areaLabel: string;
  contact?: SidebarContact;
}

function NavList({
  items,
  isCollapsed,
  onNavigate,
}: {
  items: SidebarNavItem[];
  isCollapsed: boolean;
  onNavigate?: () => void;
}) {
  return (
    <nav aria-label="Primary" className="flex-1 overflow-y-auto py-4">
      <ul className="space-y-1 px-2">
        {items.map((item) => {
          const link = (
            <NavLink
              to={item.to}
              end={item.end}
              onClick={onNavigate}
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
  );
}

function ContactBlock({
  contact,
  isCollapsed,
}: {
  contact: SidebarContact;
  isCollapsed: boolean;
}) {
  if (isCollapsed) {
    return (
      <div className="border-t border-brand-navy-hover p-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <a
              href={`mailto:${contact.email}`}
              className="flex h-10 items-center justify-center rounded-md text-neutral-300 transition-colors duration-fast hover:bg-brand-navy-hover hover:text-brand-on-dark"
            >
              <Mail aria-hidden="true" className="h-5 w-5" />
              <span className="sr-only">{contact.linkLabel}</span>
            </a>
          </TooltipTrigger>
          <TooltipContent side="right">{contact.linkLabel}</TooltipContent>
        </Tooltip>
      </div>
    );
  }
  return (
    <div className="border-t border-brand-navy-hover px-4 py-3">
      <p className="text-xs text-neutral-400">{contact.prompt}</p>
      <a
        href={`mailto:${contact.email}`}
        className="mt-0.5 inline-flex items-center gap-1.5 text-sm font-medium text-brand-teal hover:underline"
      >
        <Mail aria-hidden="true" className="h-3.5 w-3.5" />
        {contact.linkLabel}
      </a>
    </div>
  );
}

function BrandLockup({ areaLabel }: { areaLabel: string }) {
  return (
    <>
      {/* The lock-up is navy-on-transparent; a light chip keeps it
          legible on the navy chrome. */}
      <span className="flex shrink-0 items-center rounded-md bg-brand-on-dark px-2 py-1">
        <img src={logoUrl} alt="Business Done Better" className="h-6 w-auto" />
      </span>
      <p className="min-w-0 truncate text-xs font-medium leading-tight text-brand-teal">
        {areaLabel}
      </p>
    </>
  );
}

/** The persistent ≥lg sidebar. Hidden below lg (the drawer takes over). */
export function Sidebar({ items, areaLabel, contact }: SidebarProps) {
  const isCollapsed = useUiStore((state) => state.isSidebarCollapsed);
  const toggleSidebar = useUiStore((state) => state.toggleSidebar);

  return (
    <TooltipProvider delayDuration={150}>
      <aside
        className={cn(
          "hidden h-screen shrink-0 flex-col bg-brand-navy text-brand-on-dark transition-all duration-base ease-out lg:flex",
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
            <BrandLockup areaLabel={areaLabel} />
          )}
        </div>

        <NavList items={items} isCollapsed={isCollapsed} />

        {contact !== undefined ? (
          <ContactBlock contact={contact} isCollapsed={isCollapsed} />
        ) : null}

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

export interface MobileNavDrawerProps extends SidebarProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/**
 * The <lg off-canvas drawer. Always expanded; a nav click closes it. Radix
 * provides the overlay, focus trap, and Escape handling (05 §4.6).
 */
export function MobileNavDrawer({
  items,
  areaLabel,
  contact,
  open,
  onOpenChange,
}: MobileNavDrawerProps) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-neutral-900/50 motion-safe:transition-opacity motion-safe:duration-fast lg:hidden" />
        <DialogPrimitive.Content
          aria-label="Navigation"
          className="fixed inset-y-0 left-0 z-50 flex w-sidebar-expanded max-w-[85vw] flex-col bg-brand-navy text-brand-on-dark shadow-lg focus:outline-none motion-safe:transition-transform motion-safe:duration-base lg:hidden"
        >
          <DialogPrimitive.Title className="sr-only">
            Navigation
          </DialogPrimitive.Title>
          <div className="flex h-14 items-center gap-2 border-b border-brand-navy-hover px-4">
            <BrandLockup areaLabel={areaLabel} />
            <DialogPrimitive.Close
              aria-label="Close navigation"
              className="ml-auto flex h-9 w-9 items-center justify-center rounded-md text-neutral-300 transition-colors duration-fast hover:bg-brand-navy-hover hover:text-brand-on-dark"
            >
              <X aria-hidden="true" className="h-5 w-5" />
            </DialogPrimitive.Close>
          </div>
          <NavList
            items={items}
            isCollapsed={false}
            onNavigate={() => onOpenChange(false)}
          />
          {contact !== undefined ? (
            <ContactBlock contact={contact} isCollapsed={false} />
          ) : null}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
