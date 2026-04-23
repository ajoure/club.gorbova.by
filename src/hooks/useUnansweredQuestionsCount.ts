import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Staff-only realtime счётчик НЕОТВЕЧЕННЫХ вопросов эфира.
 *
 * Контракт:
 * - enabled должен быть true ТОЛЬКО для staff/presenter (вызывающая сторона решает).
 * - Для non-staff передавайте enabled=false — хук вернёт 0 без сетевых запросов.
 * - Источник истины: live_event_questions WHERE live_event_id=? AND is_answered=false.
 * - RLS на live_event_questions сама отфильтрует — staff увидит все, non-staff (даже если
 *   случайно вызовет с enabled=true) увидит только свои → privacy не утечёт.
 * - Это именно "неотвеченные", а не "новые с момента последнего просмотра"
 *   (per-staff read-cursor намеренно НЕ вводится в этом PATCH).
 */
export function useUnansweredQuestionsCount(
  liveEventId: string | null | undefined,
  enabled: boolean,
): number {
  const queryClient = useQueryClient();
  const queryKey = ["live-questions-unanswered-count", liveEventId];

  const { data } = useQuery({
    queryKey,
    enabled: !!liveEventId && enabled,
    queryFn: async () => {
      if (!liveEventId) return 0;
      const { count, error } = await supabase
        .from("live_event_questions")
        .select("id", { count: "exact", head: true })
        .eq("live_event_id", liveEventId)
        .eq("is_answered", false);
      if (error) {
        console.error("[useUnansweredQuestionsCount] error:", error);
        return 0;
      }
      return count ?? 0;
    },
  });

  useEffect(() => {
    if (!liveEventId || !enabled) return;
    const channel = supabase
      .channel(`live-questions-count-${liveEventId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "live_event_questions",
          filter: `live_event_id=eq.${liveEventId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveEventId, enabled, queryClient]);

  return enabled ? (data ?? 0) : 0;
}
