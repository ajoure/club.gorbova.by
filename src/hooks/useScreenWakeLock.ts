import { useEffect, useRef } from "react";

/**
 * useScreenWakeLock(enabled)
 *
 * Удерживает экран устройства активным, пока `enabled === true`.
 * Используется во время просмотра live-эфира, чтобы экран телефона
 * не гас по auto-lock и не прерывал просмотр.
 *
 * Контракт:
 * - enabled=true → запросить screen wake lock (если API доступен).
 * - enabled=false / unmount / уход со страницы → release.
 * - visibilitychange (вкладка снова visible) + enabled=true → re-acquire.
 *   Wake Lock API автоматически освобождается при backgrounding вкладки —
 *   это документированное поведение, поэтому re-acquire обязателен.
 *
 * Fail-safe гарантии:
 * - `'wakeLock' in navigator` отсутствует → тихий no-op, ноль ошибок в UI.
 * - Любая ошибка request/release → console.warn, без throw, без retry-loop.
 * - Никаких side-эффектов на rendering: хук ничего не возвращает.
 *
 * Подключение должно делаться ОДНИМ вызовом в LiveEvent.tsx с условием
 * `enabled = state === 'live' || state === 'room_open_waiting'`. Не привязывать
 * к табам/чату/реакциям/composer — только к состоянию комнаты.
 */
export function useScreenWakeLock(enabled: boolean): void {
  // Сохраняем sentinel в ref, чтобы effect cleanup мог его освободить
  // даже если enabled меняется быстро.
  const sentinelRef = useRef<WakeLockSentinel | null>(null);
  // enabledRef — чтобы visibilitychange listener видел актуальное значение
  // без пере-подписки.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    // Feature detection — silent no-op для неподдерживающих браузеров
    // (Firefox, старый Safari, Safari iOS < 16.4).
    if (typeof navigator === "undefined" || !("wakeLock" in navigator)) {
      return;
    }

    let cancelled = false;

    const release = async () => {
      const sentinel = sentinelRef.current;
      if (!sentinel) return;
      sentinelRef.current = null;
      try {
        await sentinel.release();
        console.info("[wake-lock] released");
      } catch (e) {
        console.warn("[wake-lock] release failed", e);
      }
    };

    const acquire = async () => {
      if (cancelled) return;
      if (sentinelRef.current) return; // уже держим
      try {
        const wakeLock = (navigator as Navigator & { wakeLock: { request: (type: "screen") => Promise<WakeLockSentinel> } }).wakeLock;
        const sentinel: WakeLockSentinel = await wakeLock.request("screen");
        if (cancelled) {
          // Если успели уйти пока ждали request — сразу release
          try {
            await sentinel.release();
          } catch {
            /* noop */
          }
          return;
        }
        sentinelRef.current = sentinel;
        sentinel.addEventListener("release", () => {
          // Браузер может освободить sentinel сам (backgrounding и т.п.)
          if (sentinelRef.current === sentinel) {
            sentinelRef.current = null;
          }
        });
        console.info("[wake-lock] acquired");
      } catch (e) {
        // NotAllowedError, SecurityError и пр. — не падаем, просто log.
        console.warn("[wake-lock] acquire failed", e);
      }
    };

    const handleVisibility = () => {
      // Re-acquire ТОЛЬКО если страница снова visible И мы всё ещё нужны.
      if (document.visibilityState === "visible" && enabledRef.current) {
        void acquire();
      }
    };

    if (enabled) {
      void acquire();
      document.addEventListener("visibilitychange", handleVisibility);
    }

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      void release();
    };
  }, [enabled]);
}
