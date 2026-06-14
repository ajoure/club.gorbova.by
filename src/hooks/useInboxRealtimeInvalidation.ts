import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  INBOX_DIALOGS_QK,
  UNREAD_MESSAGES_COUNT_QK,
} from "@/constants/inboxQueryKeys";

/**
 * useInboxRealtimeInvalidation
 *
 * Единая точка реактивной инвалидации списка диалогов и счётчика
 * непрочитанных в контакт-центре. Заменяет:
 *   - локальную подписку `inbox-messages-realtime` в InboxTabContent;
 *   - realtime-подписку внутри useUnreadMessagesCount.
 *
 * НЕ заменяет:
 *   - `global-incoming-alert` (sound-only с серверным фильтром
 *     `direction=eq.incoming`, остаётся единственным источником звука);
 *   - per-dialog `chat-messages-<userId>` / `chat-bridge-<userId>` внутри
 *     открытого чата (фильтрованные, patch'ат кэш конкретного диалога).
 *
 * Контракт:
 *   - SINGLE OWNER: монтируется ровно один раз в `AdminLayout`, потому что
 *     счётчик `useUnreadMessagesCount` живёт в `AdminSidebar` (всегда виден).
 *   - Trailing debounce 300 мс с двумя независимыми «карманами»
 *     (inbox-dialogs / unread-count): последнее событие в окне всегда
 *     приводит к инвалидации; промежуточные не теряются, но и не
 *     порождают каскад refetch.
 *   - Event-aware матрица:
 *       INSERT direction='incoming'  → inbox-dialogs + unread-count
 *       INSERT direction='outgoing'  → inbox-dialogs
 *       UPDATE                       → inbox-dialogs;
 *                                       если new.is_read=true И direction='incoming'
 *                                       → также unread-count
 *       DELETE                       → inbox-dialogs + unread-count
 *   - Cleanup на unmount: flush ожидающих инвалидаций + очистка таймера +
 *     `supabase.removeChannel`. Повторный mount не оставляет старый канал.
 *   - StrictMode-safe: при повторном вызове useEffect cleanup удаляет
 *     предыдущий канал; никаких дубликатов подписки.
 *
 * Тяжёлая работа (refetch RPC `get_inbox_dialogs_v1` и count(*)) лежит на
 * React Query: при двух последовательных invalidate в пределах одного
 * batch'а реальный HTTP-запрос делается один раз благодаря in-flight dedup.
 */
export function useInboxRealtimeInvalidation(): void {
  const queryClient = useQueryClient();
  // refs не вызывают re-render и сохраняются между батчами событий
  const inboxPendingRef = useRef(false);
  const unreadPendingRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    const flush = () => {
      timerRef.current = null;
      const flushInbox = inboxPendingRef.current;
      const flushUnread = unreadPendingRef.current;
      inboxPendingRef.current = false;
      unreadPendingRef.current = false;
      if (flushInbox) {
        queryClient.invalidateQueries({ queryKey: INBOX_DIALOGS_QK });
      }
      if (flushUnread) {
        queryClient.invalidateQueries({ queryKey: UNREAD_MESSAGES_COUNT_QK });
      }
    };

    const schedule = () => {
      if (timerRef.current !== null) return;
      timerRef.current = window.setTimeout(flush, 300);
    };

    const markInbox = () => {
      inboxPendingRef.current = true;
      schedule();
    };
    const markUnread = () => {
      unreadPendingRef.current = true;
      schedule();
    };

    const channel = supabase
      .channel("inbox-realtime-bus")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "telegram_messages" },
        (payload) => {
          const row = payload.new as { direction?: string } | null;
          markInbox();
          if (row?.direction === "incoming") {
            markUnread();
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "telegram_messages" },
        (payload) => {
          const row = payload.new as
            | { direction?: string; is_read?: boolean }
            | null;
          markInbox();
          // Эвристика без зависимости от REPLICA IDENTITY FULL:
          // если новое состояние строки = «прочитанное входящее», это
          // событие меняет счётчик непрочитанных.
          if (row?.direction === "incoming" && row?.is_read === true) {
            markUnread();
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "telegram_messages" },
        () => {
          markInbox();
          markUnread();
        },
      )
      .subscribe((status) => {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          // Лог уровня warn — Realtime сам делает reconnect, refetch'и
          // продолжат приходить после восстановления.
          console.warn("[inbox-realtime-bus] channel status:", status);
        }
      });

    return () => {
      // Flush ожидающих инвалидаций, чтобы последний invalidate не потерялся
      // при unmount/route-change.
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
        flush();
      }
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
