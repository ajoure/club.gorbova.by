import { useCallback, useEffect, useRef, useState } from "react";

/**
 * useEqualHeight — post-render measurement for equal-height carousel cards.
 * 
 * Strategy: temporarily remove h-full and minHeight from measured elements,
 * let content determine natural height, measure, then restore.
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

      // Save and clear height constraints to measure natural content height
      const saved = elements.map(el => ({
        minHeight: el.style.minHeight,
        height: el.style.height,
      }));

      elements.forEach(el => {
        el.style.minHeight = '';
        el.style.height = 'auto';
        el.classList.remove('h-full');
      });

      // Force reflow
      void document.body.offsetHeight;

      let maxH = 0;
      elements.forEach(el => {
        const h = el.scrollHeight;
        if (h > maxH) maxH = h;
      });

      // Restore h-full class and apply computed minHeight
      elements.forEach((el, i) => {
        el.classList.add('h-full');
        el.style.height = saved[i].height;
      });

      if (maxH > 0) {
        setMinHeight(maxH);
        elements.forEach(el => {
          el.style.minHeight = `${maxH}px`;
        });
      }
    });
  }, [itemCount]);

  const setRef = useCallback((index: number) => (el: HTMLDivElement | null) => {
    while (refsArray.current.length <= index) {
      refsArray.current.push(null);
    }
    refsArray.current[index] = el;
    if (el) recalculate();
  }, [recalculate]);

  useEffect(() => {
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
