import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

/**
 * useEqualHeight — measures natural content heights and equalizes them.
 * Uses a container ref to find all slide wrappers, rather than individual refs.
 */
export function useEqualHeight(containerRef: React.RefObject<HTMLDivElement | null>, itemCount: number) {
  const [minHeight, setMinHeight] = useState<number>(0);

  const recalculate = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Find all direct slide wrapper divs (the ones with data-eq-slide attribute)
    const slides = container.querySelectorAll<HTMLDivElement>('[data-eq-slide]');
    if (slides.length === 0) return;

    // Clear previous minHeight
    slides.forEach(el => { el.style.minHeight = ''; });

    // Force reflow
    void container.offsetHeight;

    // Measure natural heights
    let maxH = 0;
    slides.forEach(el => {
      const h = el.scrollHeight;
      if (h > maxH) maxH = h;
    });

    if (maxH > 0) {
      slides.forEach(el => { el.style.minHeight = `${maxH}px`; });
      setMinHeight(maxH);
    }
  }, [containerRef, itemCount]);

  useEffect(() => {
    const t1 = setTimeout(recalculate, 200);
    const t2 = setTimeout(recalculate, 600);
    const t3 = setTimeout(recalculate, 1200);
    window.addEventListener('resize', recalculate);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      window.removeEventListener('resize', recalculate);
    };
  }, [recalculate]);

  return minHeight;
}
