import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type PipelineAutomationStatus = "draft" | "active" | "paused" | "archived";

export interface PipelineAutomationRule {
  id: string;
  logical_id: string;
  version: number;
  pipeline_id: string;
  stage_id: string;
  name: string;
  status: PipelineAutomationStatus;
  task_type_id: string;
  title_template: string;
  description_template: string | null;
  assignee_strategy: "deal_owner" | "fixed_user";
  assignee_user_id: string | null;
  due_offset_minutes: number;
  reminder_offset_minutes: number | null;
  created_at: string;
  updated_at: string;
}

export interface CreatePipelineAutomationRule {
  pipeline_id: string;
  stage_id: string;
  name: string;
  task_type_id: string;
  title_template: string;
  description_template?: string | null;
  assignee_strategy: "deal_owner" | "fixed_user";
  assignee_user_id?: string | null;
  due_offset_minutes: number;
  reminder_offset_minutes?: number | null;
}

const rulesKey = (pipelineId: string | null) => ["crm-pipeline-automation-rules", pipelineId];

export function usePipelineAutomationRules(pipelineId: string | null) {
  return useQuery({
    queryKey: rulesKey(pipelineId),
    enabled: Boolean(pipelineId),
    queryFn: async (): Promise<PipelineAutomationRule[]> => {
      // Table is introduced by this PR; generated Database types are refreshed after migration apply.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("crm_pipeline_automation_rules")
        .select("*")
        .eq("pipeline_id", pipelineId)
        .neq("status", "archived")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PipelineAutomationRule[];
    },
    staleTime: 30_000,
  });
}

export function useCreatePipelineAutomationRule() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (payload: CreatePipelineAutomationRule) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("crm_pipeline_automation_rules")
        .insert({
          ...payload,
          name: payload.name.trim(),
          title_template: payload.title_template.trim(),
          description_template: payload.description_template?.trim() || null,
          assignee_user_id:
            payload.assignee_strategy === "fixed_user" ? payload.assignee_user_id : null,
          reminder_offset_minutes: payload.reminder_offset_minutes ?? null,
          status: "draft",
          trigger_type: "deal_entered_stage",
          action_type: "create_task",
        })
        .select("*")
        .single();
      if (error) throw error;
      return data as PipelineAutomationRule;
    },
    onSuccess: (rule) => {
      queryClient.invalidateQueries({ queryKey: rulesKey(rule.pipeline_id) });
      toast.success("Черновик автоматизации создан");
    },
    onError: (error: Error) => toast.error(error.message || "Не удалось создать автоматизацию"),
  });
}

export function useSetPipelineAutomationStatus() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      id,
      pipelineId,
      status,
    }: {
      id: string;
      pipelineId: string;
      status: PipelineAutomationStatus;
    }) => {
      const patch: Record<string, unknown> = { status };
      if (status === "active") patch.published_at = new Date().toISOString();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { error } = await (supabase as any)
        .from("crm_pipeline_automation_rules")
        .update(patch)
        .eq("id", id);
      if (error) throw error;
      return { pipelineId, status };
    },
    onSuccess: ({ pipelineId, status }) => {
      queryClient.invalidateQueries({ queryKey: rulesKey(pipelineId) });
      toast.success(
        status === "active"
          ? "Автоматизация опубликована"
          : status === "paused"
            ? "Автоматизация приостановлена"
            : status === "archived"
              ? "Автоматизация архивирована"
              : "Статус обновлён",
      );
    },
    onError: (error: Error) => toast.error(error.message || "Не удалось изменить статус"),
  });
}
