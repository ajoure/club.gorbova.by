import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CirclePause,
  Clock3,
  History,
  Info,
  Loader2,
  Mail,
  MessageCircle,
  Plus,
  RotateCcw,
  Sparkles,
  TimerReset,
  UserRound,
  Workflow,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  CRM_AUTOMATION_TRIGGER_CATALOG,
  CRM_AUTOMATION_TRIGGER_CATEGORY_LABELS,
} from "@/lib/crmAutomationTriggerCatalog";
import { CrmPipeline, CrmPipelineStage } from "@/services/pipelineService";
import { useCrmTaskTypes } from "@/hooks/useCrmTasks";
import { useStaffOptions } from "@/hooks/useStaffOptions";
import {
  PipelineAutomationCondition,
  PipelineAutomationConditionField,
  PipelineAutomationConditionOperator,
  PipelineAutomationRule,
  useCreatePipelineAutomationRule,
  usePipelineAutomationJobs,
  usePipelineAutomationRules,
  usePipelineEmailTemplates,
  useRetryPipelineAutomationJob,
  useSetPipelineAutomationStatus,
} from "@/hooks/usePipelineAutomationRules";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pipeline: CrmPipeline | null;
  stages: CrmPipelineStage[];
  canEdit: boolean;
}

const OWNER = "__deal_owner__";

const CONDITION_FIELDS: Array<{ value: PipelineAutomationConditionField; label: string }> = [
  { value: "status", label: "Статус сделки" },
  { value: "currency", label: "Валюта" },
  { value: "is_trial", label: "Пробная сделка" },
  { value: "product_id", label: "Продукт" },
  { value: "tariff_id", label: "Тариф" },
  { value: "responsible_user_id", label: "Ответственный" },
  { value: "customer_email", label: "Email клиента" },
  { value: "paid_amount", label: "Оплаченная сумма" },
  { value: "final_price", label: "Итоговая сумма" },
];

const CONDITION_OPERATORS: Array<{
  value: PipelineAutomationConditionOperator;
  label: string;
}> = [
  { value: "eq", label: "равно" },
  { value: "neq", label: "не равно" },
  { value: "contains", label: "содержит" },
  { value: "not_contains", label: "не содержит" },
  { value: "is_empty", label: "не заполнено" },
  { value: "is_not_empty", label: "заполнено" },
  { value: "gt", label: "больше" },
  { value: "gte", label: "не меньше" },
  { value: "lt", label: "меньше" },
  { value: "lte", label: "не больше" },
];

function operatorsForField(field: PipelineAutomationConditionField) {
  if (field === "paid_amount" || field === "final_price") {
    return CONDITION_OPERATORS.filter(({ value }) =>
      ["eq", "neq", "is_empty", "is_not_empty", "gt", "gte", "lt", "lte"].includes(value)
    );
  }
  if (["status", "currency", "customer_email"].includes(field)) {
    return CONDITION_OPERATORS.filter(({ value }) =>
      ["eq", "neq", "contains", "not_contains", "is_empty", "is_not_empty"].includes(value)
    );
  }
  return CONDITION_OPERATORS.filter(({ value }) =>
    ["eq", "neq", "is_empty", "is_not_empty"].includes(value)
  );
}

function statusLabel(status: PipelineAutomationRule["status"]) {
  if (status === "active") return "Работает";
  if (status === "paused") return "Пауза";
  return "Черновик";
}

function TriggerCatalogPicker() {
  const categories = ["deal", "field", "payment", "communication", "calendar", "system"] as const;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label className="text-[11px]">Триггер</Label>
        <TooltipProvider delayDuration={180}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button type="button" className="text-muted-foreground hover:text-primary" aria-label="О триггерах">
                <Info className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-56 border-white/20 bg-background/90 text-[10px] leading-4 backdrop-blur-xl">
              Доступны только триггеры с готовым событием и worker-контрактом. Остальные показаны как план развития, чтобы не сохранить неработающее правило.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <Popover>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-9 w-full items-center justify-between rounded-xl border border-border/35 bg-background/45 px-3 text-left text-xs transition hover:border-primary/25 hover:bg-primary/[0.035]"
          >
            <span>После входа сделки в стадию</span>
            <ArrowRight className="h-3.5 w-3.5 text-primary" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[360px] border-white/25 bg-background/85 p-2.5 shadow-[0_18px_50px_rgba(15,23,42,0.14)] backdrop-blur-3xl"
        >
          <p className="px-1.5 pb-2 text-[10px] font-semibold text-foreground/75">Выберите момент запуска</p>
          <div className="max-h-[390px] space-y-3 overflow-y-auto pr-1">
            {categories.map((category) => {
              const triggers = CRM_AUTOMATION_TRIGGER_CATALOG.filter(
                (trigger) => trigger.category === category,
              );
              return (
                <div key={category}>
                  <p className="px-1.5 pb-1 text-[9px] font-bold uppercase tracking-[0.08em] text-muted-foreground">
                    {CRM_AUTOMATION_TRIGGER_CATEGORY_LABELS[category]}
                  </p>
                  <div className="space-y-1">
                    {triggers.map((trigger) => (
                      <TooltipProvider key={trigger.id} delayDuration={180}>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <div
                              className={cn(
                                "flex rounded-xl border px-2.5 py-2 transition",
                                trigger.availability === "available"
                                  ? "cursor-default border-primary/20 bg-primary/[0.055]"
                                  : "border-border/20 bg-background/30 opacity-65",
                              )}
                            >
                              <div className="min-w-0">
                                <p className="text-[11px] font-medium">{trigger.title}</p>
                                <p className="mt-0.5 line-clamp-2 text-[9px] leading-3.5 text-muted-foreground">
                                  {trigger.description}
                                </p>
                              </div>
                              <Badge
                                variant="outline"
                                className={cn(
                                  "ml-auto h-5 shrink-0 rounded-full px-1.5 text-[8px]",
                                  trigger.availability === "available"
                                    ? "border-emerald-500/20 bg-emerald-500/8 text-emerald-600"
                                    : "border-border/30 text-muted-foreground",
                                )}
                              >
                                {trigger.availability === "available" ? "доступно" : "скоро"}
                              </Badge>
                            </div>
                          </TooltipTrigger>
                          <TooltipContent className="max-w-64 border-white/20 bg-background/90 text-[10px] leading-4 backdrop-blur-xl">
                            {trigger.description}
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

function RuleCard({
  rule,
  pipelineId,
  canEdit,
}: {
  rule: PipelineAutomationRule;
  pipelineId: string;
  canEdit: boolean;
}) {
  const setStatus = useSetPipelineAutomationStatus();
  return (
    <div
      className={cn(
        "group rounded-2xl border border-white/35 bg-white/55 p-3 shadow-[0_10px_30px_rgba(15,23,42,0.05)]",
        "backdrop-blur-xl transition-all hover:-translate-y-0.5 hover:border-primary/20 hover:shadow-[0_14px_36px_rgba(59,130,246,0.09)]",
        "dark:border-white/10 dark:bg-slate-950/45",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <span
            className={cn(
              "mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-xl",
              rule.status === "active"
                ? "bg-emerald-500/12 text-emerald-600"
                : "bg-primary/10 text-primary",
            )}
          >
            {rule.action_type === "send_email" ? (
              <Mail className="h-3.5 w-3.5" />
            ) : rule.action_type === "send_telegram" ? (
              <MessageCircle className="h-3.5 w-3.5" />
            ) : rule.status === "active" ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <Workflow className="h-3.5 w-3.5" />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground/90">{rule.name}</p>
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
              {rule.action_type === "send_email"
                ? rule.email_subject_template
                : rule.action_type === "send_telegram"
                  ? rule.telegram_message_template
                  : rule.title_template}
            </p>
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "h-5 shrink-0 rounded-full px-2 text-[9px] font-medium",
            rule.status === "active"
              ? "border-emerald-500/20 bg-emerald-500/8 text-emerald-600"
              : "border-border/40 bg-background/30 text-muted-foreground",
          )}
        >
          {statusLabel(rule.status)}
        </Badge>
      </div>
      <div className="mt-3 flex items-center gap-3 text-[10px] text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <ArrowRight className="h-3 w-3" /> после входа
        </span>
        {rule.delay_minutes > 0 && (
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3 w-3" /> через {rule.delay_minutes} мин
          </span>
        )}
        {rule.action_type === "create_task" ? (
          <>
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3 w-3" /> {rule.due_offset_minutes / 60} ч
            </span>
            <span className="inline-flex items-center gap-1">
              <UserRound className="h-3 w-3" />
              {rule.assignee_strategy === "deal_owner" ? "ответственный" : "сотрудник"}
            </span>
          </>
        ) : rule.action_type === "send_email" ? (
          <span className="inline-flex items-center gap-1">
            <Mail className="h-3 w-3" /> email клиента
          </span>
        ) : (
          <span className="inline-flex items-center gap-1">
            <MessageCircle className="h-3 w-3" /> Telegram клиента
          </span>
        )}
        {rule.fallback_action_type && (
          <span className="inline-flex items-center gap-1 text-amber-600">
            <RotateCcw className="h-3 w-3" />
            резерв: {rule.fallback_action_type === "send_email" ? "Email" : "Telegram"}
          </span>
        )}
        {"items" in rule.conditions && rule.conditions.items.length > 0 && (
          <span className="inline-flex items-center gap-1 text-violet-600">
            <Workflow className="h-3 w-3" /> условий: {rule.conditions.items.length}
          </span>
        )}
        {rule.no_branch_task_type_id && (
          <span className="inline-flex items-center gap-1 text-sky-600">
            <ArrowRight className="h-3 w-3" /> если нет — задача
          </span>
        )}
        {rule.error_branch_task_type_id && (
          <span className="inline-flex items-center gap-1 text-rose-600">
            <XCircle className="h-3 w-3" /> ошибка — задача
          </span>
        )}
      </div>
      {canEdit && (
        <div className="mt-3 flex items-center gap-1 border-t border-border/25 pt-2">
          {rule.status === "draft" && (
            <Button
              size="sm"
              className="h-6 rounded-lg px-2 text-[10px]"
              disabled={setStatus.isPending}
              onClick={() =>
                setStatus.mutate({ id: rule.id, pipelineId, status: "active" })
              }
            >
              Опубликовать
            </Button>
          )}
          {rule.status === "active" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 rounded-lg px-2 text-[10px]"
              onClick={() =>
                setStatus.mutate({ id: rule.id, pipelineId, status: "paused" })
              }
            >
              <CirclePause className="mr-1 h-3 w-3" /> Пауза
            </Button>
          )}
          {rule.status === "paused" && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 rounded-lg px-2 text-[10px]"
              onClick={() =>
                setStatus.mutate({ id: rule.id, pipelineId, status: "active" })
              }
            >
              Возобновить
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto h-6 rounded-lg px-2 text-[10px] text-muted-foreground"
            onClick={() =>
              setStatus.mutate({ id: rule.id, pipelineId, status: "archived" })
            }
          >
            <Archive className="mr-1 h-3 w-3" /> Архив
          </Button>
        </div>
      )}
    </div>
  );
}

export function PipelineAutomationSheet({
  open,
  onOpenChange,
  pipeline,
  stages,
  canEdit,
}: Props) {
  const { data: rules = [], isLoading } = usePipelineAutomationRules(pipeline?.id ?? null);
  const { data: jobs = [] } = usePipelineAutomationJobs(rules.map((rule) => rule.id));
  const retryJob = useRetryPipelineAutomationJob();
  const { data: taskTypes = [] } = useCrmTaskTypes();
  const { data: emailTemplates = [] } = usePipelineEmailTemplates();
  const { data: staff = [] } = useStaffOptions();
  const createRule = useCreatePipelineAutomationRule();
  const [selectedStageId, setSelectedStageId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState("Связаться с клиентом");
  const [title, setTitle] = useState("Связаться по сделке {{deal_number}}");
  const [description, setDescription] = useState("");
  const [taskTypeId, setTaskTypeId] = useState("");
  const [assignee, setAssignee] = useState(OWNER);
  const [dueHours, setDueHours] = useState(24);
  const [actionType, setActionType] = useState<
    "create_task" | "send_email" | "send_telegram"
  >("create_task");
  const [emailTemplateId, setEmailTemplateId] = useState("");
  const [telegramMessage, setTelegramMessage] = useState(
    "Здравствуйте, {{customer_name}}! Пишем Вам по сделке {{deal_number}}.",
  );
  const [fallbackEnabled, setFallbackEnabled] = useState(false);
  const [fallbackEmailTemplateId, setFallbackEmailTemplateId] = useState("");
  const [fallbackTelegramMessage, setFallbackTelegramMessage] = useState(
    "Здравствуйте, {{customer_name}}! Не удалось связаться по email. Пишем Вам по сделке {{deal_number}}.",
  );
  const [delayMinutes, setDelayMinutes] = useState(0);
  const [requireSameStage, setRequireSameStage] = useState(true);
  const [timezone, setTimezone] = useState("Europe/Warsaw");
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietHoursStart, setQuietHoursStart] = useState("22:00");
  const [quietHoursEnd, setQuietHoursEnd] = useState("08:00");
  const [conditionLogic, setConditionLogic] = useState<"and" | "or">("and");
  const [conditions, setConditions] = useState<PipelineAutomationCondition[]>([]);
  const [noBranchEnabled, setNoBranchEnabled] = useState(false);
  const [noBranchTaskTypeId, setNoBranchTaskTypeId] = useState("");
  const [noBranchTitle, setNoBranchTitle] = useState("Проверить сделку {{deal_number}}");
  const [noBranchDescription, setNoBranchDescription] = useState("");
  const [noBranchAssignee, setNoBranchAssignee] = useState(OWNER);
  const [noBranchDueHours, setNoBranchDueHours] = useState(24);
  const [errorBranchEnabled, setErrorBranchEnabled] = useState(false);
  const [errorBranchTaskTypeId, setErrorBranchTaskTypeId] = useState("");
  const [errorBranchTitle, setErrorBranchTitle] = useState("Проверить ошибку автоматизации {{deal_number}}");
  const [errorBranchDescription, setErrorBranchDescription] = useState("");
  const [errorBranchAssignee, setErrorBranchAssignee] = useState(OWNER);
  const [errorBranchDueHours, setErrorBranchDueHours] = useState(24);

  useEffect(() => {
    if (!taskTypeId && taskTypes[0]?.id) setTaskTypeId(taskTypes[0].id);
  }, [taskTypeId, taskTypes]);
  useEffect(() => {
    if (!noBranchTaskTypeId && taskTypes[0]?.id) setNoBranchTaskTypeId(taskTypes[0].id);
  }, [noBranchTaskTypeId, taskTypes]);
  useEffect(() => {
    if (!errorBranchTaskTypeId && taskTypes[0]?.id) setErrorBranchTaskTypeId(taskTypes[0].id);
  }, [errorBranchTaskTypeId, taskTypes]);
  useEffect(() => {
    if (!emailTemplateId && emailTemplates[0]?.id) setEmailTemplateId(emailTemplates[0].id);
  }, [emailTemplateId, emailTemplates]);
  useEffect(() => {
    if (!fallbackEmailTemplateId && emailTemplates[0]?.id) {
      setFallbackEmailTemplateId(emailTemplates[0].id);
    }
  }, [fallbackEmailTemplateId, emailTemplates]);

  const rulesByStage = useMemo(() => {
    const grouped = new Map<string, PipelineAutomationRule[]>();
    stages.forEach((stage) => grouped.set(stage.id, []));
    rules.forEach((rule) => grouped.get(rule.stage_id)?.push(rule));
    return grouped;
  }, [rules, stages]);

  const resetEditor = () => {
    setEditing(false);
    setSelectedStageId(null);
    setName("Связаться с клиентом");
    setTitle("Связаться по сделке {{deal_number}}");
    setDescription("");
    setAssignee(OWNER);
    setDueHours(24);
    setActionType("create_task");
    setTelegramMessage(
      "Здравствуйте, {{customer_name}}! Пишем Вам по сделке {{deal_number}}.",
    );
    setFallbackEnabled(false);
    setFallbackTelegramMessage(
      "Здравствуйте, {{customer_name}}! Не удалось связаться по email. Пишем Вам по сделке {{deal_number}}.",
    );
    setDelayMinutes(0);
    setRequireSameStage(true);
    setTimezone("Europe/Warsaw");
    setQuietHoursEnabled(false);
    setQuietHoursStart("22:00");
    setQuietHoursEnd("08:00");
    setConditionLogic("and");
    setConditions([]);
    setNoBranchEnabled(false);
    setNoBranchTitle("Проверить сделку {{deal_number}}");
    setNoBranchDescription("");
    setNoBranchAssignee(OWNER);
    setNoBranchDueHours(24);
    setErrorBranchEnabled(false);
    setErrorBranchTitle("Проверить ошибку автоматизации {{deal_number}}");
    setErrorBranchDescription("");
    setErrorBranchAssignee(OWNER);
    setErrorBranchDueHours(24);
  };

  const submit = () => {
    const emailTemplate = emailTemplates.find((template) => template.id === emailTemplateId);
    const fallbackEmailTemplate = emailTemplates.find(
      (template) => template.id === fallbackEmailTemplateId,
    );
    if (!pipeline || !selectedStageId || !name.trim()) return;
    if (actionType === "create_task" && (!taskTypeId || !title.trim())) return;
    if (actionType === "send_email" && !emailTemplate) return;
    if (actionType === "send_telegram" && !telegramMessage.trim()) return;
    if (fallbackEnabled && actionType === "send_telegram" && !fallbackEmailTemplate) return;
    if (fallbackEnabled && actionType === "send_email" && !fallbackTelegramMessage.trim()) return;
    if (
      conditions.some(
        (condition) =>
          !["is_empty", "is_not_empty"].includes(condition.operator) &&
          String(condition.value ?? "").trim() === "",
      )
    ) return;
    if (noBranchEnabled && (!noBranchTaskTypeId || !noBranchTitle.trim())) return;
    if (errorBranchEnabled && (!errorBranchTaskTypeId || !errorBranchTitle.trim())) return;
    const normalizedConditions = conditions.map((condition) => ({
      ...condition,
      value:
        ["gt", "gte", "lt", "lte"].includes(condition.operator)
          ? Number(condition.value)
          : condition.value,
    }));
    createRule.mutate(
      {
        pipeline_id: pipeline.id,
        stage_id: selectedStageId,
        name,
        action_type: actionType,
        task_type_id: actionType === "create_task" ? taskTypeId : null,
        title_template: actionType === "create_task" ? title : null,
        description_template: actionType === "create_task" ? description : null,
        assignee_strategy: assignee === OWNER ? "deal_owner" : "fixed_user",
        assignee_user_id: assignee === OWNER ? null : assignee,
        due_offset_minutes: dueHours * 60,
        reminder_offset_minutes: null,
        delay_minutes: delayMinutes,
        require_same_stage: requireSameStage,
        timezone,
        quiet_hours_start: quietHoursEnabled ? quietHoursStart : null,
        quiet_hours_end: quietHoursEnabled ? quietHoursEnd : null,
        email_template_id: actionType === "send_email" ? emailTemplate!.id : null,
        email_account_id: null,
        email_subject_template: actionType === "send_email" ? emailTemplate!.subject : null,
        email_html_template: actionType === "send_email" ? emailTemplate!.body_html : null,
        email_text_template: null,
        recipient_strategy: "customer_email",
        telegram_message_template:
          actionType === "send_telegram" ? telegramMessage : null,
        fallback_action_type:
          fallbackEnabled && actionType === "send_email"
            ? "send_telegram"
            : fallbackEnabled && actionType === "send_telegram"
              ? "send_email"
              : null,
        fallback_email_template_id:
          fallbackEnabled && actionType === "send_telegram"
            ? fallbackEmailTemplate!.id
            : null,
        fallback_email_account_id: null,
        fallback_email_subject_template:
          fallbackEnabled && actionType === "send_telegram"
            ? fallbackEmailTemplate!.subject
            : null,
        fallback_email_html_template:
          fallbackEnabled && actionType === "send_telegram"
            ? fallbackEmailTemplate!.body_html
            : null,
        fallback_email_text_template: null,
        fallback_telegram_message_template:
          fallbackEnabled && actionType === "send_email"
            ? fallbackTelegramMessage
            : null,
        conditions:
          normalizedConditions.length > 0
            ? { logic: conditionLogic, items: normalizedConditions }
            : {},
        no_branch_task_type_id: noBranchEnabled ? noBranchTaskTypeId : null,
        no_branch_title_template: noBranchEnabled ? noBranchTitle : null,
        no_branch_description_template: noBranchEnabled ? noBranchDescription : null,
        no_branch_assignee_strategy:
          noBranchEnabled && noBranchAssignee !== OWNER ? "fixed_user" : "deal_owner",
        no_branch_assignee_user_id:
          noBranchEnabled && noBranchAssignee !== OWNER ? noBranchAssignee : null,
        no_branch_due_offset_minutes: noBranchEnabled ? noBranchDueHours * 60 : null,
        error_branch_task_type_id: errorBranchEnabled ? errorBranchTaskTypeId : null,
        error_branch_title_template: errorBranchEnabled ? errorBranchTitle : null,
        error_branch_description_template: errorBranchEnabled ? errorBranchDescription : null,
        error_branch_assignee_strategy:
          errorBranchEnabled && errorBranchAssignee !== OWNER ? "fixed_user" : "deal_owner",
        error_branch_assignee_user_id:
          errorBranchEnabled && errorBranchAssignee !== OWNER ? errorBranchAssignee : null,
        error_branch_due_offset_minutes: errorBranchEnabled ? errorBranchDueHours * 60 : null,
      },
      { onSuccess: resetEditor },
    );
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-screen border-l border-white/30 bg-background/82 p-0 backdrop-blur-3xl sm:max-w-[92vw]"
      >
        <SheetHeader className="border-b border-border/25 bg-background/45 px-5 py-4 text-left">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-primary/20 to-violet-500/10 text-primary ring-1 ring-primary/15">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <SheetTitle className="text-base">Автоматизация · {pipeline?.name}</SheetTitle>
              <SheetDescription className="mt-0.5 text-xs">
                Действия запускаются по ходу движения сделки
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="h-[calc(100vh-77px)] overflow-hidden">
          <ScrollArea className="h-full">
            <div className="min-w-max p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-foreground/85">Стадии и действия</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Добавьте первое действие под нужной стадией
                  </p>
                </div>
                <Badge variant="outline" className="rounded-full bg-background/45 text-[10px]">
                  {rules.filter((rule) => rule.status === "active").length} активных
                </Badge>
              </div>

              {jobs.length > 0 && (
                <div className="mb-4 flex max-w-[calc(92vw-40px)] items-center gap-2 overflow-x-auto rounded-2xl border border-white/35 bg-white/35 p-2.5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/30">
                  <div className="flex shrink-0 items-center gap-1.5 px-1 text-[10px] font-semibold text-foreground/70">
                    <History className="h-3.5 w-3.5" /> Последние запуски
                  </div>
                  {jobs.slice(0, 8).map((job) => {
                    const rule = rules.find((item) => item.id === job.rule_id);
                    const failed = job.status === "failed" || job.status === "dead";
                    const waiting = job.status === "pending" || job.status === "running";
                    return (
                      <div
                        key={job.id}
                        className="flex min-w-[170px] shrink-0 items-center gap-2 rounded-xl border border-border/25 bg-background/50 px-2.5 py-2"
                        title={job.last_error ?? undefined}
                      >
                        <span
                          className={cn(
                            "grid h-6 w-6 shrink-0 place-items-center rounded-lg",
                            failed
                              ? "bg-rose-500/10 text-rose-600"
                              : waiting
                                ? "bg-amber-500/10 text-amber-600"
                                : job.status === "skipped"
                                  ? "bg-slate-500/10 text-slate-500"
                                  : "bg-emerald-500/10 text-emerald-600",
                          )}
                        >
                          {failed ? (
                            <XCircle className="h-3.5 w-3.5" />
                          ) : waiting ? (
                            <TimerReset className="h-3.5 w-3.5" />
                          ) : (
                            <CheckCircle2 className="h-3.5 w-3.5" />
                          )}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-[10px] font-medium">{rule?.name ?? "Автоматизация"}</p>
                          <p className="mt-0.5 text-[9px] text-muted-foreground">
                            {job.status === "succeeded"
                              ? job.result?.fallback_used === true
                                ? "Выполнено через резерв"
                                : "Выполнено"
                              : job.status === "skipped"
                                ? job.result?.skip_reason === "conditions_not_met"
                                  ? "Пропущено: условия не совпали"
                                  : "Пропущено: сделка ушла"
                                : job.status === "running"
                                  ? "Выполняется"
                                  : job.status === "pending"
                                    ? "Ожидает запуска"
                                    : job.status === "dead"
                                      ? job.result?.error_branch_task_id
                                        ? "Ошибка: создана задача"
                                        : "Остановлено после ошибок"
                                      : "Повтор после ошибки"}
                          </p>
                        </div>
                        {canEdit && failed && (
                          <button
                            type="button"
                            className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-lg text-muted-foreground transition hover:bg-primary/10 hover:text-primary disabled:opacity-50"
                            title="Повторить запуск"
                            disabled={retryJob.isPending}
                            onClick={() => retryJob.mutate(job.id)}
                          >
                            <RotateCcw className="h-3 w-3" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex gap-3">
                {stages.map((stage) => (
                  <section
                    key={stage.id}
                    className="w-[286px] shrink-0 overflow-hidden rounded-[22px] border border-white/35 bg-white/35 shadow-[0_18px_50px_rgba(15,23,42,0.05)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/30"
                  >
                    <div className="h-1" style={{ backgroundColor: stage.color }} />
                    <div className="flex items-center justify-between border-b border-border/20 px-3.5 py-3">
                      <div className="min-w-0">
                        <h3 className="truncate text-[11px] font-bold uppercase tracking-[0.08em] text-foreground/75">
                          {stage.name}
                        </h3>
                        <p className="mt-0.5 text-[10px] text-muted-foreground">
                          {rulesByStage.get(stage.id)?.length ?? 0} действий
                        </p>
                      </div>
                      {canEdit && (
                        <button
                          className="grid h-7 w-7 place-items-center rounded-full border border-border/30 bg-background/45 text-muted-foreground transition hover:border-primary/25 hover:bg-primary/8 hover:text-primary"
                          title="Добавить действие"
                          onClick={() => {
                            setSelectedStageId(stage.id);
                            setEditing(true);
                          }}
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <div className="min-h-[420px] space-y-2.5 p-3">
                      {isLoading ? (
                        <div className="flex items-center gap-2 p-3 text-[11px] text-muted-foreground">
                          <Loader2 className="h-3 w-3 animate-spin" /> Загрузка
                        </div>
                      ) : rulesByStage.get(stage.id)?.length ? (
                        rulesByStage
                          .get(stage.id)!
                          .map((rule) => (
                            <RuleCard
                              key={rule.id}
                              rule={rule}
                              pipelineId={pipeline!.id}
                              canEdit={canEdit}
                            />
                          ))
                      ) : (
                        <button
                          disabled={!canEdit}
                          className="flex w-full items-center justify-center gap-1.5 rounded-2xl border border-dashed border-border/35 bg-background/20 px-3 py-5 text-[11px] text-muted-foreground/70 transition hover:border-primary/25 hover:bg-primary/[0.035] hover:text-primary disabled:pointer-events-none"
                          onClick={() => {
                            setSelectedStageId(stage.id);
                            setEditing(true);
                          }}
                        >
                          <Plus className="h-3 w-3" /> Добавить триггер
                        </button>
                      )}
                    </div>
                  </section>
                ))}
              </div>
            </div>
            <ScrollBar orientation="horizontal" />
          </ScrollArea>
        </div>

        {editing && (
          <div className="absolute inset-y-0 right-0 z-20 w-full border-l border-white/30 bg-background/92 shadow-[-24px_0_70px_rgba(15,23,42,0.12)] backdrop-blur-3xl sm:w-[410px]">
            <div className="border-b border-border/25 px-5 py-4">
              <p className="text-sm font-semibold">
                {actionType === "create_task"
                  ? "Создать задачу"
                  : actionType === "send_email"
                    ? "Отправить Email"
                    : "Отправить Telegram"}
              </p>
              <p className="mt-1 text-[11px] text-muted-foreground">После перехода сделки в стадию</p>
            </div>
            <div className="space-y-4 overflow-y-auto p-5">
              <div className="space-y-1.5">
                <Label className="text-[11px]">Название правила</Label>
                <Input value={name} onChange={(event) => setName(event.target.value)} className="h-9 rounded-xl text-xs" />
              </div>
              <TriggerCatalogPicker />
              <div className="space-y-1.5">
                <Label className="text-[11px]">Действие</Label>
                <Select
                  value={actionType}
                  onValueChange={(
                    value: "create_task" | "send_email" | "send_telegram",
                  ) => setActionType(value)}
                >
                  <SelectTrigger className="h-9 rounded-xl text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="create_task">Создать задачу</SelectItem>
                    <SelectItem value="send_email">Отправить Email</SelectItem>
                    <SelectItem value="send_telegram">Отправить Telegram</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {actionType === "send_email" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Шаблон письма</Label>
                    <Select value={emailTemplateId} onValueChange={setEmailTemplateId}>
                      <SelectTrigger className="h-9 rounded-xl text-xs"><SelectValue placeholder="Выберите шаблон" /></SelectTrigger>
                      <SelectContent>
                        {emailTemplates.map((template) => (
                          <SelectItem key={template.id} value={template.id}>{template.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  {emailTemplates.find((template) => template.id === emailTemplateId) && (
                    <div className="rounded-xl border border-border/30 bg-background/35 p-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Тема</p>
                      <p className="mt-1 text-[11px] font-medium">
                        {emailTemplates.find((template) => template.id === emailTemplateId)?.subject}
                      </p>
                      <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                        Получатель: email из карточки сделки. Содержимое сохраняется в версии правила.
                      </p>
                    </div>
                  )}
                </>
              )}
              {actionType === "send_telegram" && (
                <div className="space-y-1.5">
                  <Label className="text-[11px]">Текст сообщения</Label>
                  <Textarea
                    value={telegramMessage}
                    onChange={(event) => setTelegramMessage(event.target.value)}
                    maxLength={4096}
                    className="min-h-28 rounded-xl text-xs"
                  />
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>
                      Доступно: {"{{customer_name}}"}, {"{{deal_number}}"}, {"{{customer_email}}"}
                    </span>
                    <span>{telegramMessage.length}/4096</span>
                  </div>
                  <p className="text-[10px] leading-4 text-muted-foreground">
                    Получатель определяется по пользователю сделки. Сообщение будет отражено в Contact Center.
                  </p>
                </div>
              )}
              {actionType !== "create_task" && (
                <>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3">
                    <Checkbox
                      checked={fallbackEnabled}
                      onCheckedChange={(checked) => setFallbackEnabled(checked === true)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-[11px] font-medium">Резервный канал</span>
                      <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                        После пяти неудачных попыток отправить через{" "}
                        {actionType === "send_email" ? "Telegram" : "Email"}
                      </span>
                    </span>
                  </label>
                  {fallbackEnabled && actionType === "send_telegram" && (
                    <div className="space-y-1.5">
                      <Label className="text-[11px]">Резервный шаблон Email</Label>
                      <Select
                        value={fallbackEmailTemplateId}
                        onValueChange={setFallbackEmailTemplateId}
                      >
                        <SelectTrigger className="h-9 rounded-xl text-xs">
                          <SelectValue placeholder="Выберите шаблон" />
                        </SelectTrigger>
                        <SelectContent>
                          {emailTemplates.map((template) => (
                            <SelectItem key={template.id} value={template.id}>
                              {template.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                  {fallbackEnabled && actionType === "send_email" && (
                    <div className="space-y-1.5">
                      <Label className="text-[11px]">Резервное сообщение Telegram</Label>
                      <Textarea
                        value={fallbackTelegramMessage}
                        onChange={(event) => setFallbackTelegramMessage(event.target.value)}
                        maxLength={4096}
                        className="min-h-24 rounded-xl text-xs"
                      />
                      <p className="text-right text-[10px] text-muted-foreground">
                        {fallbackTelegramMessage.length}/4096
                      </p>
                    </div>
                  )}
                </>
              )}
              {actionType === "create_task" && (
                <>
              <div className="space-y-1.5">
                <Label className="text-[11px]">Тип задачи</Label>
                <Select value={taskTypeId} onValueChange={setTaskTypeId}>
                  <SelectTrigger className="h-9 rounded-xl text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {taskTypes.map((type) => <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px]">Заголовок задачи</Label>
                <Input value={title} onChange={(event) => setTitle(event.target.value)} className="h-9 rounded-xl text-xs" />
                <p className="text-[10px] text-muted-foreground">Доступно: {"{{deal_number}}"}</p>
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px]">Описание</Label>
                <Textarea value={description} onChange={(event) => setDescription(event.target.value)} className="min-h-20 rounded-xl text-xs" />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px]">Исполнитель</Label>
                <Select value={assignee} onValueChange={setAssignee}>
                  <SelectTrigger className="h-9 rounded-xl text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value={OWNER}>Текущий ответственный сделки</SelectItem>
                    {staff.map((person) => <SelectItem key={person.user_id} value={person.user_id}>{person.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
                </>
              )}
              <div className="space-y-2 rounded-2xl border border-border/30 bg-background/30 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <p className="text-[11px] font-medium">Условия запуска</p>
                    <p className="text-[10px] text-muted-foreground">
                      Пусто — выполнять для всех сделок
                    </p>
                  </div>
                  {conditions.length > 1 && (
                    <Select
                      value={conditionLogic}
                      onValueChange={(value: "and" | "or") => setConditionLogic(value)}
                    >
                      <SelectTrigger className="h-7 w-24 rounded-lg text-[10px]">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="and">Все AND</SelectItem>
                        <SelectItem value="or">Любое OR</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
                {conditions.map((condition, index) => {
                  const needsValue = !["is_empty", "is_not_empty"].includes(
                    condition.operator,
                  );
                  return (
                    <div
                      key={`${index}-${condition.field}`}
                      className="space-y-2 rounded-xl border border-border/25 bg-background/45 p-2.5"
                    >
                      <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
                        <Select
                          value={condition.field}
                          onValueChange={(value: PipelineAutomationConditionField) =>
                            setConditions((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, field: value, operator: "eq" }
                                  : item
                              )
                            )}
                        >
                          <SelectTrigger className="h-8 rounded-lg text-[10px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CONDITION_FIELDS.map((field) => (
                              <SelectItem key={field.value} value={field.value}>
                                {field.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Select
                          value={condition.operator}
                          onValueChange={(value: PipelineAutomationConditionOperator) =>
                            setConditions((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, operator: value } : item
                              )
                            )}
                        >
                          <SelectTrigger className="h-8 rounded-lg text-[10px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {operatorsForField(condition.field).map((operator) => (
                              <SelectItem key={operator.value} value={operator.value}>
                                {operator.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <button
                          type="button"
                          className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600"
                          onClick={() =>
                            setConditions((current) =>
                              current.filter((_, itemIndex) => itemIndex !== index)
                            )}
                          title="Удалить условие"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {needsValue && (
                        <Input
                          type={
                            condition.field === "paid_amount" ||
                              condition.field === "final_price"
                              ? "number"
                              : "text"
                          }
                          value={String(condition.value ?? "")}
                          onChange={(event) =>
                            setConditions((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, value: event.target.value }
                                  : item
                              )
                            )}
                          placeholder="Значение"
                          className="h-8 rounded-lg text-[10px]"
                        />
                      )}
                      <label className="flex items-center gap-2 text-[10px] text-muted-foreground">
                        <Checkbox
                          checked={condition.not === true}
                          onCheckedChange={(checked) =>
                            setConditions((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, not: checked === true }
                                  : item
                              )
                            )}
                        />
                        Инвертировать результат (NOT)
                      </label>
                    </div>
                  );
                })}
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={conditions.length >= 10}
                  className="h-7 rounded-lg px-2 text-[10px]"
                  onClick={() =>
                    setConditions((current) => [
                      ...current,
                      { field: "status", operator: "eq", value: "" },
                    ])
                  }
                >
                  <Plus className="mr-1 h-3 w-3" /> Добавить условие
                </Button>
              </div>
              {conditions.length > 0 && (
                <div className="space-y-3 rounded-2xl border border-sky-500/20 bg-sky-500/[0.035] p-3">
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <Checkbox
                      checked={noBranchEnabled}
                      onCheckedChange={(checked) => setNoBranchEnabled(checked === true)}
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-[11px] font-medium">
                        Если условия не совпали — создать задачу
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                        Основное действие не запустится; задача попадёт в журнал этой ветки.
                      </span>
                    </span>
                  </label>
                  {noBranchEnabled && (
                    <div className="space-y-2.5 border-t border-sky-500/15 pt-3">
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Тип задачи ветки</Label>
                        <Select value={noBranchTaskTypeId} onValueChange={setNoBranchTaskTypeId}>
                          <SelectTrigger className="h-8 rounded-lg text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {taskTypes.map((type) => (
                              <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Заголовок задачи</Label>
                        <Input
                          value={noBranchTitle}
                          onChange={(event) => setNoBranchTitle(event.target.value)}
                          className="h-8 rounded-lg text-[10px]"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Описание</Label>
                        <Textarea
                          value={noBranchDescription}
                          onChange={(event) => setNoBranchDescription(event.target.value)}
                          className="min-h-16 rounded-lg text-[10px]"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1.5">
                          <Label className="text-[11px]">Исполнитель</Label>
                          <Select value={noBranchAssignee} onValueChange={setNoBranchAssignee}>
                            <SelectTrigger className="h-8 rounded-lg text-[10px]"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value={OWNER}>Ответственный</SelectItem>
                              {staff.map((person) => (
                                <SelectItem key={person.user_id} value={person.user_id}>
                                  {person.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-[11px]">Срок, часов</Label>
                          <Input
                            type="number"
                            min={0}
                            max={8760}
                            value={noBranchDueHours}
                            onChange={(event) => setNoBranchDueHours(Number(event.target.value))}
                            className="h-8 rounded-lg text-[10px]"
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
              <div className="space-y-3 rounded-2xl border border-rose-500/20 bg-rose-500/[0.03] p-3">
                <label className="flex cursor-pointer items-start gap-2.5">
                  <Checkbox
                    checked={errorBranchEnabled}
                    onCheckedChange={(checked) => setErrorBranchEnabled(checked === true)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-[11px] font-medium">
                      После окончательной ошибки — создать задачу
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                      Сработает только после пяти попыток и не сработает, если резервный канал доставил сообщение.
                    </span>
                  </span>
                </label>
                {errorBranchEnabled && (
                  <div className="space-y-2.5 border-t border-rose-500/15 pt-3">
                    <div className="space-y-1.5">
                      <Label className="text-[11px]">Тип задачи ветки</Label>
                      <Select value={errorBranchTaskTypeId} onValueChange={setErrorBranchTaskTypeId}>
                        <SelectTrigger className="h-8 rounded-lg text-[10px]"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {taskTypes.map((type) => (
                            <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px]">Заголовок задачи</Label>
                      <Input
                        value={errorBranchTitle}
                        onChange={(event) => setErrorBranchTitle(event.target.value)}
                        className="h-8 rounded-lg text-[10px]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px]">Описание</Label>
                      <Textarea
                        value={errorBranchDescription}
                        onChange={(event) => setErrorBranchDescription(event.target.value)}
                        className="min-h-16 rounded-lg text-[10px]"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Исполнитель</Label>
                        <Select value={errorBranchAssignee} onValueChange={setErrorBranchAssignee}>
                          <SelectTrigger className="h-8 rounded-lg text-[10px]"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value={OWNER}>Ответственный</SelectItem>
                            {staff.map((person) => (
                              <SelectItem key={person.user_id} value={person.user_id}>
                                {person.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Срок, часов</Label>
                        <Input
                          type="number"
                          min={0}
                          max={8760}
                          value={errorBranchDueHours}
                          onChange={(event) => setErrorBranchDueHours(Number(event.target.value))}
                          className="h-8 rounded-lg text-[10px]"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px]">Запустить через, минут</Label>
                <Input type="number" min={0} max={525600} value={delayMinutes} onChange={(event) => setDelayMinutes(Number(event.target.value))} className="h-9 rounded-xl text-xs" />
                <p className="text-[10px] text-muted-foreground">0 — сразу после перехода в стадию</p>
              </div>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border/30 bg-background/35 p-3">
                <Checkbox
                  checked={requireSameStage}
                  onCheckedChange={(checked) => setRequireSameStage(checked === true)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-[11px] font-medium">Проверить стадию перед запуском</span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                    Если сделка уже ушла дальше, действие будет безопасно пропущено
                  </span>
                </span>
              </label>
              <div className="space-y-1.5">
                <Label className="text-[11px]">Часовой пояс</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger className="h-9 rounded-xl text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Europe/Warsaw">Europe/Warsaw</SelectItem>
                    <SelectItem value="Europe/Minsk">Europe/Minsk</SelectItem>
                    <SelectItem value="Europe/Moscow">Europe/Moscow</SelectItem>
                    <SelectItem value="UTC">UTC</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border/30 bg-background/35 p-3">
                <Checkbox
                  checked={quietHoursEnabled}
                  onCheckedChange={(checked) => setQuietHoursEnabled(checked === true)}
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-[11px] font-medium">Не выполнять в тихие часы</span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                    Запуск автоматически переносится на конец тихого периода
                  </span>
                </span>
              </label>
              {quietHoursEnabled && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Начало</Label>
                    <Input type="time" value={quietHoursStart} onChange={(event) => setQuietHoursStart(event.target.value)} className="h-9 rounded-xl text-xs" />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Окончание</Label>
                    <Input type="time" value={quietHoursEnd} onChange={(event) => setQuietHoursEnd(event.target.value)} className="h-9 rounded-xl text-xs" />
                  </div>
                </div>
              )}
              {actionType === "create_task" && <div className="space-y-1.5">
                <Label className="text-[11px]">Срок выполнения, часов</Label>
                <Input type="number" min={0} max={8760} value={dueHours} onChange={(event) => setDueHours(Number(event.target.value))} className="h-9 rounded-xl text-xs" />
              </div>}
            </div>
            <div className="absolute inset-x-0 bottom-0 flex items-center justify-end gap-2 border-t border-border/25 bg-background/75 px-5 py-4 backdrop-blur-xl">
              <Button variant="ghost" size="sm" className="h-8 rounded-xl text-xs" onClick={resetEditor}>Отмена</Button>
              <Button size="sm" className="h-8 rounded-xl px-4 text-xs" disabled={createRule.isPending} onClick={submit}>
                {createRule.isPending && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                Сохранить черновик
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
