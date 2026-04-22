import { useEffect, useState, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Add-only stream-хук для overlay реакций (поверх видео).
 *
 * Контракт:
 * - НЕ заменяет useLiveEventReactions (aggregate/counts) — отдельный поток.
 * - На каждый INSERT в live_event_reactions эмитит "летящую" реакцию,
 *   которая авто-удаляется через TTL.
 * - Имена/PII не используются — только emoji.
 * - Без счётчиков, без бизнес-логики, без записи в БД (только подписка).
 *
 * PATCH (rail+aggregation):
 * - Агрегация одинаковых emoji в окне AGGREGATION_WINDOW_MS → один пузырь с count ×N.
 * - Лимит одновременных: 5 desktop / 3 mobile (drop старейших).
 * - TTL не продлевается при агрегации (визуальная стабильность).
 * - Запись в БД отсутствует — только локальный state.
 */

export type FloatingReaction = {
  /** Уникальный id экземпляра анимации (НЕ id строки в БД). */
  key: string;
  emoji: string;
  /** Сколько одинаковых реакций склеено в один пузырь (для бейджа ×N). */
  count: number;
  /** ms TTL — overlay удаляет элемент по таймеру (не продлевается). */
  ttl: number;
  /** Когда последний раз обновлялся (для окна агрегации). */
  lastUpdatedAt: number;
};

const TTL_MS = 2600;
const AGGREGATION_WINDOW_MS = 800;
const MAX_DESKTOP = 5;
const MAX_MOBILE = 3;

export function useLiveReactionOverlayStream(
  eventId: string | null | undefined,
  enabled = true,
  isMobile = false,
) {
  const [items, setItems] = useState<FloatingReaction[]>([]);
  const counterRef = useRef(0);
  const maxOnScreen = isMobile ? MAX_MOBILE : MAX_DESKTOP;

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
          const now = Date.now();

          setItems((prev) => {
            // Агрегация: ищем самый свежий активный пузырь с тем же emoji
            // в окне AGGREGATION_WINDOW_MS. Если есть — инкрементим count,
            // НЕ продлеваем TTL (визуальная стабильность).
            const idx = [...prev]
              .map((it, i) => ({ it, i }))
              .reverse()
              .find(
                ({ it }) =>
                  it.emoji === emoji &&
                  now - it.lastUpdatedAt <= AGGREGATION_WINDOW_MS,
              );

            if (idx) {
              const next = prev.slice();
              next[idx.i] = {
                ...next[idx.i],
                count: next[idx.i].count + 1,
                lastUpdatedAt: now,
              };
              return next;
            }

            counterRef.current += 1;
            const key = `${now}-${counterRef.current}`;
            const newItem: FloatingReaction = {
              key,
              emoji,
              count: 1,
              ttl: TTL_MS,
              lastUpdatedAt: now,
            };
            // авто-удаление по TTL (один таймер на пузырь, без продления)
            setTimeout(() => {
              setItems((p) => p.filter((i) => i.key !== key));
            }, TTL_MS + 50);

            const merged = [...prev, newItem];
            // drop старейших при превышении лимита
            return merged.length > maxOnScreen
              ? merged.slice(-maxOnScreen)
              : merged;
          });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [eventId, enabled, maxOnScreen]);

  return { items, dismiss };
}
