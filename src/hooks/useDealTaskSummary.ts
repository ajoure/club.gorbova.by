import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface DealTaskSummary {
  deal_id: string;
  open_count: number;
  overdue_count: number;
  next_due_at: string | null;
  next_task_type_key: string | null;
  next_task_type_label: string | null;
  next_task_type_icon: string | null;
  next_task_type_color: string | null;
}

export function useDealTaskSummary(dealIds: string[]) {
  const ids = Array.from(new Set(dealIds.filter(Boolean))).sort();
  const key = ids.join(",");

  return useQuery({
    queryKey: ["crm-deal-task-summary", key],
    enabled: ids.length > 0,
    staleTime: 30_000,
    queryFn: async (): Promise<Record<string, DealTaskSummary>> => {
      const out: Record<string, DealTaskSummary> = {};
      // batch in chunks of 500 to keep URL small
      const CHUNK = 500;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { data, error } = await (supabase as any)
          .from("crm_deal_task_summary_v")
          .select("*")
          .in("deal_id", slice);
        if (error) throw error;
        (data ?? []).forEach((row: DealTaskSummary) => {
          out[row.deal_id] = row;
        });
      }
      return out;
    },
  });
}
