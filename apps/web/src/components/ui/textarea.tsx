/* Hand-copied shadcn/ui primitive, themed with SDB tokens. */
import * as React from "react";
import { cn } from "@/lib/utils";

const Textarea = React.forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => {
  return (
    <textarea
      className={cn(
        "flex min-h-[4.5rem] w-full rounded-md border border-border-default bg-surface-raised px-3 py-2 text-sm text-neutral-900 shadow-xs transition-colors duration-fast placeholder:text-neutral-400 disabled:cursor-not-allowed disabled:opacity-50 aria-[invalid=true]:border-danger",
        className,
      )}
      ref={ref}
      {...props}
    />
  );
});
Textarea.displayName = "Textarea";

export { Textarea };
