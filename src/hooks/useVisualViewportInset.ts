import { useEffect } from "react";

/**
 * useVisualViewportInset
 *
 * Записывает в CSS-переменную `--room-vv-bottom-offset` величину «нижнего
 * inset» от Visual Viewport — высоту экранной клавиатуры (или 0, если
 * клавиатура закрыта / API недоступен).
 *
 * Назначение:
 *   На iOS (Safari + standalone PWA) `position: fixed; bottom: 0` привязан
 *   к layout viewport, который не уменьшается при открытии клавиатуры.
 *   Из-за этого composer уезжает наверх или образует пустой gap над
 *   клавиатурой. Привязка `bottom` к Visual Viewport через CSS-переменную
 *   решает баг и для Safari, и для standalone — без двойного учёта safe-area.
 *
 * Контракт:
 *   - значение всегда ≥ 0;
 *   - формула: max(0, window.innerHeight - (vv.height + vv.offsetTop));
 *   - fail-safe: если `window.visualViewport` недоступен — no-op (offset = 0);
 *   - cleanup всех listeners + сброс переменной в 0 на unmount;
 *   - не трогает desktop (там клавиатуры нет, offset всегда 0);
 *   - не реагирует на tabs/chat/reactions — только на focusin/focusout
 *     и события самого Visual Viewport.
 */
export function useVisualViewportInset(): void {
  useEffect(() => {
    if (typeof window === "undefined") return;

    const root = document.documentElement;
    const vv = window.visualViewport;

    const setOffset = (value: number) => {
      const safe = Math.max(0, Math.round(value));
      root.style.setProperty("--room-vv-bottom-offset", `${safe}px`);
    };

    const compute = () => {
      try {
        if (!vv) {
          setOffset(0);
          return;
        }
        const offset = window.innerHeight - (vv.height + vv.offsetTop);
        setOffset(offset);
      } catch (err) {
        // Никогда не падаем из-за viewport API — тихий no-op.
        // eslint-disable-next-line no-console
        console.warn("[vv-inset] compute failed", err);
        setOffset(0);
      }
    };

    // Initial
    compute();

    // Visual Viewport events (may be undefined in older browsers)
    if (vv) {
      vv.addEventListener("resize", compute);
      vv.addEventListener("scroll", compute);
    }

    // Focus events — клавиатура открывается/закрывается обычно вместе с
    // фокусом на input/textarea, эти события дают более ранний trigger,
    // чем visualViewport.resize.
    const onFocusIn = () => {
      // Микро-задержка: vv.height ещё не обновлён в момент focusin
      window.setTimeout(compute, 50);
      window.setTimeout(compute, 250);
    };
    const onFocusOut = () => {
      window.setTimeout(compute, 50);
      window.setTimeout(compute, 250);
    };
    window.addEventListener("focusin", onFocusIn);
    window.addEventListener("focusout", onFocusOut);

    return () => {
      if (vv) {
        vv.removeEventListener("resize", compute);
        vv.removeEventListener("scroll", compute);
      }
      window.removeEventListener("focusin", onFocusIn);
      window.removeEventListener("focusout", onFocusOut);
      // Сброс — чтобы переменная не «застряла» при unmount страницы.
      root.style.setProperty("--room-vv-bottom-offset", "0px");
    };
  }, []);
}
