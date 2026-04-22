import { useLiveReactionOverlayStream } from "@/hooks/useLiveReactionOverlayStream";
import { useIsMobile } from "@/hooks/use-mobile";

/**
 * Overlay реакций поверх видео-области.
 *
 * Контракт (PATCH rail):
 * - Жёсткий bottom-right rail внутри video-shell:
 *     right-2 md:right-3, bottom-3 md:bottom-4
 *     ширина 72px (mobile) / 96px (desktop)
 *     высота активной зоны 32% video-shell (в норме 30–35%)
 * - Без случайного left, без drift по ширине.
 * - Реакции появляются СНИЗУ rail и всплывают вверх (flex-col-reverse).
 * - Центральные 40% ширины видео физически не пересекаются.
 * - pointer-events: none — overlay не перехватывает клики.
 * - Только emoji + бейдж ×N, БЕЗ имён/подписей (privacy + perf).
 * - Лимит одновременных: 5 desktop / 3 mobile (см. useLiveReactionOverlayStream).
 * - Агрегация одинаковых emoji в окно 800ms → один пузырь с ×N.
 * - Размер уменьшен: text-xl md:text-2xl, opacity 0.55, лёгкий drop-shadow.
 * - TTL ~2600ms.
 * - Realtime для всех: подписка через useLiveReactionOverlayStream
 *   на INSERT live_event_reactions (READ-only, никаких записей).
 * - Bar отправки реакций — отдельный компонент (LiveRoomReactionsBar), не трогаем.
 */
export function LiveRoomReactionsOverlay({
  liveEventId,
  enabled,
}: {
  liveEventId: string;
  enabled: boolean;
}) {
  const isMobile = useIsMobile();
  const { items } = useLiveReactionOverlayStream(liveEventId, enabled, isMobile);
  if (!enabled) return null;

  return (
    <div
      aria-hidden="true"
      data-overlay="reactions-rail"
      className="pointer-events-none absolute right-2 md:right-3 bottom-3 md:bottom-4 w-[72px] md:w-[96px] h-[32%] overflow-hidden z-20 flex flex-col-reverse items-center gap-1"
    >
      {items.map((r) => (
        <span
          key={r.key}
          className="reaction-float inline-flex items-baseline justify-center text-xl md:text-2xl select-none"
          style={{
            animationDuration: `${r.ttl}ms`,
            opacity: 0.55,
            filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.35))",
          }}
        >
          <span>{r.emoji}</span>
          {r.count > 1 && (
            <span className="text-[10px] font-semibold opacity-80 ml-0.5">
              ×{r.count}
            </span>
          )}
        </span>
      ))}

      {/* Локальные keyframes (изоляция в overlay, не глобально). */}
      <style>{`
        @keyframes reaction-float-up {
          0%   { transform: translateY(8px)  scale(0.85); opacity: 0; }
          15%  { transform: translateY(0)    scale(1);    opacity: 0.55; }
          80%  { transform: translateY(-90px) scale(1);   opacity: 0.55; }
          100% { transform: translateY(-130px) scale(0.9); opacity: 0; }
        }
        .reaction-float {
          animation-name: reaction-float-up;
          animation-timing-function: ease-out;
          animation-fill-mode: forwards;
          will-change: transform, opacity;
        }
      `}</style>
    </div>
  );
}
