import { cva, type VariantProps } from "class-variance-authority";
import type * as React from "react";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-1 focus:ring-(--color-ring)",
  {
    variants: {
      variant: {
        default: "border-transparent bg-(--color-primary) text-(--color-primary-foreground)",
        secondary: "border-transparent bg-(--color-secondary) text-(--color-secondary-foreground)",
        destructive:
          "border-transparent bg-(--color-destructive) text-(--color-destructive-foreground)",
        outline: "text-(--color-foreground) border-(--color-border)",
        accent: "border-transparent bg-(--color-accent) text-(--color-accent-foreground)",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
