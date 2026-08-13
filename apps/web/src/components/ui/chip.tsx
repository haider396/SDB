/**
 * The one pill primitive (05 §3.6). Every rounded-full count/status/meta
 * chip in the app renders through this so tone mapping stays semantic and
 * the shape stays uniform. Colour comes from SEMANTIC tokens (or the two
 * sanctioned brand accents for counts); never raw brand text colours.
 */
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const chipVariants = cva(
  "inline-flex items-center gap-1 rounded-full font-medium",
  {
    variants: {
      tone: {
        neutral: "bg-neutral-100 text-neutral-600",
        surface: "bg-surface-subtle text-neutral-600",
        info: "bg-info-subtle text-info",
        success: "bg-success-subtle text-success-text",
        warning: "bg-warning-subtle text-warning-text",
        danger: "bg-danger-subtle text-danger-text",
        "brand-blue": "bg-brand-blue-subtle text-brand-blue",
        "brand-teal": "bg-brand-teal text-brand-navy",
      },
      size: {
        sm: "px-2 py-0.5 text-2xs",
        md: "px-2.5 py-0.5 text-xs",
      },
    },
    defaultVariants: {
      tone: "neutral",
      size: "md",
    },
  },
);

export interface ChipProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof chipVariants> {}

export const Chip = React.forwardRef<HTMLSpanElement, ChipProps>(
  ({ className, tone, size, ...props }, ref) => (
    <span
      ref={ref}
      className={cn(chipVariants({ tone, size }), className)}
      {...props}
    />
  ),
);
Chip.displayName = "Chip";

export { chipVariants };
