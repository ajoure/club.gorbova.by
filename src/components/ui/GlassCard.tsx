import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
}

export function GlassCard({ children, className }: GlassCardProps) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-border/50 p-6 shadow-lg",
        className
      )}
      style={{
        background: "linear-gradient(135deg, hsl(0 0% 100% / 0.9), hsl(0 0% 100% / 0.7))",
        backdropFilter: "blur(20px)",
      }}
    >
      {children}
    </div>
  );
}
