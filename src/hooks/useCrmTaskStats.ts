import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface CrmTaskStatsItem {
  assignee_user_id: string | null;
  full_name: string | null;
  avatar_url: string | null;
  has_telegram: boolean;
  open_total: number;
  in_progress: number;
  overdue: number;
  due_today: number;
  created_7d: number;
  created_30d: number;
  done_7d: number;
  done_30d: number;
  canceled_7d: number;
  canceled_30d: number;
  avg_close_hours_30d: number | null;
}

export interface CrmTaskStatsTotals {
  total_open: number;
  total_overdue: number;
  total_done_7d: number;
  total_done_30d: number;
  total_canceled_30d: number;
  total_created_30d: number;
}

export interface CrmTaskStatsResponse {
  items: CrmTaskStatsItem[];
  totals: CrmTaskStatsTotals;
  generated_at: string;
}

export function useCrmTaskStats() {
  return useQuery({
    queryKey: ["crm-task-stats-by-assignee"],
    queryFn: async (): Promise<CrmTaskStatsResponse> => {
      const { data, error } = await (supabase as any).rpc("crm_task_stats_by_assignee");
      if (error) throw error;
      return data as CrmTaskStatsResponse;
    },
    staleTime: 60 * 1000,
  });
}
