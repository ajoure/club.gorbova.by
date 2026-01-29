import { useState, useRef, useCallback, ReactNode } from "react";
import { Loader2 } from "lucide-react";

interface PullToRefreshProps {
  children: ReactNode;
  onRefresh?: () => Promise<void>;
}

function isEditableElement(el: Element | null) {
  if (!el) return false;
  return (
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (el instanceof HTMLElement && el.isContentEditable)
  );
}

function isInsideEditableTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) return false;
  return !!target.closest('input, textarea, [contenteditable="true"], [contenteditable=""], [role="textbox"]');
}

function findScrollableParent(el: HTMLElement | null): HTMLElement | null {
  while (el) {
    const { overflowY } = window.getComputedStyle(el);
    if (overflowY === 'auto' || overflowY === 'scroll') {
      if (el.scrollHeight > el.clientHeight) {
        return el;
      }
    }
    el = el.parentElement;
  }
  return null;
}

export function PullToRefresh({ children, onRefresh }: PullToRefreshProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const isPulling = useRef(false);
  const currentPullDistance = useRef(0);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const threshold = 60;

  const blurIfNeeded = useCallback((e: React.SyntheticEvent) => {
    const active = document.activeElement;
    if (!isEditableElement(active)) return;
    if (isInsideEditableTarget(e.target)) return;
    (active as HTMLElement).blur();
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      // If a text input is focused, don't start pull-to-refresh.
      if (isEditableElement(document.activeElement)) return;

      // Find the scrollable container (could be a parent with overflow-y: auto/scroll)
      const scrollContainer = findScrollableParent(containerRef.current);
      const scrollTop = scrollContainer 
        ? scrollContainer.scrollTop 
        : window.scrollY;

      // Check if we're at the top of the scrollable area
      if (scrollTop === 0 && !refreshing) {
        startY.current = e.touches[0].clientY;
        isPulling.current = true;
        scrollContainerRef.current = scrollContainer;
      }
    },
    [refreshing]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      // Never interfere with typing: this is a common reason why mobile can't dismiss the keyboard.
      if (isEditableElement(document.activeElement)) return;
      if (!isPulling.current || refreshing) return;

      // Check scroll position of the tracked container
      const scrollTop = scrollContainerRef.current 
        ? scrollContainerRef.current.scrollTop 
        : window.scrollY;

      // Stop if user scrolled down
      if (scrollTop > 0) {
        isPulling.current = false;
        setPullDistance(0);
        currentPullDistance.current = 0;
        scrollContainerRef.current = null;
        return;
      }

      const currentY = e.touches[0].clientY;
      const diff = currentY - startY.current;

      if (diff > 0) {
        e.preventDefault();
        // Make the gesture feel natural: user pulls ~60px → refresh
        const distance = Math.min(diff, threshold * 1.5);
        setPullDistance(distance);
        currentPullDistance.current = distance;
      }
    },
    [refreshing]
  );

  const handleTouchEnd = useCallback(() => {
    if (!isPulling.current) return;

    isPulling.current = false;
    scrollContainerRef.current = null;

    const shouldRefresh = currentPullDistance.current >= threshold;
    currentPullDistance.current = 0;

    if (!shouldRefresh) {
      setPullDistance(0);
      return;
    }

    // IMPORTANT: reload must happen synchronously after the gesture on mobile
    if (!onRefresh) {
      window.location.reload();
      return;
    }

    setRefreshing(true);
    setPullDistance(threshold / 2);

    Promise.resolve(onRefresh()).finally(() => {
      setRefreshing(false);
      setPullDistance(0);
    });
  }, [onRefresh]);

  const indicatorOpacity = Math.min(pullDistance / threshold, 1);
  const indicatorScale = 0.5 + indicatorOpacity * 0.5;

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 flex flex-col relative touch-pan-y"
      onPointerDownCapture={blurIfNeeded}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Pull indicator */}
      {pullDistance > 0 && (
        <div
          className="absolute left-1/2 z-50 flex items-center justify-center pointer-events-none"
          style={{
            top: pullDistance - 40,
            opacity: indicatorOpacity,
            transform: `translateX(-50%) scale(${indicatorScale})`,
          }}
        >
          <div className="bg-background border border-border rounded-full p-2 shadow-lg">
            <Loader2
              className={`h-5 w-5 text-primary ${refreshing ? "animate-spin" : ""}`}
              style={{
                transform: refreshing ? "none" : `rotate(${pullDistance * 4}deg)`,
              }}
            />
          </div>
        </div>
      )}

      {/* Content with pull offset */}
      <div
        className="flex-1 min-h-0 flex flex-col"
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : "none",
          transition: isPulling.current ? "none" : "transform 0.2s ease-out",
        }}
      >
        {children}
      </div>
    </div>
  );
}
