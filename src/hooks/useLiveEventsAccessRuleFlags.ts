/**
 * useLiveEventsAccessRuleFlags — READ-ONLY guard-хук.
 *
 * Возвращает Set live_event_id, у которых есть хотя бы одна запись
 * в public.live_event_access_rules. Используется исключительно как
 * административный guard в UI: пометка карточек/строк без правил и
 * блокировка кнопок lifecycle до настройки доступа.
 *
 * Хук НЕ создаёт правил и НЕ меняет доступ. Отсутствие правила =
 * default-deny для non-admin (штатное поведение backend).
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export function useLiveEventsAccessRuleFlags(enabled: boolean = true) {
  return useQuery({
    queryKey: ["live-events-access-rule-flags"],
    enabled,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("live_event_access_rules")
        .select("live_event_id");
      if (error) throw error;
      const withRules = new Set<string>();
      for (const row of (data || []) as Array<{ live_event_id: string | null }>) {
        if (row.live_event_id) withRules.add(row.live_event_id);
      }
      return withRules;
    },
  });
}
