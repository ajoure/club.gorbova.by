import { useState, useRef, useCallback, ReactNode, useEffect } from "react";
import { Loader2, ArrowDown } from "lucide-react";

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

// Constants
const THRESHOLD_PERCENT = 0.22; // 22% of screen height (lowered for better UX)
const COOLDOWN_MS = 1500;
const HORIZONTAL_LOCK_THRESHOLD = 12; // px before we decide direction
const TOP_TOLERANCE = 5; // px tolerance for iOS inertia/overscroll
const THRESHOLD_MIN_PX = 90;
const THRESHOLD_MAX_PX = 220;

export function PullToRefresh({ children, onRefresh }: PullToRefreshProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const [pullState, setPullState] = useState<'idle' | 'pulling' | 'ready'>('idle');
  
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef(0);
  const startX = useRef(0);
  const isPulling = useRef(false);
  const directionLocked = useRef<'vertical' | 'horizontal' | null>(null);
  const currentPullDistance = useRef(0);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const lastRefreshTime = useRef(0);
  
  // Calculate threshold based on screen height with clamp
  const raw = typeof window !== 'undefined' ? window.innerHeight * THRESHOLD_PERCENT : 120;
  const threshold = Math.min(THRESHOLD_MAX_PX, Math.max(THRESHOLD_MIN_PX, raw));

  const blurIfNeeded = useCallback((e: React.SyntheticEvent) => {
    const active = document.activeElement;
    if (!isEditableElement(active)) return;
    if (isInsideEditableTarget(e.target)) return;
    (active as HTMLElement).blur();
  }, []);

  const resetPull = useCallback(() => {
    isPulling.current = false;
    directionLocked.current = null;
    currentPullDistance.current = 0;
    scrollContainerRef.current = null;
    setPullDistance(0);
    setPullState('idle');
  }, []);

  const handleTouchStart = useCallback(
    (e: React.TouchEvent) => {
      // Block if editing, refreshing, or in cooldown
      if (isEditableElement(document.activeElement)) return;
      if (refreshing) return;
      
      // Cooldown check
      const now = Date.now();
      if (now - lastRefreshTime.current < COOLDOWN_MS) return;

      // Find scrollable container from touch target with fallback
      const targetEl = (e.target as Element | null) ?? null;
      const startFrom = (targetEl && typeof (targetEl as any).closest === 'function') 
        ? (targetEl as Element) 
        : (e.currentTarget as Element);

      const scrollContainer =
        findScrollableParent(startFrom as HTMLElement)
        ?? (document.scrollingElement as HTMLElement | null);
      
      const scrollTop = scrollContainer 
        ? scrollContainer.scrollTop 
        : window.scrollY;

      // Allow small tolerance for iOS inertia (scrollTop can be 1-5px)
      if (scrollTop > TOP_TOLERANCE) return;

      startY.current = e.touches[0].clientY;
      startX.current = e.touches[0].clientX;
      isPulling.current = true;
      directionLocked.current = null;
      scrollContainerRef.current = scrollContainer;
      setPullState('pulling');
    },
    [refreshing]
  );

  const handleTouchMove = useCallback(
    (e: React.TouchEvent) => {
      // Guard checks
      if (isEditableElement(document.activeElement)) return;
      if (!isPulling.current || refreshing) return;

      // Re-check scroll position
      const scrollTop = scrollContainerRef.current 
        ? scrollContainerRef.current.scrollTop 
        : window.scrollY;

      // If user scrolled beyond tolerance, cancel pull immediately
      if (scrollTop > TOP_TOLERANCE) {
        resetPull();
        return;
      }

      const currentY = e.touches[0].clientY;
      const currentX = e.touches[0].clientX;
      const diffY = currentY - startY.current;
      const diffX = currentX - startX.current;

      // Lock direction after small movement
      if (!directionLocked.current && (Math.abs(diffX) > HORIZONTAL_LOCK_THRESHOLD || Math.abs(diffY) > HORIZONTAL_LOCK_THRESHOLD)) {
        if (Math.abs(diffX) > Math.abs(diffY)) {
          // Horizontal gesture - cancel pull, let browser handle
          directionLocked.current = 'horizontal';
          resetPull();
          return;
        } else {
          directionLocked.current = 'vertical';
        }
      }

      // If horizontal locked, ignore
      if (directionLocked.current === 'horizontal') return;

      // Only respond to downward pull when at top
      if (diffY > 0 && directionLocked.current === 'vertical' && scrollTop <= TOP_TOLERANCE) {
        e.preventDefault(); // Prevent native scroll/refresh only during active pull
        
        // Rubber-band effect: diminishing returns after threshold
        const resistance = diffY > threshold ? 0.3 : 0.6;
        const distance = Math.min(diffY * resistance, threshold * 1.8);
        
        setPullDistance(distance);
        currentPullDistance.current = distance;
        setPullState(distance >= threshold ? 'ready' : 'pulling');
      } else if (diffY < 0) {
        // User pulled up - cancel
        resetPull();
      }
    },
    [refreshing, threshold, resetPull]
  );

  const handleTouchEnd = useCallback(() => {
    if (!isPulling.current) return;

    const wasReady = currentPullDistance.current >= threshold;
    
    // Reset visual state
    isPulling.current = false;
    directionLocked.current = null;
    scrollContainerRef.current = null;

    if (!wasReady) {
      // Not enough pull - just reset
      setPullDistance(0);
      setPullState('idle');
      currentPullDistance.current = 0;
      return;
    }

    // Trigger refresh
    lastRefreshTime.current = Date.now();
    
    if (!onRefresh) {
      // No custom handler - reload page
      window.location.reload();
      return;
    }

    setRefreshing(true);
    setPullState('idle');
    setPullDistance(threshold * 0.4); // Keep indicator visible during refresh

    Promise.resolve(onRefresh())
      .finally(() => {
        setRefreshing(false);
        setPullDistance(0);
        currentPullDistance.current = 0;
      });
  }, [onRefresh, threshold]);

  // Cancel on touch cancel
  const handleTouchCancel = useCallback(() => {
    resetPull();
  }, [resetPull]);

  // Calculate visual states
  const progress = Math.min(pullDistance / threshold, 1);
  const indicatorOpacity = Math.min(progress * 1.5, 1);
  const indicatorScale = 0.6 + progress * 0.4;
  const rotation = progress * 180;

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 flex flex-col relative"
      style={{
        // iOS: Disable native pull-to-refresh
        overscrollBehavior: 'contain',
        WebkitOverflowScrolling: 'touch',
        touchAction: 'pan-y',
      }}
      onPointerDownCapture={blurIfNeeded}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchCancel}
    >
      {/* Pull indicator */}
      {(pullDistance > 0 || refreshing) && (
        <div
          className="absolute left-1/2 z-50 flex items-center justify-center pointer-events-none transition-opacity duration-150"
          style={{
            top: Math.max(8, pullDistance - 48),
            opacity: indicatorOpacity,
            transform: `translateX(-50%) scale(${indicatorScale})`,
          }}
        >
          <div 
            className={`
              bg-background border-2 rounded-full p-2.5 shadow-lg
              ${pullState === 'ready' ? 'border-primary bg-primary/10' : 'border-border'}
              ${refreshing ? 'border-primary' : ''}
            `}
          >
            {refreshing ? (
              <Loader2 className="h-5 w-5 text-primary animate-spin" />
            ) : (
              <ArrowDown
                className={`h-5 w-5 transition-colors duration-150 ${
                  pullState === 'ready' ? 'text-primary' : 'text-muted-foreground'
                }`}
                style={{
                  transform: `rotate(${rotation}deg)`,
                  transition: 'transform 0.1s ease-out',
                }}
              />
            )}
          </div>
        </div>
      )}

      {/* Content with pull offset */}
      <div
        className="flex-1 min-h-0 flex flex-col"
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : 'none',
          transition: isPulling.current ? 'none' : 'transform 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        {children}
      </div>
    </div>
  );
}
