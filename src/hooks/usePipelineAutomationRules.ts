import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export type PipelineAutomationStatus = "draft" | "active" | "paused" | "archived";

export type PipelineAutomationConditionField =
  | "status"
  | "currency"
  | "is_trial"
  | "product_id"
  | "tariff_id"
  | "responsible_user_id"
  | "customer_email"
  | "paid_amount"
  | "final_price";

export type PipelineAutomationConditionOperator =
  | "eq"
  | "neq"
  | "contains"
  | "not_contains"
  | "is_empty"
  | "is_not_empty"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

export interface PipelineAutomationCondition {
  field: PipelineAutomationConditionField;
  operator: PipelineAutomationConditionOperator;
  value?: string | number | boolean;
  not?: boolean;
}

export interface PipelineAutomationConditions {
  logic: "and" | "or";
  items: PipelineAutomationCondition[];
}

export interface PipelineAutomationRule {
  id: string;
  logical_id: string;
  version: number;
  pipeline_id: string;
  stage_id: string;
  name: string;
  status: PipelineAutomationStatus;
  action_type: "create_task" | "send_email" | "send_telegram";
  task_type_id: string | null;
  title_template: string | null;
  description_template: string | null;
  assignee_strategy: "deal_owner" | "fixed_user";
  assignee_user_id: string | null;
  due_offset_minutes: number;
  reminder_offset_minutes: number | null;
  delay_minutes: number;
  require_same_stage: boolean;
  timezone: string;
  quiet_hours_start: string | null;
  quiet_hours_end: string | null;
  email_template_id: string | null;
  email_account_id: string | null;
  email_subject_template: string | null;
  email_html_template: string | null;
  email_text_template: string | null;
  recipient_strategy: "customer_email";
  telegram_message_template: string | null;
  fallback_action_type: "send_email" | "send_telegram" | null;
  fallback_email_template_id: string | null;
  fallback_email_account_id: string | null;
  fallback_email_subject_template: string | null;
  fallback_email_html_template: string | null;
  fallback_email_text_template: string | null;
  fallback_telegram_message_template: string | null;
  conditions: PipelineAutomationConditions | Record<string, never>;
  created_at: string;
  updated_at: string;
}

export interface CreatePipelineAutomationRule {
  pipeline_id: string;
  stage_id: string;
  name: string;
  action_type: "create_task" | "send_email" | "send_telegram";
  task_type_id?: string | null;
  title_template?: string | null;
  description_template?: string | null;
  assignee_strategy: "deal_owner" | "fixed_user";
  assignee_user_id?: string | null;
  due_offset_minutes: number;
  reminder_offset_minutes?: number | null;
  delay_minutes: number;
  require_same_stage: boolean;
  timezone: string;
  quiet_hours_start?: string | null;
  quiet_hours_end?: string | null;
  email_template_id?: string | null;
  email_account_id?: string | null;
  email_subject_template?: string | null;
  email_html_template?: string | null;
  email_text_template?: string | null;
  recipient_strategy?: "customer_email";
  telegram_message_template?: string | null;
  fallback_action_type?: "send_email" | "send_telegram" | null;
  fallback_email_template_id?: string | null;
  fallback_email_account_id?: string | null;
  fallback_email_subject_template?: string | null;
  fallback_email_html_template?: string | null;
  fallback_email_text_template?: string | null;
  fallback_telegram_message_template?: string | null;
  conditions?: PipelineAutomationConditions | Record<string, never>;
}

export interface PipelineEmailTemplate {
  id: string;
  name: string;
  subject: string;
  body_html: string;
  variables: unknown;
}

export type PipelineAutomationJobStatus =
  | "pending"
  | "running"
  | "succeeded"
  | "skipped"
  | "failed"
  | "dead";

export interface PipelineAutomationJob {
  id: string;
  rule_id: string;
  deal_id: string;
  status: PipelineAutomationJobStatus;
  attempt_count: number;
  available_at: string;
  result: Record<string, unknown> | null;
  last_error: string | null;
  created_at: string;
  finished_at: string | null;
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

export function usePipelineEmailTemplates() {
  return useQuery({
    queryKey: ["crm-pipeline-email-templates"],
    queryFn: async (): Promise<PipelineEmailTemplate[]> => {
      const { data, error } = await supabase
        .from("email_templates")
        .select("id,name,subject,body_html,variables")
        .eq("is_active", true)
        .order("name");
      if (error) throw error;
      const supportedVariables = new Set([
        "deal_id",
        "deal_number",
        "customer_email",
        "customer_name",
        "orderId",
        "email",
        "name",
        "appName",
      ]);
      return (data ?? []).filter((template) => {
        if (!Array.isArray(template.variables)) return true;
        return template.variables.every(
          (variable) => typeof variable === "string" && supportedVariables.has(variable),
        );
      });
    },
    staleTime: 60_000,
  });
}

export function usePipelineAutomationJobs(ruleIds: string[]) {
  return useQuery({
    queryKey: ["crm-pipeline-automation-jobs", [...ruleIds].sort().join(",")],
    enabled: ruleIds.length > 0,
    queryFn: async (): Promise<PipelineAutomationJob[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from("crm_pipeline_automation_jobs")
        .select("id,rule_id,deal_id,status,attempt_count,available_at,result,last_error,created_at,finished_at")
        .in("rule_id", ruleIds)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return (data ?? []) as PipelineAutomationJob[];
    },
    refetchInterval: 30_000,
    staleTime: 15_000,
  });
}

export function useRetryPipelineAutomationJob() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (jobId: string) => {
      const { error } = await supabase.rpc("crm_pipeline_automation_retry_job" as never, {
        _job_id: jobId,
      } as never);
      if (error) throw error;
      return jobId;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["crm-pipeline-automation-jobs"] });
      toast.success("Запуск поставлен в очередь повторно");
    },
    onError: (error: Error) => toast.error(error.message || "Не удалось повторить запуск"),
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
          task_type_id: payload.action_type === "create_task" ? payload.task_type_id : null,
          title_template:
            payload.action_type === "create_task" ? payload.title_template?.trim() : null,
          description_template: payload.description_template?.trim() || null,
          assignee_user_id:
            payload.assignee_strategy === "fixed_user" ? payload.assignee_user_id : null,
          reminder_offset_minutes: payload.reminder_offset_minutes ?? null,
          status: "draft",
          trigger_type: "deal_entered_stage",
          action_type: payload.action_type,
          email_template_id:
            payload.action_type === "send_email" ? payload.email_template_id : null,
          email_account_id:
            payload.action_type === "send_email" ? payload.email_account_id : null,
          email_subject_template:
            payload.action_type === "send_email"
              ? payload.email_subject_template?.trim()
              : null,
          email_html_template:
            payload.action_type === "send_email" ? payload.email_html_template?.trim() : null,
          email_text_template:
            payload.action_type === "send_email"
              ? payload.email_text_template?.trim() || null
              : null,
          telegram_message_template:
            payload.action_type === "send_telegram"
              ? payload.telegram_message_template?.trim()
              : null,
          fallback_action_type: payload.fallback_action_type ?? null,
          fallback_email_template_id:
            payload.fallback_action_type === "send_email"
              ? payload.fallback_email_template_id
              : null,
          fallback_email_account_id:
            payload.fallback_action_type === "send_email"
              ? payload.fallback_email_account_id
              : null,
          fallback_email_subject_template:
            payload.fallback_action_type === "send_email"
              ? payload.fallback_email_subject_template?.trim()
              : null,
          fallback_email_html_template:
            payload.fallback_action_type === "send_email"
              ? payload.fallback_email_html_template?.trim()
              : null,
          fallback_email_text_template:
            payload.fallback_action_type === "send_email"
              ? payload.fallback_email_text_template?.trim() || null
              : null,
          fallback_telegram_message_template:
            payload.fallback_action_type === "send_telegram"
              ? payload.fallback_telegram_message_template?.trim()
              : null,
          conditions: payload.conditions ?? {},
          recipient_strategy: "customer_email",
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
