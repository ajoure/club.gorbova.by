import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useVisibilityPolling } from "./useVisibilityPolling";
import { UNREAD_MESSAGES_COUNT_QK } from "@/constants/inboxQueryKeys";

/**
 * useUnreadMessagesCount
 *
 * Возвращает количество Telegram-вопросов, на которые ещё нужен ответ.
 * Просмотр сообщения (`is_read`) не закрывает вопрос: это делает только
 * человеческий ответ в точном Telegram-канале.
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
      const { data, error } = await supabase.rpc(
        "get_contact_center_unanswered_total_v1" as any,
      );

      if (error) {
        console.warn("[useUnreadMessagesCount] Query error:", error.message);
        return 0;
      }
      return Number(data) || 0;
    },
    refetchInterval: visibilityInterval,
    retry: 3,
  });

  return count;
}
