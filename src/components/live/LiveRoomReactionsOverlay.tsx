import { useLiveReactionOverlayStream } from "@/hooks/useLiveReactionOverlayStream";

/**
 * Overlay реакций поверх видео-области.
 *
 * Контракт:
 * - Абсолютный слой, pointer-events: none — не перехватывает клики.
 * - Только emoji-анимации, БЕЗ имён/подписей (privacy + perf).
 * - Анимация: fade-in + всплытие снизу вверх ~3s, затем fade-out и удаление из DOM.
 * - Realtime для всех: подписка через useLiveReactionOverlayStream
 *   на INSERT live_event_reactions.
 * - Bar отправки реакций — отдельный компонент (LiveRoomReactionsBar), не трогаем.
 */
export function LiveRoomReactionsOverlay({
  liveEventId,
  enabled,
}: {
  liveEventId: string;
  enabled: boolean;
}) {
  const { items } = useLiveReactionOverlayStream(liveEventId, enabled);
  if (!enabled) return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden z-20"
    >
      {items.map((r) => {
        // Горизонтальное смещение 10..90% ширины
        const leftPct = 10 + Math.round(r.drift * 80);
        return (
          <span
            key={r.key}
            className="absolute bottom-2 text-3xl md:text-4xl select-none reaction-float"
            style={{
              left: `${leftPct}%`,
              animationDuration: `${r.ttl}ms`,
            }}
          >
            {r.emoji}
          </span>
        );
      })}

      {/* Локальные keyframes (изоляция в overlay, не глобально). */}
      <style>{`
        @keyframes reaction-float-up {
          0%   { transform: translateY(0)   scale(0.8); opacity: 0; }
          15%  { transform: translateY(-20px) scale(1.05); opacity: 1; }
          80%  { transform: translateY(-180px) scale(1);   opacity: 1; }
          100% { transform: translateY(-240px) scale(0.9); opacity: 0; }
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
