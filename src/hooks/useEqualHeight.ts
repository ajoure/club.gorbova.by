import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useEqualHeight — post-render measurement hook for equal-height cards.
 * 
 * Measures natural height of all registered elements, computes the max,
 * and returns it as minHeight to apply on each element.
 * 
 * Recalculates on: initial render, resize (via ResizeObserver), items count change.
 * Filters out Embla clones (elements with closest [data-embla-slide-index] that are clones).
 */
export function useEqualHeight(itemCount: number) {
  const refs = useRef<(HTMLDivElement | null)[]>([]);
  const [minHeight, setMinHeight] = useState<number | undefined>(undefined);
  const observerRef = useRef<ResizeObserver | null>(null);

  const setRef = useCallback((index: number) => (el: HTMLDivElement | null) => {
    refs.current[index] = el;
  }, []);

  const recalculate = useCallback(() => {
    const elements = refs.current.filter((el): el is HTMLDivElement => {
      if (!el) return false;
      // Exclude Embla clones — they have a parent with data-embla-clone or aria-hidden
      // Check if any ancestor has the clone marker
      const slideParent = el.closest('[role="group"]');
      if (slideParent && slideParent.hasAttribute('data-embla-clone')) return false;
      return true;
    });

    if (elements.length === 0) return;

    // Temporarily remove minHeight to measure natural height
    elements.forEach(el => {
      el.style.minHeight = '';
    });

    // Force reflow, then measure
    requestAnimationFrame(() => {
      let maxH = 0;
      elements.forEach(el => {
        const h = el.scrollHeight;
        if (h > maxH) maxH = h;
      });

      if (maxH > 0) {
        setMinHeight(maxH);
      }
    });
  }, []);

  useEffect(() => {
    // Initial calculation after mount
    const timer = setTimeout(recalculate, 100);

    // ResizeObserver on the first element's scroll parent
    observerRef.current = new ResizeObserver(() => {
      recalculate();
    });

    // Observe document body for resize changes
    if (document.body) {
      observerRef.current.observe(document.body);
    }

    return () => {
      clearTimeout(timer);
      observerRef.current?.disconnect();
    };
  }, [itemCount, recalculate]);

  return { setRef, minHeight };
}
