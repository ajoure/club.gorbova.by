import { useState, useRef, useCallback } from "react";

interface SwipeActionsOptions {
  threshold?: number;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  disabled?: boolean;
}

// Detect if device supports touch (mobile)
const isTouchDevice = () => {
  if (typeof window === 'undefined') return false;
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0;
};

export function useSwipeActions({
  threshold = 80,
  onSwipeLeft,
  onSwipeRight,
  disabled = false,
}: SwipeActionsOptions = {}) {
  const [offsetX, setOffsetX] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const startXRef = useRef(0);
  const startYRef = useRef(0);
  const isHorizontalSwipeRef = useRef<boolean | null>(null);
  const isMobile = useRef(isTouchDevice());

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      // Only handle on mobile/touch devices
      if (disabled || !isMobile.current) return;
      
      startXRef.current = e.touches[0].clientX;
      startYRef.current = e.touches[0].clientY;
      isHorizontalSwipeRef.current = null;
      setIsSwiping(true);
    },
    [disabled]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      // Only handle on mobile/touch devices
      if (disabled || !isSwiping || !isMobile.current) return;

      const currentX = e.touches[0].clientX;
      const currentY = e.touches[0].clientY;
      const diffX = currentX - startXRef.current;
      const diffY = currentY - startYRef.current;

      // Determine swipe direction on first significant movement
      if (isHorizontalSwipeRef.current === null) {
        if (Math.abs(diffX) > 10 || Math.abs(diffY) > 10) {
          // Horizontal only if X movement is significantly larger than Y
          isHorizontalSwipeRef.current = Math.abs(diffX) > Math.abs(diffY) + 6;
        }
      }

      // Only preventDefault and handle horizontal swipes AFTER threshold confirmed
      if (isHorizontalSwipeRef.current === true && Math.abs(diffX) > 12) {
        e.preventDefault();
        const limitedOffset = Math.max(-150, Math.min(150, diffX));
        setOffsetX(limitedOffset);
      }
    },
    [disabled, isSwiping]
  );

  const handleTouchEnd = useCallback(() => {
    if (!isSwiping || !isMobile.current) return;

    const currentOffset = offsetX;
    setIsSwiping(false);
    isHorizontalSwipeRef.current = null;

    if (currentOffset < -threshold && onSwipeLeft) {
      onSwipeLeft();
    } else if (currentOffset > threshold && onSwipeRight) {
      onSwipeRight();
    }

    setOffsetX(0);
  }, [isSwiping, offsetX, threshold, onSwipeLeft, onSwipeRight]);

  const swipeHandlers = {
    onTouchStart: handleTouchStart,
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
  };

  const swipeStyle: React.CSSProperties = {
    transform: `translateX(${offsetX}px)`,
    transition: isSwiping ? 'none' : 'transform 0.3s ease-out',
    touchAction: 'pan-y', // Allow vertical scroll by default
  };

  const swipeDirection = offsetX < -10 ? 'left' : offsetX > 10 ? 'right' : null;

  return { swipeHandlers, swipeStyle, offsetX, isSwiping, swipeDirection };
}
