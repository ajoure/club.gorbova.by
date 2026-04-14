import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useEqualHeight — post-render measurement for equal-height carousel cards.
 * 
 * Measured DOM node: inner wrapper div inside each CarouselItem (via ref).
 * minHeight applied to: same inner wrapper div via inline style.
 * Embla clones: only indices 0..itemCount-1 are measured.
 * Recalculates on: initial render (delayed), resize, itemCount change, ref attachment.
 */
export function useEqualHeight(itemCount: number) {
  const refsArray = useRef<(HTMLDivElement | null)[]>([]);
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);
  const rafId = useRef<number>(0);

  const recalculate = useCallback(() => {
    cancelAnimationFrame(rafId.current);
    rafId.current = requestAnimationFrame(() => {
      const elements = refsArray.current
        .slice(0, itemCount)
        .filter((el): el is HTMLDivElement => el !== null && el.isConnected);
      
      if (elements.length === 0) return;

      // Clear minHeight to measure natural height
      elements.forEach(el => { el.style.minHeight = '0'; });

      // Force reflow
      void elements[0].offsetHeight;

      let maxH = 0;
      elements.forEach(el => {
        const h = el.scrollHeight;
        if (h > maxH) maxH = h;
      });

      if (maxH > 0) {
        elements.forEach(el => { el.style.minHeight = `${maxH}px`; });
        setMinHeight(maxH);
      }
    });
  }, [itemCount]);

  const setRef = useCallback((index: number) => (el: HTMLDivElement | null) => {
    // Ensure array is long enough
    while (refsArray.current.length <= index) {
      refsArray.current.push(null);
    }
    refsArray.current[index] = el;
    // Trigger recalculate when a ref is attached
    if (el) {
      recalculate();
    }
  }, [recalculate]);

  useEffect(() => {
    // Delayed recalculations for fonts/images loading
    const t1 = setTimeout(recalculate, 300);
    const t2 = setTimeout(recalculate, 800);

    window.addEventListener('resize', recalculate);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      cancelAnimationFrame(rafId.current);
      window.removeEventListener('resize', recalculate);
    };
  }, [itemCount, recalculate]);

  return { setRef, minHeight };
}
