import React from "react";
import { cn } from "@/lib/utils";
import { useSwipeActions } from "@/hooks/useSwipeActions";
import { Check, Archive } from "lucide-react";

interface SwipeableDialogCardProps {
  children: React.ReactNode;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  disabled?: boolean;
  className?: string;
  onClick?: () => void;
}

export function SwipeableDialogCard({
  children,
  onSwipeLeft,
  onSwipeRight,
  disabled = false,
  className,
  onClick,
}: SwipeableDialogCardProps) {
  const { swipeHandlers, swipeStyle, offsetX, swipeDirection } = useSwipeActions({
    threshold: 80,
    onSwipeLeft,
    onSwipeRight,
    disabled,
  });

  return (
    <div className="relative overflow-visible rounded-xl" style={{ touchAction: 'pan-y' }}>
      {/* Swipe backgrounds - clipped separately */}
      <div className="absolute inset-0 overflow-hidden rounded-xl pointer-events-none">
        {/* Left action background (swipe right = mark as read) */}
        <div
          className={cn(
            "absolute inset-y-0 left-0 flex items-center justify-start pl-4 transition-opacity",
            "bg-green-500/90 text-white",
            offsetX > 40 ? "opacity-100" : "opacity-0"
          )}
          style={{ width: Math.max(0, offsetX) }}
        >
          <Check className="h-6 w-6" />
          <span className="ml-2 text-sm font-medium">Прочитать</span>
        </div>

        {/* Right action background (swipe left = archive) */}
        <div
          className={cn(
            "absolute inset-y-0 right-0 flex items-center justify-end pr-4 transition-opacity",
            "bg-amber-500/90 text-white",
            offsetX < -40 ? "opacity-100" : "opacity-0"
          )}
          style={{ width: Math.max(0, -offsetX) }}
        >
          <span className="mr-2 text-sm font-medium">Архив</span>
          <Archive className="h-6 w-6" />
        </div>
      </div>

      {/* Card content - NO overflow-hidden so Quick Actions are visible */}
      <div
        {...swipeHandlers}
        style={swipeStyle}
        className={cn("relative bg-background overflow-visible", className)}
        onClick={onClick}
      >
        {children}
      </div>
    </div>
  );
}
