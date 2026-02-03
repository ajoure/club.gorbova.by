import { ReactNode, forwardRef } from "react";
import { cn } from "@/lib/utils";
import { useScrollAnimation } from "@/hooks/useScrollAnimation";

interface AnimatedSectionProps {
  children: ReactNode;
  className?: string;
  animation?: "fade-up" | "fade-left" | "fade-right" | "scale" | "fade";
  delay?: number;
  /** Set to true for LCP elements to render immediately without animation delay */
  instant?: boolean;
}

export const AnimatedSection = forwardRef<HTMLDivElement, AnimatedSectionProps>(
  ({ children, className, animation = "fade-up", delay = 0, instant = false }, _ref) => {
    const [ref, isVisible] = useScrollAnimation<HTMLDivElement>({
      threshold: 0.1,
      rootMargin: "0px 0px -50px 0px",
    });

    // For LCP elements, show immediately without waiting for intersection
    const shouldShow = instant || isVisible;

    const getAnimationClasses = () => {
      const baseClasses = instant 
        ? "" // No transition for instant elements
        : "transition-all duration-700 ease-out";
      
      if (!shouldShow) {
        switch (animation) {
          case "fade-up":
            return `${baseClasses} opacity-0 translate-y-8`;
          case "fade-left":
            return `${baseClasses} opacity-0 -translate-x-8`;
          case "fade-right":
            return `${baseClasses} opacity-0 translate-x-8`;
          case "scale":
            return `${baseClasses} opacity-0 scale-95`;
          case "fade":
          default:
            return `${baseClasses} opacity-0`;
        }
      }
      
      return `${baseClasses} opacity-100 translate-y-0 translate-x-0 scale-100`;
    };

    return (
      <div
        ref={ref}
        className={cn(getAnimationClasses(), className)}
        style={instant ? undefined : { transitionDelay: `${delay}ms` }}
      >
        {children}
      </div>
    );
  }
);

AnimatedSection.displayName = "AnimatedSection";
