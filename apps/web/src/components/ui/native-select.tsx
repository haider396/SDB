/**
 * Styled native <select>, matching the Input primitive. Native selects keep
 * full keyboard and screen-reader behaviour with zero extra wiring — the
 * right tool for the cascading taxonomy selects and long single_select
 * option lists (05-FRONTEND.md §5).
 */
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const NativeSelect = React.forwardRef<
  HTMLSelectElement,
  React.ComponentProps<"select">
>(({ className, children, ...props }, ref) => {
  return (
    <div className="relative">
      <select
        className={cn(
          "h-9 w-full appearance-none rounded-md border border-border-default bg-surface-raised px-3 pr-8 text-sm text-neutral-900 shadow-xs transition-colors duration-fast disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger",
          className,
        )}
        ref={ref}
        {...props}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-neutral-500"
      />
    </div>
  );
});
NativeSelect.displayName = "NativeSelect";

export { NativeSelect };
