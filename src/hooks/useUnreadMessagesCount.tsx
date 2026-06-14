import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useVisibilityPolling } from "./useVisibilityPolling";
import { UNREAD_MESSAGES_COUNT_QK } from "@/constants/inboxQueryKeys";

/**
 * useUnreadMessagesCount
 *
 * Возвращает количество непрочитанных входящих сообщений Telegram
 * (direction='incoming' AND is_read=false).
 *
 * Realtime-инвалидация выполняется глобальным `useInboxRealtimeInvalidation`
 * (см. `src/hooks/useInboxRealtimeInvalidation.ts`), смонтированным один раз
 * в `AdminLayout`. Здесь оставлен только safety polling раз в 5 минут с
 * visibility-aware паузой во вкладке вне фокуса — на случай потери
 * realtime-канала.
 */
export function useUnreadMessagesCount() {
  // 5 минут — safety net. Основная сигнализация идёт через realtime-bus.
  const visibilityInterval = useVisibilityPolling(5 * 60 * 1000);

  const { data: count = 0 } = useQuery({
    queryKey: UNREAD_MESSAGES_COUNT_QK,
    queryFn: async () => {
      const { count, error } = await supabase
        .from("telegram_messages")
        .select("*", { count: "exact", head: true })
        .eq("direction", "incoming")
        .eq("is_read", false);

      if (error) {
        console.warn("[useUnreadMessagesCount] Query error:", error.message);
        return 0;
      }
      return count || 0;
    },
    refetchInterval: visibilityInterval,
    retry: 3,
  });

  return count;
}
