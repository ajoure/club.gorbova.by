import { forwardRef, ReactNode, CSSProperties, HTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type GlassCardProps = HTMLAttributes<HTMLDivElement> & {
  children: ReactNode;
  hover?: boolean;
  style?: CSSProperties;
};

export const GlassCard = forwardRef<HTMLDivElement, GlassCardProps>(
  function GlassCardComponent(
    { children, className, hover = false, onClick, style, ...props },
    ref
  ) {
    return (
      <div
        ref={ref}
        onClick={onClick}
        className={cn(
          "rounded-2xl border border-border/50 p-6 shadow-lg transition-all duration-300",
          hover &&
            "hover:shadow-xl hover:-translate-y-1 hover:border-primary/30 cursor-pointer",
          onClick && "cursor-pointer",
          className
        )}
        style={{
          background:
            "linear-gradient(135deg, hsl(var(--card) / 0.6), hsl(var(--card) / 0.3))",
          backdropFilter: "blur(24px)",
          WebkitBackdropFilter: "blur(24px)",
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
