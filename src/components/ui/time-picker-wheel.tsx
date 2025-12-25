import * as React from "react";
import { cn } from "@/lib/utils";

interface TimePickerWheelProps {
  value: string; // "HH:mm" format
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
}

const HOURS = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, i) => (i * 5).toString().padStart(2, "0"));

interface WheelColumnProps {
  items: string[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}

function WheelColumn({ items, value, onChange, disabled }: WheelColumnProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const itemHeight = 40;
  const visibleItems = 5;
  const centerIndex = Math.floor(visibleItems / 2);
  
  const currentIndex = items.indexOf(value);
  
  // Scroll to current value on mount and value change
  React.useEffect(() => {
    if (containerRef.current && currentIndex >= 0) {
      containerRef.current.scrollTop = currentIndex * itemHeight;
    }
  }, [currentIndex]);

  const handleScrollEnd = React.useCallback(() => {
    if (!containerRef.current || disabled) return;
    
    const scrollTop = containerRef.current.scrollTop;
    const newIndex = Math.round(scrollTop / itemHeight);
    const clampedIndex = Math.max(0, Math.min(items.length - 1, newIndex));
    
    // Snap to nearest item
    containerRef.current.scrollTo({
      top: clampedIndex * itemHeight,
      behavior: "smooth"
    });
    
    if (items[clampedIndex] !== value) {
      onChange(items[clampedIndex]);
    }
  }, [items, value, onChange, disabled]);

  // Debounced scroll handler
  const scrollTimeoutRef = React.useRef<ReturnType<typeof setTimeout>>();
  
  const onScroll = () => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }
    scrollTimeoutRef.current = setTimeout(handleScrollEnd, 150);
  };

  const handleItemClick = (item: string, index: number) => {
    if (disabled) return;
    onChange(item);
    if (containerRef.current) {
      containerRef.current.scrollTo({
        top: index * itemHeight,
        behavior: "smooth"
      });
    }
  };

  // Handle wheel event for mouse scrolling
  const handleWheel = (e: React.WheelEvent) => {
    if (disabled) return;
    e.stopPropagation();
  };

  return (
    <div className="relative" style={{ height: `${visibleItems * itemHeight}px`, width: "70px" }}>
      {/* Selection highlight */}
      <div 
        className="absolute left-1 right-1 pointer-events-none z-10 rounded-lg bg-primary/10 border border-primary/20"
        style={{ 
          top: `${centerIndex * itemHeight}px`, 
          height: `${itemHeight}px` 
        }}
      />
      
      {/* Gradient overlays for fade effect */}
      <div 
        className="absolute inset-x-0 top-0 pointer-events-none z-20 rounded-t-lg"
        style={{ 
          height: `${centerIndex * itemHeight}px`,
          background: "linear-gradient(to bottom, hsl(var(--background)) 0%, transparent 100%)"
        }}
      />
      <div 
        className="absolute inset-x-0 bottom-0 pointer-events-none z-20 rounded-b-lg"
        style={{ 
          height: `${centerIndex * itemHeight}px`,
          background: "linear-gradient(to top, hsl(var(--background)) 0%, transparent 100%)"
        }}
      />
      
      {/* Scrollable container */}
      <div
        ref={containerRef}
        className={cn(
          "h-full overflow-y-scroll overscroll-contain",
          disabled && "opacity-50 pointer-events-none"
        )}
        style={{ 
          scrollSnapType: "y mandatory",
          paddingTop: `${centerIndex * itemHeight}px`,
          paddingBottom: `${centerIndex * itemHeight}px`,
          scrollbarWidth: "none",
          msOverflowStyle: "none",
          WebkitOverflowScrolling: "touch",
        }}
        onScroll={onScroll}
        onWheel={handleWheel}
      >
        <style dangerouslySetInnerHTML={{ __html: `
          .time-wheel-scroll::-webkit-scrollbar { display: none; }
        `}} />
        {items.map((item, index) => {
          const isSelected = item === value;
          return (
            <div
              key={item}
              className={cn(
                "flex items-center justify-center cursor-pointer transition-all duration-150",
                "text-lg font-medium select-none",
                isSelected 
                  ? "text-foreground font-semibold" 
                  : "text-muted-foreground/50 hover:text-muted-foreground"
              )}
              style={{ 
                height: `${itemHeight}px`,
                scrollSnapAlign: "center"
              }}
              onClick={() => handleItemClick(item, index)}
            >
              {item}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function TimePickerWheel({ value, onChange, disabled, className }: TimePickerWheelProps) {
  const [hours, minutes] = React.useMemo(() => {
    const parts = value.split(":");
    return [parts[0] || "12", parts[1] || "00"];
  }, [value]);

  const handleHoursChange = (newHours: string) => {
    onChange(`${newHours}:${minutes}`);
  };

  const handleMinutesChange = (newMinutes: string) => {
    onChange(`${hours}:${newMinutes}`);
  };

  return (
    <div className={cn("flex items-center justify-center gap-2 py-4", className)}>
      <WheelColumn
        items={HOURS}
        value={hours}
        onChange={handleHoursChange}
        disabled={disabled}
      />
      
      <div className="text-2xl font-semibold text-foreground">:</div>
      
      <WheelColumn
        items={MINUTES}
        value={minutes}
        onChange={handleMinutesChange}
        disabled={disabled}
      />
    </div>
  );
}
