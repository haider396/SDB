/* Hand-copied shadcn/ui primitive, themed with SDB tokens (05-FRONTEND.md §3.5). */
import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors duration-fast ease-out active:translate-y-px disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        // Primary buttons use the brand gradient (05 §3.5)
        primary:
          "bg-gradient-brand text-brand-on-dark shadow-sm hover:brightness-95",
        // Secondary buttons: outlined in border-default on surface-raised
        secondary:
          "border border-border-default bg-surface-raised text-neutral-800 shadow-xs hover:bg-surface-subtle",
        ghost: "text-neutral-600 hover:bg-surface-subtle",
        destructive:
          "bg-danger text-brand-on-dark shadow-sm hover:opacity-90",
        link: "text-brand-blue underline-offset-4 hover:underline",
      },
      size: {
        sm: "h-8 px-3 text-xs",
        md: "h-9 px-4",
        lg: "h-10 px-6",
        icon: "h-9 w-9",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, type, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        type={asChild ? undefined : (type ?? "button")}
        {...props}
      />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
