/**
 * The tinted inset pattern: a quiet, fixed-padding block inside a card for
 * notes, gated-PII panels, interview strips, and celebratory banners.
 * One tone token per panel; the `accent` variant (left brand-blue rule) is
 * reserved for the SDB recommendation — exactly two emphasis devices there:
 * the left rule and the tint.
 */
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const insetPanelVariants = cva("rounded-md px-3 py-2.5", {
  variants: {
    tone: {
      surface: "bg-surface-subtle",
      brand: "bg-brand-blue-subtle",
      info: "bg-info-subtle",
      success: "bg-success-subtle",
      warning: "bg-warning-subtle",
      danger: "bg-danger-subtle",
    },
    accent: {
      true: "border-l-4 border-brand-blue",
      false: "",
    },
  },
  defaultVariants: {
    tone: "surface",
    accent: false,
  },
});

export interface InsetPanelProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof insetPanelVariants> {}

export const InsetPanel = React.forwardRef<HTMLDivElement, InsetPanelProps>(
  ({ className, tone, accent, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(insetPanelVariants({ tone, accent }), className)}
      {...props}
    />
  ),
);
InsetPanel.displayName = "InsetPanel";

export { insetPanelVariants };
