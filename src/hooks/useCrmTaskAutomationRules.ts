import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";

export type AssigneeStrategy = "fixed_user" | "deal_owner" | "round_robin";

export interface CrmTaskAutomationRule {
  id: string;
  workspace_id: string;
  offer_id: string;
  task_type_id: string;
  title_template: string;
  description_template: string | null;
  assignee_strategy: AssigneeStrategy;
  assignee_user_id: string | null;
  due_offset_minutes: number;
  reminder_offset_minutes: number | null;
  is_active: boolean;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UpsertRulePayload {
  id?: string;
  offer_id: string;
  task_type_id: string;
  title_template: string;
  description_template?: string | null;
  assignee_strategy: AssigneeStrategy;
  assignee_user_id?: string | null;
  due_offset_minutes: number;
  reminder_offset_minutes?: number | null;
  is_active: boolean;
}

const QK = (offerId: string | null | undefined) => ["crm-task-automation-rules", offerId ?? "all"];

export function useCrmTaskAutomationRules(offerId: string | null | undefined) {
  return useQuery({
    queryKey: QK(offerId),
    enabled: !!offerId,
    queryFn: async (): Promise<CrmTaskAutomationRule[]> => {
      const { data, error } = await (supabase as any)
        .from("crm_task_automation_rules")
        .select("*")
        .eq("offer_id", offerId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as CrmTaskAutomationRule[];
    },
    staleTime: 30 * 1000,
  });
}

export function useUpsertCrmTaskAutomationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: UpsertRulePayload) => {
      const body: Record<string, unknown> = {
        offer_id: payload.offer_id,
        task_type_id: payload.task_type_id,
        title_template: payload.title_template.trim(),
        description_template: payload.description_template?.trim() || null,
        assignee_strategy: payload.assignee_strategy,
        assignee_user_id:
          payload.assignee_strategy === "fixed_user" ? payload.assignee_user_id ?? null : null,
        due_offset_minutes: payload.due_offset_minutes,
        reminder_offset_minutes: payload.reminder_offset_minutes ?? null,
        is_active: payload.is_active,
      };

      if (payload.id) {
        const { data, error } = await (supabase as any)
          .from("crm_task_automation_rules")
          .update(body)
          .eq("id", payload.id)
          .select("*")
          .single();
        if (error) throw error;
        return data;
      }
      const { data, error } = await (supabase as any)
        .from("crm_task_automation_rules")
        .insert(body)
        .select("*")
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: QK(vars.offer_id) });
      toast.success(vars.id ? "Правило обновлено" : "Правило создано");
    },
    onError: (err: any) => {
      toast.error(err?.message || "Не удалось сохранить правило");
    },
  });
}

export function useToggleCrmTaskAutomationRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { id: string; offer_id: string; is_active: boolean }) => {
      const { error } = await (supabase as any)
        .from("crm_task_automation_rules")
        .update({ is_active: args.is_active })
        .eq("id", args.id);
      if (error) throw error;
      return args;
    },
    onSuccess: (vars) => {
      qc.invalidateQueries({ queryKey: QK(vars.offer_id) });
    },
    onError: (err: any) => {
      toast.error(err?.message || "Не удалось изменить статус правила");
    },
  });
}
