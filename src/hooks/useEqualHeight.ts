import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useEqualHeight — post-render measurement for equal-height carousel cards.
 * 
 * Measured DOM node: inner wrapper div inside each CarouselItem (via ref).
 * minHeight applied to: same inner wrapper div via inline style.
 * Embla clones: filtered by index < itemCount.
 * Recalculates on: initial render (delayed), resize, itemCount change.
 */
export function useEqualHeight(itemCount: number) {
  const refsArray = useRef<(HTMLDivElement | null)[]>([]);
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);

  // Ensure array is correct length
  if (refsArray.current.length !== itemCount) {
    refsArray.current = Array(itemCount).fill(null);
  }

  const setRef = useCallback((index: number) => (el: HTMLDivElement | null) => {
    refsArray.current[index] = el;
  }, []);

  const recalculate = useCallback(() => {
    const elements = refsArray.current.filter(
      (el): el is HTMLDivElement => el !== null && el.isConnected
    );
    if (elements.length === 0) return;

    // Clear minHeight to measure natural height
    elements.forEach(el => { el.style.minHeight = ''; });

    // Measure after layout recalc
    void elements[0].offsetHeight; // force reflow

    let maxH = 0;
    elements.forEach(el => {
      const h = el.scrollHeight;
      if (h > maxH) maxH = h;
    });

    if (maxH > 0) {
      setMinHeight(maxH);
    }
  }, []);

  useEffect(() => {
    const t1 = setTimeout(recalculate, 150);
    const t2 = setTimeout(recalculate, 500);
    const t3 = setTimeout(recalculate, 1000);

    const handleResize = () => recalculate();
    window.addEventListener('resize', handleResize);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      window.removeEventListener('resize', handleResize);
    };
  }, [itemCount, recalculate]);

  return { setRef, minHeight };
}
