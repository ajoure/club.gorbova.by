import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Add-only stream-хук для overlay реакций (поверх видео).
 *
 * Контракт:
 * - НЕ заменяет useLiveEventReactions (aggregate/counts) — отдельный поток.
 * - На каждый INSERT в live_event_reactions эмитит "летящую" реакцию,
 *   которая авто-удаляется через ~3s.
 * - Имена/PII не используются — только emoji.
 * - Без счётчиков, без бизнес-логики, без записи в БД (только подписка).
 */

export type FloatingReaction = {
  /** Уникальный id экземпляра анимации (НЕ id строки в БД). */
  key: string;
  emoji: string;
  /** Случайное смещение по горизонтали 0..1 — для разлёта. */
  drift: number;
  /** ms TTL — overlay удаляет элемент по таймеру. */
  ttl: number;
};

const TTL_MS = 3000;
const MAX_ON_SCREEN = 30; // защита от потоковых всплесков

export function useLiveReactionOverlayStream(
  eventId: string | null | undefined,
  enabled = true,
) {
  const [items, setItems] = useState<FloatingReaction[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((key: string) => {
    setItems((prev) => prev.filter((i) => i.key !== key));
  }, []);

  useEffect(() => {
    if (!eventId || !enabled) return;
    const channel = supabase
      .channel(`live-reactions-overlay:${eventId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "live_event_reactions",
          filter: `live_event_id=eq.${eventId}`,
        },
        (payload: any) => {
          const emoji = String(payload?.new?.emoji ?? "");
          if (!emoji) return;
          counterRef.current += 1;
          const key = `${Date.now()}-${counterRef.current}`;
          setItems((prev) => {
            const next = [
              ...prev,
              { key, emoji, drift: Math.random(), ttl: TTL_MS },
            ];
            return next.length > MAX_ON_SCREEN ? next.slice(-MAX_ON_SCREEN) : next;
          });
          // авто-удаление по TTL
          setTimeout(() => {
            setItems((prev) => prev.filter((i) => i.key !== key));
          }, TTL_MS + 50);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, enabled]);

  return { items, dismiss };
}
