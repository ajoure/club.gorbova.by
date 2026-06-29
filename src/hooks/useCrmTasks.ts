import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type CrmTaskStatus = "open" | "in_progress" | "done" | "canceled";
export type CrmTaskBucket =
  | "overdue"
  | "today"
  | "tomorrow"
  | "week"
  | "later"
  | "no_due"
  | "closed";

export interface CrmTask {
  id: string;
  public_id: string | null;
  workspace_id: string;
  task_type_id: string;
  title: string;
  description: string | null;
  contact_id: string | null;
  deal_id: string | null;
  order_id: string | null;
  pipeline_id: string | null;
  pipeline_stage_id: string | null;
  offer_id: string | null;
  product_id: string | null;
  tariff_id: string | null;
  assignee_user_id: string | null;
  due_at: string | null;
  remind_at: string | null;
  status: CrmTaskStatus;
  result_comment: string | null;
  closed_at: string | null;
  closed_by: string | null;
  source: "manual" | "auto" | "system";
  automation_rule_id: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  meta: Record<string, unknown>;
}

export interface CrmTaskType {
  id: string;
  key: string;
  label: string;
  icon: string | null;
  color: string | null;
  default_due_offset_minutes: number | null;
  default_reminder_offset_minutes: number | null;
  is_active: boolean;
  sort_order: number;
}

export interface CrmTaskListFilters {
  assignee_user_id?: string | null;
  status?: CrmTaskStatus[];
  task_type_id?: string[];
  deal_id?: string | null;
  contact_id?: string | null;
  due_from?: string | null;
  due_to?: string | null;
  bucket?: CrmTaskBucket | null;
  search?: string | null;
  limit?: number;
  offset?: number;
}

export function useCrmTaskTypes() {
  return useQuery({
    queryKey: ["crm-task-types"],
    queryFn: async (): Promise<CrmTaskType[]> => {
      const { data, error } = await (supabase as any)
        .from("crm_task_types")
        .select("id,key,label,icon,color,default_due_offset_minutes,default_reminder_offset_minutes,is_active,sort_order")
        .eq("is_active", true)
        .order("sort_order", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CrmTaskType[];
    },
    staleTime: 5 * 60 * 1000,
  });
}

export function useCrmTasks(filters: CrmTaskListFilters) {
  return useQuery({
    queryKey: ["crm-tasks", filters],
    queryFn: async (): Promise<CrmTask[]> => {
      const payload: Record<string, unknown> = {};
      Object.entries(filters).forEach(([k, v]) => {
        if (v === null || v === undefined || v === "") return;
        if (Array.isArray(v) && v.length === 0) return;
        payload[k] = v;
      });
      const { data, error } = await (supabase as any).rpc("crm_task_list", {
        _filters: payload,
      });
      if (error) throw error;
      return (data ?? []) as CrmTask[];
    },
  });
}

export function useCreateCrmTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (payload: Record<string, unknown>): Promise<string> => {
      const { data, error } = await (supabase as any).rpc("crm_task_create", {
        payload,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-tasks"] });
      qc.invalidateQueries({ queryKey: ["crm-deal-task-summary"] });
      toast.success("Задача создана");
    },
    onError: (err: Error) => toast.error(`Не удалось создать задачу: ${err.message}`),
  });
}

export function useUpdateCrmTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { taskId: string; status: CrmTaskStatus; resultComment?: string }) => {
      const { error } = await (supabase as any).rpc("crm_task_update_status", {
        _task_id: args.taskId,
        _status: args.status,
        _result_comment: args.resultComment ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-tasks"] });
      qc.invalidateQueries({ queryKey: ["crm-deal-task-summary"] });
    },
    onError: (err: Error) => toast.error(`Не удалось обновить статус: ${err.message}`),
  });
}

export function useReassignCrmTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { taskId: string; assigneeUserId: string | null }) => {
      const { error } = await (supabase as any).rpc("crm_task_reassign", {
        _task_id: args.taskId,
        _assignee: args.assigneeUserId,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-tasks"] });
      toast.success("Ответственный обновлён");
    },
    onError: (err: Error) => toast.error(`Не удалось переназначить: ${err.message}`),
  });
}

export interface CrmTaskUpdatePatch {
  title?: string;
  description?: string | null;
  task_type_id?: string;
  due_at?: string | null;
  remind_at?: string | null;
  result_comment?: string | null;
  assignee_user_id?: string | null;
  deal_id?: string | null;
  contact_id?: string | null;
}

export function useUpdateCrmTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { taskId: string; patch: CrmTaskUpdatePatch }) => {
      const payload: Record<string, unknown> = { ...args.patch };
      const { data: auth } = await supabase.auth.getUser();
      if (auth?.user?.id) payload.updated_by = auth.user.id;
      const { error } = await (supabase as any)
        .from("crm_tasks")
        .update(payload)
        .eq("id", args.taskId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-tasks"] });
      qc.invalidateQueries({ queryKey: ["crm-deal-task-summary"] });
      toast.success("Задача обновлена");
    },
    onError: (err: Error) => toast.error(`Не удалось обновить задачу: ${err.message}`),
  });
}

export interface BulkResult {
  updated: number;
  total: number;
  skipped?: Array<{ id: string; reason: string }>;
  request_id?: string;
  patch_keys?: string[];
}

/** Bulk status change. Comment required when status is 'done' or 'canceled'. */
export function useBulkUpdateCrmTaskStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      taskIds: string[];
      status: CrmTaskStatus;
      resultComment?: string | null;
      requestId?: string;
    }): Promise<BulkResult> => {
      const { data, error } = await (supabase as any).rpc("crm_task_bulk_status", {
        _task_ids: args.taskIds,
        _status: args.status,
        _result_comment: args.resultComment ?? null,
        _request_id: args.requestId ?? null,
      });
      if (error) throw error;
      return data as BulkResult;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["crm-tasks"] });
      qc.invalidateQueries({ queryKey: ["crm-deal-task-summary"] });
      const skipped = res.skipped?.length ?? 0;
      if (skipped > 0) {
        toast.warning(`Обновлено ${res.updated} из ${res.total}. Пропущено: ${skipped}`);
      } else {
        toast.success(`Обновлено задач: ${res.updated}`);
      }
    },
    onError: (err: Error) => toast.error(`Массовое изменение статуса не удалось: ${err.message}`),
  });
}

/** Bulk field update with server-side whitelist. */
export function useBulkUpdateCrmTask() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      taskIds: string[];
      patch: CrmTaskUpdatePatch;
      requestId?: string;
    }): Promise<BulkResult> => {
      const { data, error } = await (supabase as any).rpc("crm_task_bulk_update", {
        _task_ids: args.taskIds,
        _patch: args.patch,
        _request_id: args.requestId ?? null,
      });
      if (error) throw error;
      return data as BulkResult;
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ["crm-tasks"] });
      qc.invalidateQueries({ queryKey: ["crm-deal-task-summary"] });
      toast.success(`Обновлено задач: ${res.updated}`);
    },
    onError: (err: Error) => toast.error(`Массовое редактирование не удалось: ${err.message}`),
  });
}

