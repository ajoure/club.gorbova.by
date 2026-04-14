import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useEqualHeight — post-render measurement hook for equal-height carousel cards.
 * 
 * Measures natural scrollHeight of all registered elements, computes the max,
 * and returns it as minHeight to apply on each element's container.
 * 
 * Measured DOM node: the inner wrapper div inside each CarouselItem.
 * minHeight applied to: the same inner wrapper div (via inline style).
 * Embla clones excluded: filtered by checking parentElement for aria-hidden.
 * Recalculates on: initial render (delayed), resize (ResizeObserver on window), itemCount change.
 */
export function useEqualHeight(itemCount: number) {
  const refsMap = useRef<Map<number, HTMLDivElement>>(new Map());
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);

  const setRef = useCallback((index: number) => (el: HTMLDivElement | null) => {
    if (el) {
      refsMap.current.set(index, el);
    } else {
      refsMap.current.delete(index);
    }
  }, []);

  const recalculate = useCallback(() => {
    const elements: HTMLDivElement[] = [];
    refsMap.current.forEach((el, index) => {
      // Only measure original slides (indices 0..itemCount-1), skip Embla clones
      if (index < itemCount && el.isConnected) {
        elements.push(el);
      }
    });

    if (elements.length === 0) return;

    // Temporarily clear minHeight to get natural height
    const prevHeights = elements.map(el => el.style.minHeight);
    elements.forEach(el => { el.style.minHeight = ''; });

    // Force layout recalc
    let maxH = 0;
    elements.forEach(el => {
      const h = el.scrollHeight;
      if (h > maxH) maxH = h;
    });

    // Restore previous if measurement failed
    if (maxH <= 0) {
      elements.forEach((el, i) => { el.style.minHeight = prevHeights[i]; });
      return;
    }

    setMinHeight(maxH);
  }, [itemCount]);

  useEffect(() => {
    // Delay initial measurement to let content render & animations settle
    const t1 = setTimeout(recalculate, 200);
    const t2 = setTimeout(recalculate, 600);

    const ro = new ResizeObserver(() => recalculate());
    ro.observe(document.documentElement);

    window.addEventListener('resize', recalculate);

    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      ro.disconnect();
      window.removeEventListener('resize', recalculate);
    };
  }, [itemCount, recalculate]);

  return { setRef, minHeight };
}
