import { useState, useRef, useCallback, ReactNode } from "react";
import { Loader2 } from "lucide-react";

interface PullToRefreshProps {
  children: ReactNode;
  onRefresh?: () => Promise<void>;
}

export function PullToRefresh({ children, onRefresh }: PullToRefreshProps) {
  const [refreshing, setRefreshing] = useState(false);
  const [pullDistance, setPullDistance] = useState(0);
  const startY = useRef(0);
  const isPulling = useRef(false);
  const currentPullDistance = useRef(0);

  const threshold = 80;

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    // Check if we're at the top of the page
    if (window.scrollY === 0 && !refreshing) {
      startY.current = e.touches[0].clientY;
      isPulling.current = true;
    }
  }, [refreshing]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isPulling.current || refreshing) return;
    
    // Stop if user scrolled down
    if (window.scrollY > 0) {
      isPulling.current = false;
      setPullDistance(0);
      currentPullDistance.current = 0;
      return;
    }

    const currentY = e.touches[0].clientY;
    const diff = currentY - startY.current;
    
    if (diff > 0) {
      e.preventDefault();
      const distance = Math.min(diff * 0.5, threshold * 1.5);
      setPullDistance(distance);
      currentPullDistance.current = distance;
    }
  }, [refreshing]);

  const handleTouchEnd = useCallback(() => {
    if (!isPulling.current) return;
    
    isPulling.current = false;
    
    if (currentPullDistance.current >= threshold) {
      setRefreshing(true);
      setPullDistance(threshold / 2);
      
      // Short delay then reload
      setTimeout(() => {
        if (onRefresh) {
          onRefresh().finally(() => {
            setRefreshing(false);
            setPullDistance(0);
            currentPullDistance.current = 0;
          });
        } else {
          window.location.reload();
        }
      }, 100);
    } else {
      setPullDistance(0);
      currentPullDistance.current = 0;
    }
  }, [onRefresh]);

  const indicatorOpacity = Math.min(pullDistance / threshold, 1);
  const indicatorScale = 0.5 + (indicatorOpacity * 0.5);

  return (
    <div
      className="flex-1 flex flex-col relative touch-pan-y"
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
              className={`h-5 w-5 text-primary ${refreshing ? 'animate-spin' : ''}`}
              style={{
                transform: refreshing ? 'none' : `rotate(${pullDistance * 4}deg)`,
              }}
            />
          </div>
        </div>
      )}

      {/* Content with pull offset */}
      <div
        className="flex-1 min-h-full"
        style={{
          transform: pullDistance > 0 ? `translateY(${pullDistance}px)` : 'none',
          transition: isPulling.current ? 'none' : 'transform 0.2s ease-out',
        }}
      >
        {children}
      </div>
    </div>
  );
}
