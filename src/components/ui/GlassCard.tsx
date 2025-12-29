import { forwardRef, ReactNode, CSSProperties, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface GlassCardProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  className?: string;
  hover?: boolean;
}

const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  ({ children, className, hover = false, onClick, style, ...props }, ref) => {
    return (
      <div
        ref={ref}
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
        {...props}
      >
        {children}
      </div>
    );
  }
);

GlassCard.displayName = "GlassCard";

export { GlassCard };
