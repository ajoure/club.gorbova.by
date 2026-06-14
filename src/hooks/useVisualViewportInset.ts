import { useEffect, useState } from "react";

/**
 * useVisualViewportInset
 *
 * Возвращает количество CSS-пикселей, которые «съела» экранная клавиатура
 * на iOS Safari / Android Chrome. Используется для того, чтобы поднять
 * sticky-композер над клавиатурой и не закрывать textarea вводимым текстом.
 *
 * На десктопе и в браузерах без visualViewport API возвращает 0.
 *
 * Никаких сетевых запросов; слушатель снимается при unmount.
 */
export function useVisualViewportInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const vv = window.visualViewport;
    if (!vv) return;

    const update = () => {
      // layout viewport height vs visual viewport height
      const layoutH = window.innerHeight;
      const visualH = vv.height + vv.offsetTop;
      const diff = Math.max(0, layoutH - visualH);
      setInset(diff);
    };

    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
