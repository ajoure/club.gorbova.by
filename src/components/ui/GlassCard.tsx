import { ReactNode, CSSProperties } from "react";
import { cn } from "@/lib/utils";

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  hover?: boolean;
  onClick?: () => void;
  style?: CSSProperties;
}

export function GlassCard({ children, className, hover = false, onClick, style }: GlassCardProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-2xl border border-border/50 p-6 shadow-lg transition-all duration-300",
        hover && "hover:shadow-xl hover:-translate-y-1 hover:border-primary/30 cursor-pointer",
        onClick && "cursor-pointer",
        className
      )}
      style={{
        background: "linear-gradient(135deg, hsl(var(--card) / 0.9), hsl(var(--card) / 0.7))",
        backdropFilter: "blur(20px)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
