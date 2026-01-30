import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface GlassFilterPanelProps {
  children: ReactNode;
  className?: string;
}

export function GlassFilterPanel({ children, className }: GlassFilterPanelProps) {
  return (
    <div className={cn(
      "p-3 rounded-2xl",
      "bg-card/30 dark:bg-card/20",
      "backdrop-blur-xl",
      "border border-border/30",
      "shadow-[0_4px_24px_rgba(0,0,0,0.06)]",
      className
    )}>
      {children}
    </div>
  );
}
