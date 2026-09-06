import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "secondary" | "destructive" | "outline" | "success";
}

export function Badge({
  className,
  variant = "default",
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
        {
          "border-[var(--color-border)] bg-[var(--color-muted)] text-[var(--color-muted-foreground)]":
            variant === "default",
          "border-[var(--color-border)] bg-[var(--color-secondary)] text-[var(--color-secondary-foreground)]":
            variant === "secondary",
          "border-destructive/50 bg-destructive/10 text-destructive":
            variant === "destructive",
          "border-[var(--color-border)] bg-transparent":
            variant === "outline",
          "border-green-500/50 bg-green-500/10 text-green-600 dark:text-green-400":
            variant === "success",
        },
        className,
      )}
      {...props}
    />
  );
}