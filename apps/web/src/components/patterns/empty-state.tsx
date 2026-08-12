/**
 * Empty state per 05-FRONTEND.md §4.3: icon, a sentence explaining what
 * belongs here, and the primary action to create it. Never "No data" alone.
 */
import type { LucideIcon } from "lucide-react";
import { Inbox } from "lucide-react";
import type { ReactNode } from "react";

export interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  /** One sentence explaining what belongs here. */
  description: string;
  /** Primary action to create the missing thing, when applicable. */
  action?: ReactNode;
}

export function EmptyState({
  icon: Icon = Inbox,
  title,
  description,
  action,
}: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg bg-surface-raised px-6 py-16 text-center shadow-sm">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-blue-subtle">
        <Icon aria-hidden="true" className="h-6 w-6 text-brand-blue" />
      </div>
      <h2 className="text-lg font-semibold tracking-tight text-brand-navy-ink">
        {title}
      </h2>
      <p className="mt-1 max-w-md text-sm text-neutral-500">{description}</p>
      {action ? <div className="mt-6">{action}</div> : null}
    </div>
  );
}
