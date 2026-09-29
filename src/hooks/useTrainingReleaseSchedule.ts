import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TrainingReleaseSchedule {
  flow_id: string;
  root_module_id: string;
  start_date: string;
  starts_at: string;
  timezone: string;
  addon_delay_days: number;
  addon_mode: "scheduled" | "manual";
  addons_open_at: string;
  before_start: boolean;
  is_active: boolean;
}

export function useTrainingReleaseSchedule(moduleId?: string) {
  return useQuery({
    queryKey: ["training-release-schedule", moduleId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_training_release_schedule", { _module_id: moduleId! });
      if (error) throw error;
      return data as unknown as TrainingReleaseSchedule | null;
    },
    enabled: !!moduleId,
    staleTime: 0,
    refetchInterval: 30_000,
  });
}

export function formatTrainingReleaseDate(value: string) {
  return new Intl.DateTimeFormat("ru-RU", { timeZone: "Europe/Minsk", day: "numeric", month: "long", year: "numeric" }).format(new Date(value));
}
