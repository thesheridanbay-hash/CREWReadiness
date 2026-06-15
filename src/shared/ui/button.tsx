import * as React from "react";

import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/shared/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-bold ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 uppercase tracking-wide",
  {
    variants: {
      variant: {
        // Cross-brand (CrewYield family). `secondary` is the de-facto PRIMARY
        // CTA — now GOLD with a PINE label (white-on-gold fails AA; pine passes).
        // `primary` is the secondary/structural action (pine). See DESIGN.md.
        default:
          "bg-surface text-ink-3 border-line border-2 border-b-4 active:border-b-2 hover:bg-canvas-2",

        // custom
        locked:
          "bg-canvas-2 text-ink-3 hover:bg-canvas-2/90 border-line-2 border-b-4 active:border-b-0",

        primary:
          "bg-brand text-primary-foreground hover:bg-brand-600/90 border-brand-800 border-b-4 active:border-b-0",
        primaryOutline: "bg-surface text-brand hover:bg-canvas-2",

        secondary:
          "bg-gold-500 text-brand-800 hover:bg-gold-500/90 border-gold-700 border-b-4 active:border-b-0",
        secondaryOutline: "bg-surface text-gold-700 hover:bg-canvas-2",

        danger:
          "bg-danger text-primary-foreground hover:bg-danger/90 border-danger-600 border-b-4 active:border-b-0",
        dangerOutline: "bg-surface text-danger hover:bg-canvas-2",

        // AI-magic actions = the single gold accent (DESIGN.md folds indigo into gold).
        super:
          "bg-gold-500 text-brand-800 hover:bg-gold-500/90 border-gold-700 border-b-4 active:border-b-0",
        superOutline: "bg-surface text-gold-700 hover:bg-canvas-2",

        ghost:
          "bg-transparent text-ink-3 border-transparent border-0 hover:bg-canvas-2",

        sidebar:
          "bg-transparent text-ink-3 border-2 border-transparent hover:bg-canvas-2 transition-none",
        sidebarOutline:
          "bg-gold-50 text-gold-700 border-gold-500 border-2 hover:bg-gold-50 transition-none",
      },
      size: {
        default: "h-11 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-12 px-8",
        icon: "h-10 w-10",

        // custom
        rounded: "rounded-full",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

export interface ButtonProps
  extends
    React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
