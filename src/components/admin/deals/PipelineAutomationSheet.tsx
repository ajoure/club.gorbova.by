import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
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
  X,
  XCircle,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { DateTimePicker } from "@/components/ui/datetime-picker";
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
import { TokenizedRichInput } from "@/components/admin/TokenizedRichInput";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
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
import { useProductsV2, useTariffs } from "@/hooks/useProductsV2";
import { ORDER_STATUS_RU } from "@/lib/orderStatusLabel";
import {
  PipelineAutomationCondition,
  PipelineAutomationConditionField,
  PipelineAutomationConditionOperator,
  PipelineAutomationRule,
  PipelineAutomationTriggerType,
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
const DELAY_UNITS = [
  { value: "minutes", label: "минуты", minutes: 1 },
  { value: "hours", label: "часы", minutes: 60 },
  { value: "days", label: "дни", minutes: 1440 },
  { value: "weeks", label: "недели", minutes: 10080 },
] as const;
const WEEKDAYS = [
  { value: 1, label: "Пн" },
  { value: 2, label: "Вт" },
  { value: 3, label: "Ср" },
  { value: 4, label: "Чт" },
  { value: 5, label: "Пт" },
  { value: 6, label: "Сб" },
  { value: 7, label: "Вс" },
];
const DEAL_CURRENCIES = ["BYN", "USD", "EUR", "RUB"] as const;

const CONDITION_FIELDS: Array<{
  value: PipelineAutomationConditionField;
  label: string;
}> = [
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
      [
        "eq",
        "neq",
        "is_empty",
        "is_not_empty",
        "gt",
        "gte",
        "lt",
        "lte",
      ].includes(value),
    );
  }
  if (["status", "currency", "customer_email"].includes(field)) {
    return CONDITION_OPERATORS.filter(({ value }) =>
      [
        "eq",
        "neq",
        "contains",
        "not_contains",
        "is_empty",
        "is_not_empty",
      ].includes(value),
    );
  }
  return CONDITION_OPERATORS.filter(({ value }) =>
    ["eq", "neq", "is_empty", "is_not_empty"].includes(value),
  );
}

function conditionFieldLabel(field: string | null) {
  return CONDITION_FIELDS.find((item) => item.value === field)?.label ?? "поле сделки";
}

function ConditionValuePicker({
  condition,
  products,
  tariffs,
  staff,
  onChange,
}: {
  condition: PipelineAutomationCondition;
  products: Array<{ id: string; name: string; is_active?: boolean | null }>;
  tariffs: Array<{ id: string; name: string; product_id?: string | null }>;
  staff: Array<{ user_id: string; label: string }>;
  onChange: (value: string | number | boolean) => void;
}) {
  const disabled = ["is_empty", "is_not_empty"].includes(condition.operator);
  if (disabled) return null;

  const value = String(condition.value ?? "");
  const selectClassName = "h-8 w-full rounded-lg bg-background/80 text-[10px]";
  const renderSelect = (placeholder: string, items: Array<{ value: string; label: string }>) => (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className={selectClassName}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent className="max-h-[min(320px,var(--radix-select-content-available-height))]">
        {items.map((item) => (
          <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  switch (condition.field) {
    case "product_id":
      return renderSelect("Выберите продукт", products.map((product) => ({
        value: product.id,
        label: product.is_active === false ? `${product.name} · архив` : product.name,
      })));
    case "tariff_id":
      return renderSelect("Выберите тариф", tariffs.map((tariff) => ({ value: tariff.id, label: tariff.name })));
    case "responsible_user_id":
      return renderSelect("Выберите ответственного", staff.map((person) => ({ value: person.user_id, label: person.label })));
    case "status":
      return renderSelect("Выберите статус", Object.entries(ORDER_STATUS_RU).map(([status, label]) => ({ value: status, label })));
    case "currency":
      return renderSelect("Выберите валюту", DEAL_CURRENCIES.map((currency) => ({ value: currency, label: currency })));
    case "is_trial":
      return renderSelect("Выберите значение", [
        { value: "true", label: "Да, пробная" },
        { value: "false", label: "Нет, обычная" },
      ]);
    case "paid_amount":
    case "final_price":
      return (
        <Input
          type="number"
          min="0"
          step="0.01"
          inputMode="decimal"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Сумма"
          className="h-8 rounded-lg bg-background/80 text-[10px]"
        />
      );
    case "customer_email":
      return (
        <Input
          type="email"
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="Email клиента"
          className="h-8 rounded-lg bg-background/80 text-[10px]"
        />
      );
    default:
      return null;
  }
}

function statusLabel(status: PipelineAutomationRule["status"]) {
  if (status === "active") return "Работает";
  if (status === "paused") return "Пауза";
  return "Черновик";
}

function TriggerCatalogPicker({
  value,
  onChange,
}: {
  value: PipelineAutomationTriggerType;
  onChange: (value: PipelineAutomationTriggerType) => void;
}) {
  const categories = [
    "deal",
    "field",
    "payment",
    "communication",
    "calendar",
    "system",
  ] as const;
  const [open, setOpen] = useState(false);
  const selected = CRM_AUTOMATION_TRIGGER_CATALOG.find(
    (trigger) => trigger.id === value,
  );
  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Label className="text-[11px]">Триггер</Label>
        <TooltipProvider delayDuration={180}>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="text-muted-foreground hover:text-primary"
                aria-label="О триггерах"
              >
                <Info className="h-3 w-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent className="max-w-56 border-white/20 bg-background/90 text-[10px] leading-4 backdrop-blur-xl">
              Доступны только триггеры с готовым событием и worker-контрактом.
              Остальные показаны как план развития, чтобы не сохранить
              неработающее правило.
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-9 w-full items-center justify-between rounded-xl border border-border/35 bg-background/45 px-3 text-left text-xs transition hover:border-primary/25 hover:bg-primary/[0.035]"
          >
            <span>{selected?.title ?? "Выберите триггер"}</span>
            <ArrowRight className="h-3.5 w-3.5 text-primary" />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[calc(100vw-2rem)] max-w-[360px] border-white/25 bg-background/85 p-2.5 shadow-[0_18px_50px_rgba(15,23,42,0.14)] backdrop-blur-3xl"
        >
          <p className="px-1.5 pb-2 text-[10px] font-semibold text-foreground/75">
            Выберите момент запуска
          </p>
          <div className="max-h-[calc(100dvh-11rem)] space-y-3 overflow-y-auto pr-1 sm:max-h-[390px]">
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
                            <button
                              type="button"
                              disabled={trigger.availability !== "available"}
                              onClick={() => {
                                if (trigger.availability === "available") {
                                  onChange(
                                    trigger.id as PipelineAutomationTriggerType,
                                  );
                                  setOpen(false);
                                }
                              }}
                              className={cn(
                                "flex w-full rounded-xl border px-2.5 py-2 text-left transition",
                                trigger.availability === "available"
                                  ? value === trigger.id
                                    ? "cursor-pointer border-primary/30 bg-primary/[0.09] shadow-sm"
                                    : "cursor-pointer border-primary/15 bg-primary/[0.035] hover:border-primary/30 hover:bg-primary/[0.07]"
                                  : "cursor-not-allowed border-border/20 bg-background/30 opacity-65",
                              )}
                            >
                              <div className="min-w-0">
                                <p className="text-[11px] font-medium">
                                  {trigger.title}
                                </p>
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
                                {trigger.availability === "available"
                                  ? "доступно"
                                  : "скоро"}
                              </Badge>
                            </button>
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
            <p className="truncate text-xs font-semibold text-foreground/90">
              {rule.name}
            </p>
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
          {rule.trigger_type === "at_datetime" ? (
            <>
              <CalendarClock className="h-3 w-3" />
              {rule.scheduled_local_at
                ? rule.scheduled_local_at.slice(0, 16).replace("T", " ")
                : "по расписанию"}
            </>
          ) : rule.trigger_type === "weekday" ? (
            <>
              <CalendarClock className="h-3 w-3" />
              по дням недели,{" "}
              {rule.recurrence_local_time?.slice(0, 5) ?? "время не задано"}
            </>
          ) : rule.trigger_type === "month_day" ? (
            <>
              <CalendarClock className="h-3 w-3" />
              {rule.recurrence_month_last
                ? "в последний день месяца"
                : `${rule.recurrence_month_day ?? "—"}-го числа`}
              {rule.recurrence_local_time
                ? `, ${rule.recurrence_local_time.slice(0, 5)}`
                : ""}
            </>
          ) : rule.trigger_type === "deal_field_changed" ? (
            <>
              <Workflow className="h-3 w-3" />
              {conditionFieldLabel(rule.trigger_field)}
            </>
          ) : (
            <>
              <ArrowRight className="h-3 w-3" />
              {rule.trigger_type === "deal_left_stage"
                ? "после выхода"
                : rule.trigger_type === "deal_created"
                  ? "после создания"
                  : "после входа"}
            </>
          )}
        </span>
        {rule.trigger_type !== "at_datetime" && rule.delay_minutes > 0 && (
          <span className="inline-flex items-center gap-1">
            <Clock3 className="h-3 w-3" /> через {rule.delay_minutes} мин
          </span>
        )}
        {rule.action_type === "create_task" ? (
          <>
            <span className="inline-flex items-center gap-1">
              <CalendarClock className="h-3 w-3" />{" "}
              {rule.due_offset_minutes / 60} ч
            </span>
            <span className="inline-flex items-center gap-1">
              <UserRound className="h-3 w-3" />
              {rule.assignee_strategy === "deal_owner"
                ? "ответственный"
                : "сотрудник"}
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
            резерв:{" "}
            {rule.fallback_action_type === "send_email" ? "Email" : "Telegram"}
          </span>
        )}
        {"items" in rule.conditions && rule.conditions.items.length > 0 && (
          <span className="inline-flex items-center gap-1 text-violet-600">
            <Workflow className="h-3 w-3" /> условий:{" "}
            {rule.conditions.items.length}
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
  const { data: rules = [], isLoading } = usePipelineAutomationRules(
    pipeline?.id ?? null,
  );
  const { data: jobs = [] } = usePipelineAutomationJobs(
    rules.map((rule) => rule.id),
  );
  const retryJob = useRetryPipelineAutomationJob();
  const { data: taskTypes = [] } = useCrmTaskTypes();
  const { data: emailTemplates = [] } = usePipelineEmailTemplates();
  const { data: staff = [] } = useStaffOptions();
  const { data: products = [] } = useProductsV2();
  const { data: tariffs = [] } = useTariffs();
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
  const [triggerType, setTriggerType] =
    useState<PipelineAutomationTriggerType>("deal_entered_stage");
  const [scheduledDate, setScheduledDate] = useState<Date | undefined>();
  const [scheduledTime, setScheduledTime] = useState("09:00");
  const [recurrenceWeekdays, setRecurrenceWeekdays] = useState<number[]>([
    1, 2, 3, 4, 5,
  ]);
  const [recurrenceTime, setRecurrenceTime] = useState("09:00");
  const [recurrenceMonthDay, setRecurrenceMonthDay] = useState("1");
  const [recurrenceMonthLast, setRecurrenceMonthLast] = useState(false);
  const [triggerField, setTriggerField] =
    useState<PipelineAutomationConditionField>("status");
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
  const [delayUnit, setDelayUnit] =
    useState<(typeof DELAY_UNITS)[number]["value"]>("minutes");
  const [requireSameStage, setRequireSameStage] = useState(true);
  const [timezone, setTimezone] = useState("Europe/Warsaw");
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietHoursStart, setQuietHoursStart] = useState("22:00");
  const [quietHoursEnd, setQuietHoursEnd] = useState("08:00");
  const [conditionLogic, setConditionLogic] = useState<"and" | "or">("and");
  const [conditions, setConditions] = useState<PipelineAutomationCondition[]>(
    [],
  );
  const [noBranchEnabled, setNoBranchEnabled] = useState(false);
  const [noBranchTaskTypeId, setNoBranchTaskTypeId] = useState("");
  const [noBranchTitle, setNoBranchTitle] = useState(
    "Проверить сделку {{deal_number}}",
  );
  const [noBranchDescription, setNoBranchDescription] = useState("");
  const [noBranchAssignee, setNoBranchAssignee] = useState(OWNER);
  const [noBranchDueHours, setNoBranchDueHours] = useState(24);
  const [errorBranchEnabled, setErrorBranchEnabled] = useState(false);
  const [errorBranchTaskTypeId, setErrorBranchTaskTypeId] = useState("");
  const [errorBranchTitle, setErrorBranchTitle] = useState(
    "Проверить ошибку автоматизации {{deal_number}}",
  );
  const [errorBranchDescription, setErrorBranchDescription] = useState("");
  const [errorBranchAssignee, setErrorBranchAssignee] = useState(OWNER);
  const [errorBranchDueHours, setErrorBranchDueHours] = useState(24);

  useEffect(() => {
    if (!taskTypeId && taskTypes[0]?.id) setTaskTypeId(taskTypes[0].id);
  }, [taskTypeId, taskTypes]);
  useEffect(() => {
    if (!noBranchTaskTypeId && taskTypes[0]?.id)
      setNoBranchTaskTypeId(taskTypes[0].id);
  }, [noBranchTaskTypeId, taskTypes]);
  useEffect(() => {
    if (!errorBranchTaskTypeId && taskTypes[0]?.id)
      setErrorBranchTaskTypeId(taskTypes[0].id);
  }, [errorBranchTaskTypeId, taskTypes]);
  useEffect(() => {
    if (!emailTemplateId && emailTemplates[0]?.id)
      setEmailTemplateId(emailTemplates[0].id);
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
    setTriggerType("deal_entered_stage");
    setScheduledDate(undefined);
    setScheduledTime("09:00");
    setRecurrenceWeekdays([1, 2, 3, 4, 5]);
    setRecurrenceTime("09:00");
    setRecurrenceMonthDay("1");
    setRecurrenceMonthLast(false);
    setTriggerField("status");
    setTelegramMessage(
      "Здравствуйте, {{customer_name}}! Пишем Вам по сделке {{deal_number}}.",
    );
    setFallbackEnabled(false);
    setFallbackTelegramMessage(
      "Здравствуйте, {{customer_name}}! Не удалось связаться по email. Пишем Вам по сделке {{deal_number}}.",
    );
    setDelayMinutes(0);
    setDelayUnit("minutes");
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

  const selectTrigger = (value: PipelineAutomationTriggerType) => {
    setTriggerType(value);
    if (value === "after_event" && delayMinutes === 0) {
      setDelayMinutes(60);
      setDelayUnit("hours");
    }
    if (value === "deal_left_stage") setRequireSameStage(false);
  };

  const delayUnitMinutes =
    DELAY_UNITS.find((unit) => unit.value === delayUnit)?.minutes ?? 1;

  const submit = () => {
    const emailTemplate = emailTemplates.find(
      (template) => template.id === emailTemplateId,
    );
    const fallbackEmailTemplate = emailTemplates.find(
      (template) => template.id === fallbackEmailTemplateId,
    );
    if (!pipeline || !selectedStageId || !name.trim()) return;
    if (triggerType === "at_datetime" && (!scheduledDate || !scheduledTime))
      return;
    if (triggerType === "after_event" && delayMinutes < 1) return;
    if (
      triggerType === "weekday" &&
      (!recurrenceWeekdays.length || !recurrenceTime)
    )
      return;
    if (triggerType === "deal_field_changed" && !triggerField) return;
    if (
      triggerType === "month_day" &&
      (!recurrenceTime ||
        (!recurrenceMonthLast &&
          !/^(?:[1-9]|[12][0-9]|3[01])$/.test(recurrenceMonthDay)))
    )
      return;
    if (actionType === "create_task" && (!taskTypeId || !title.trim())) return;
    if (actionType === "send_email" && !emailTemplate) return;
    if (actionType === "send_telegram" && !telegramMessage.trim()) return;
    if (
      fallbackEnabled &&
      actionType === "send_telegram" &&
      !fallbackEmailTemplate
    )
      return;
    if (
      fallbackEnabled &&
      actionType === "send_email" &&
      !fallbackTelegramMessage.trim()
    )
      return;
    if (
      conditions.some(
        (condition) =>
          !["is_empty", "is_not_empty"].includes(condition.operator) &&
          String(condition.value ?? "").trim() === "",
      )
    )
      return;
    if (noBranchEnabled && (!noBranchTaskTypeId || !noBranchTitle.trim()))
      return;
    if (
      errorBranchEnabled &&
      (!errorBranchTaskTypeId || !errorBranchTitle.trim())
    )
      return;
    const normalizedConditions = conditions.map((condition) => ({
      ...condition,
      value: ["gt", "gte", "lt", "lte"].includes(condition.operator)
        ? Number(condition.value)
        : condition.value,
    }));
    createRule.mutate(
      {
        pipeline_id: pipeline.id,
        stage_id: selectedStageId,
        name,
        trigger_type: triggerType,
        scheduled_local_at:
          triggerType === "at_datetime" && scheduledDate
            ? `${format(scheduledDate, "yyyy-MM-dd")} ${scheduledTime}:00`
            : null,
        recurrence_weekdays:
          triggerType === "weekday" ? recurrenceWeekdays : null,
        recurrence_local_time:
          triggerType === "weekday" || triggerType === "month_day"
            ? recurrenceTime
            : null,
        recurrence_month_day:
          triggerType === "month_day" && !recurrenceMonthLast
            ? Number(recurrenceMonthDay)
            : null,
        recurrence_month_last:
          triggerType === "month_day" ? recurrenceMonthLast : null,
        trigger_field:
          triggerType === "deal_field_changed" ? triggerField : null,
        action_type: actionType,
        task_type_id: actionType === "create_task" ? taskTypeId : null,
        title_template: actionType === "create_task" ? title : null,
        description_template: actionType === "create_task" ? description : null,
        assignee_strategy: assignee === OWNER ? "deal_owner" : "fixed_user",
        assignee_user_id: assignee === OWNER ? null : assignee,
        due_offset_minutes: dueHours * 60,
        reminder_offset_minutes: null,
        delay_minutes:
          triggerType === "at_datetime" ||
          triggerType === "weekday" ||
          triggerType === "month_day"
            ? 0
            : delayMinutes,
        require_same_stage:
          triggerType === "deal_left_stage" ? false : requireSameStage,
        timezone,
        quiet_hours_start: quietHoursEnabled ? quietHoursStart : null,
        quiet_hours_end: quietHoursEnabled ? quietHoursEnd : null,
        email_template_id:
          actionType === "send_email" ? emailTemplate!.id : null,
        email_account_id: null,
        email_subject_template:
          actionType === "send_email" ? emailTemplate!.subject : null,
        email_html_template:
          actionType === "send_email" ? emailTemplate!.body_html : null,
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
        no_branch_description_template: noBranchEnabled
          ? noBranchDescription
          : null,
        no_branch_assignee_strategy:
          noBranchEnabled && noBranchAssignee !== OWNER
            ? "fixed_user"
            : "deal_owner",
        no_branch_assignee_user_id:
          noBranchEnabled && noBranchAssignee !== OWNER
            ? noBranchAssignee
            : null,
        no_branch_due_offset_minutes: noBranchEnabled
          ? noBranchDueHours * 60
          : null,
        error_branch_task_type_id: errorBranchEnabled
          ? errorBranchTaskTypeId
          : null,
        error_branch_title_template: errorBranchEnabled
          ? errorBranchTitle
          : null,
        error_branch_description_template: errorBranchEnabled
          ? errorBranchDescription
          : null,
        error_branch_assignee_strategy:
          errorBranchEnabled && errorBranchAssignee !== OWNER
            ? "fixed_user"
            : "deal_owner",
        error_branch_assignee_user_id:
          errorBranchEnabled && errorBranchAssignee !== OWNER
            ? errorBranchAssignee
            : null,
        error_branch_due_offset_minutes: errorBranchEnabled
          ? errorBranchDueHours * 60
          : null,
      },
      { onSuccess: resetEditor },
    );
  };

  return (
    <Sheet
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen) resetEditor();
        onOpenChange(nextOpen);
      }}
    >
      <SheetContent
        side="right"
        overlayClassName="!bg-slate-950/45 backdrop-blur-[2px]"
        className="flex h-[100dvh] w-full min-w-0 max-w-none flex-col border-l border-border/45 bg-background/95 p-0 shadow-[-24px_0_70px_rgba(15,23,42,0.16)] backdrop-blur-3xl sm:w-[92vw] sm:max-w-[1180px]"
      >
        <SheetHeader className="shrink-0 border-b border-border/25 bg-background/45 px-4 py-3 text-left sm:px-5 sm:py-4">
          <div className="flex items-center gap-2">
            <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-primary/20 to-violet-500/10 text-primary ring-1 ring-primary/15">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <SheetTitle className="text-base">
                Автоматизация · {pipeline?.name}
              </SheetTitle>
              <SheetDescription className="mt-0.5 text-xs">
                Действия запускаются по ходу движения сделки
              </SheetDescription>
            </div>
          </div>
        </SheetHeader>

        <div className="min-h-0 min-w-0 flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div className="min-w-0 p-3 lg:min-w-max sm:p-5">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <p className="text-xs font-semibold text-foreground/85">
                    Стадии и действия
                  </p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    Добавьте первое действие под нужной стадией
                  </p>
                </div>
                <Badge
                  variant="outline"
                  className="rounded-full bg-background/45 text-[10px]"
                >
                  {rules.filter((rule) => rule.status === "active").length}{" "}
                  активных
                </Badge>
              </div>

              {jobs.length > 0 && (
                <div className="mb-4 flex max-w-[calc(92vw-40px)] items-center gap-2 overflow-x-auto rounded-2xl border border-white/35 bg-white/35 p-2.5 backdrop-blur-xl dark:border-white/10 dark:bg-slate-950/30">
                  <div className="flex shrink-0 items-center gap-1.5 px-1 text-[10px] font-semibold text-foreground/70">
                    <History className="h-3.5 w-3.5" /> Последние запуски
                  </div>
                  {jobs.slice(0, 8).map((job) => {
                    const rule = rules.find((item) => item.id === job.rule_id);
                    const failed =
                      job.status === "failed" || job.status === "dead";
                    const waiting =
                      job.status === "pending" || job.status === "running";
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
                          <p className="truncate text-[10px] font-medium">
                            {rule?.name ?? "Автоматизация"}
                          </p>
                          <p className="mt-0.5 text-[9px] text-muted-foreground">
                            {job.status === "succeeded"
                              ? job.result?.fallback_used === true
                                ? "Выполнено через резерв"
                                : "Выполнено"
                              : job.status === "skipped"
                                ? job.result?.skip_reason ===
                                  "conditions_not_met"
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

              <div className="flex flex-col gap-3 lg:flex-row">
                {stages.map((stage) => (
                  <section
                    key={stage.id}
                    className="w-full shrink-0 overflow-hidden rounded-[22px] border border-white/35 bg-white/35 shadow-[0_18px_50px_rgba(15,23,42,0.05)] backdrop-blur-2xl dark:border-white/10 dark:bg-slate-950/30 lg:w-[286px]"
                  >
                    <div
                      className="h-1"
                      style={{ backgroundColor: stage.color }}
                    />
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
          <div className="absolute inset-y-0 right-0 z-20 flex h-[100dvh] w-full min-h-0 flex-col border-l border-border/45 bg-background/[0.98] shadow-[-24px_0_70px_rgba(15,23,42,0.16)] backdrop-blur-3xl sm:w-[440px]">
            <div className="flex shrink-0 items-start gap-3 border-b border-border/35 bg-card/60 px-4 py-3 sm:px-5 sm:py-4">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold">
                  {actionType === "create_task"
                    ? "Создать задачу"
                    : actionType === "send_email"
                      ? "Отправить Email"
                      : "Отправить Telegram"}
                </p>
                <p className="mt-1 text-[11px] leading-4 text-muted-foreground">
                  {triggerType === "at_datetime"
                    ? "Один раз для сделок, которые находятся в этой стадии в выбранный момент"
                    : triggerType === "weekday"
                      ? "Повтор для сделок, которые находятся в этой стадии в выбранные дни"
                      : triggerType === "month_day"
                        ? "Повтор для сделок, которые находятся в этой стадии в выбранный день месяца"
                        : triggerType === "deal_left_stage"
                          ? "После выхода сделки из выбранной стадии"
                          : triggerType === "deal_created"
                            ? "Один раз при создании сделки в выбранной стартовой стадии"
                            : triggerType === "payment_received"
                              ? "После подтверждённой оплаты по сделке в выбранной стадии"
                              : triggerType === "deal_field_changed"
                                ? "После изменения выбранного поля сделки в этой стадии"
                                : "После перехода сделки в стадию"}
                </p>
              </div>
              <button
                type="button"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-xl border border-border/30 bg-background/50 text-muted-foreground transition hover:border-primary/25 hover:bg-primary/[0.06] hover:text-primary"
                onClick={resetEditor}
                aria-label="Закрыть редактор автоматизации"
                title="Закрыть редактор"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4 pb-6 [&_[role=combobox]]:text-base [&_input]:text-base [&_textarea]:text-base sm:p-5 sm:[&_[role=combobox]]:text-xs sm:[&_input]:text-xs sm:[&_textarea]:text-xs">
              <div className="space-y-1.5">
                <Label className="text-[11px]">Название правила</Label>
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  className="h-9 rounded-xl text-xs"
                />
              </div>
              <TriggerCatalogPicker
                value={triggerType}
                onChange={selectTrigger}
              />
              {triggerType === "at_datetime" && (
                <div className="space-y-1.5 rounded-xl border border-primary/15 bg-primary/[0.035] p-3">
                  <Label className="text-[11px]">Когда запустить</Label>
                  <DateTimePicker
                    date={scheduledDate}
                    time={scheduledTime}
                    onDateChange={setScheduledDate}
                    onTimeChange={setScheduledTime}
                    className="h-9 rounded-xl border-border/35 bg-background/55 text-xs"
                  />
                  <p className="text-[10px] leading-4 text-muted-foreground">
                    Используется единый календарь CRM. Точное время обязательно;
                    правило применится к текущим сделкам выбранной стадии.
                  </p>
                </div>
              )}
              {triggerType === "weekday" && (
                <div className="space-y-2 rounded-xl border border-primary/15 bg-primary/[0.035] p-3">
                  <Label className="text-[11px]">Повторять по дням</Label>
                  <div className="grid grid-cols-7 gap-1">
                    {WEEKDAYS.map((day) => {
                      const selected = recurrenceWeekdays.includes(day.value);
                      return (
                        <button
                          key={day.value}
                          type="button"
                          onClick={() =>
                            setRecurrenceWeekdays((current) =>
                              selected
                                ? current.filter((item) => item !== day.value)
                                : [...current, day.value].sort(),
                            )
                          }
                          className={cn(
                            "h-8 rounded-lg border text-[10px] transition",
                            selected
                              ? "border-primary/30 bg-primary/10 text-primary"
                              : "border-border/30 bg-background/40 text-muted-foreground hover:border-primary/20",
                          )}
                        >
                          {day.label}
                        </button>
                      );
                    })}
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="shrink-0 text-[10px] text-muted-foreground">
                      Время
                    </Label>
                    <Input
                      type="time"
                      value={recurrenceTime}
                      onChange={(event) =>
                        setRecurrenceTime(event.target.value)
                      }
                      className="h-8 rounded-lg text-xs"
                    />
                  </div>
                  <p className="text-[10px] leading-4 text-muted-foreground">
                    Для сделок, которые находятся в этой стадии в момент
                    запуска. Время — в часовом поясе правила.
                  </p>
                </div>
              )}
              {triggerType === "month_day" && (
                <div className="space-y-2 rounded-xl border border-primary/15 bg-primary/[0.035] p-3">
                  <Label className="text-[11px]">Повторять каждый месяц</Label>
                  <div className="grid grid-cols-[1fr_auto] items-end gap-2">
                    <div className="space-y-1.5">
                      <Label className="text-[10px] text-muted-foreground">
                        День месяца
                      </Label>
                      <Select
                        value={recurrenceMonthDay}
                        onValueChange={setRecurrenceMonthDay}
                        disabled={recurrenceMonthLast}
                      >
                        <SelectTrigger className="h-8 rounded-lg text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Array.from(
                            { length: 31 },
                            (_, index) => index + 1,
                          ).map((day) => (
                            <SelectItem key={day} value={String(day)}>
                              {day}-го числа
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <label className="flex h-8 items-center gap-2 rounded-lg border border-border/30 bg-background/40 px-2 text-[10px] text-muted-foreground">
                      <Checkbox
                        checked={recurrenceMonthLast}
                        onCheckedChange={(checked) =>
                          setRecurrenceMonthLast(checked === true)
                        }
                      />
                      Последний день
                    </label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label className="shrink-0 text-[10px] text-muted-foreground">
                      Время
                    </Label>
                    <Input
                      type="time"
                      value={recurrenceTime}
                      onChange={(event) =>
                        setRecurrenceTime(event.target.value)
                      }
                      className="h-8 rounded-lg text-xs"
                    />
                  </div>
                  <p className="text-[10px] leading-4 text-muted-foreground">
                    Используется часовой пояс правила. Для 29–31-го запуск будет
                    только в месяцах, где этот день существует; «Последний день»
                    работает и в коротких месяцах.
                  </p>
                </div>
              )}
              {triggerType === "deal_field_changed" && (
                <div className="space-y-1.5 rounded-xl border border-primary/15 bg-primary/[0.035] p-3">
                  <Label className="text-[11px]">Какое поле отслеживать</Label>
                  <Select
                    value={triggerField}
                    onValueChange={(value) => setTriggerField(value as PipelineAutomationConditionField)}
                  >
                    <SelectTrigger className="h-8 rounded-lg text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {CONDITION_FIELDS.map((field) => (
                        <SelectItem key={field.value} value={field.value}>{field.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-[10px] leading-4 text-muted-foreground">Доступны только канонические поля сделки. Правило сработает, когда значение реально изменилось, пока сделка находится в этой стадии.</p>
                </div>
              )}
              <div className="space-y-1.5">
                <Label className="text-[11px]">Действие</Label>
                <Select
                  value={actionType}
                  onValueChange={(
                    value: "create_task" | "send_email" | "send_telegram",
                  ) => setActionType(value)}
                >
                  <SelectTrigger className="h-9 rounded-xl text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="create_task">Создать задачу</SelectItem>
                    <SelectItem value="send_email">Отправить Email</SelectItem>
                    <SelectItem value="send_telegram">
                      Отправить Telegram
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {actionType === "send_email" && (
                <>
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Шаблон письма</Label>
                    <Select
                      value={emailTemplateId}
                      onValueChange={setEmailTemplateId}
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
                  {emailTemplates.find(
                    (template) => template.id === emailTemplateId,
                  ) && (
                    <div className="rounded-xl border border-border/30 bg-background/35 p-3">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Тема
                      </p>
                      <p className="mt-1 text-[11px] font-medium">
                        {
                          emailTemplates.find(
                            (template) => template.id === emailTemplateId,
                          )?.subject
                        }
                      </p>
                      <p className="mt-2 text-[10px] leading-4 text-muted-foreground">
                        Получатель: email из карточки сделки. Содержимое
                        сохраняется в версии правила.
                      </p>
                    </div>
                  )}
                </>
              )}
              {actionType === "send_telegram" && (
                <div className="space-y-1.5">
                  <Label className="text-[11px]">Текст сообщения</Label>
                  <TokenizedRichInput
                    value={telegramMessage}
                    onChange={setTelegramMessage}
                    rows={5}
                    tokenContext="crm_automation"
                    className="min-h-28 rounded-xl text-xs"
                  />
                  <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                    <span>Нажмите [ — выберите данные сделки или клиента</span>
                    <span>{telegramMessage.length}/4096</span>
                  </div>
                  <p className="text-[10px] leading-4 text-muted-foreground">
                    Получатель определяется по пользователю сделки. Сообщение
                    будет отражено в Contact Center.
                  </p>
                </div>
              )}
              {actionType !== "create_task" && (
                <>
                  <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-amber-500/20 bg-amber-500/[0.04] p-3">
                    <Checkbox
                      checked={fallbackEnabled}
                      onCheckedChange={(checked) =>
                        setFallbackEnabled(checked === true)
                      }
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-[11px] font-medium">
                        Резервный канал
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                        После пяти неудачных попыток отправить через{" "}
                        {actionType === "send_email" ? "Telegram" : "Email"}
                      </span>
                    </span>
                  </label>
                  {fallbackEnabled && actionType === "send_telegram" && (
                    <div className="space-y-1.5">
                      <Label className="text-[11px]">
                        Резервный шаблон Email
                      </Label>
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
                      <Label className="text-[11px]">
                        Резервное сообщение Telegram
                      </Label>
                      <TokenizedRichInput
                        value={fallbackTelegramMessage}
                        onChange={setFallbackTelegramMessage}
                        rows={4}
                        tokenContext="crm_automation"
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
                      <SelectTrigger className="h-9 rounded-xl text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {taskTypes.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Заголовок задачи</Label>
                    <TokenizedRichInput
                      value={title}
                      onChange={setTitle}
                      singleLine
                      tokenContext="crm_automation"
                      className="h-9 min-h-0 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Описание</Label>
                    <TokenizedRichInput
                      value={description}
                      onChange={setDescription}
                      tokenContext="crm_automation"
                      rows={4}
                      className="min-h-20 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Исполнитель</Label>
                    <Select value={assignee} onValueChange={setAssignee}>
                      <SelectTrigger className="h-9 rounded-xl text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={OWNER}>
                          Текущий ответственный сделки
                        </SelectItem>
                        {staff.map((person) => (
                          <SelectItem
                            key={person.user_id}
                            value={person.user_id}
                          >
                            {person.label}
                          </SelectItem>
                        ))}
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
                      onValueChange={(value: "and" | "or") =>
                        setConditionLogic(value)
                      }
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
                      <div className="grid grid-cols-1 gap-2 min-[390px]:grid-cols-[1fr_1fr_auto]">
                        <Select
                          value={condition.field}
                          onValueChange={(
                            value: PipelineAutomationConditionField,
                          ) =>
                            setConditions((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, field: value, operator: "eq", value: "" }
                                  : item,
                              ),
                            )
                          }
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
                          onValueChange={(
                            value: PipelineAutomationConditionOperator,
                          ) =>
                            setConditions((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index
                                  ? { ...item, operator: value }
                                  : item,
                              ),
                            )
                          }
                        >
                          <SelectTrigger className="h-8 rounded-lg text-[10px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {operatorsForField(condition.field).map(
                              (operator) => (
                                <SelectItem
                                  key={operator.value}
                                  value={operator.value}
                                >
                                  {operator.label}
                                </SelectItem>
                              ),
                            )}
                          </SelectContent>
                        </Select>
                        <button
                          type="button"
                          className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600"
                          onClick={() =>
                            setConditions((current) =>
                              current.filter(
                                (_, itemIndex) => itemIndex !== index,
                              ),
                            )
                          }
                          title="Удалить условие"
                        >
                          <XCircle className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      {needsValue && (
                        <ConditionValuePicker
                          condition={condition}
                          products={products}
                          tariffs={tariffs}
                          staff={staff}
                          onChange={(value) =>
                            setConditions((current) =>
                              current.map((item, itemIndex) =>
                                itemIndex === index ? { ...item, value } : item,
                              ),
                            )
                          }
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
                                  : item,
                              ),
                            )
                          }
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
                      onCheckedChange={(checked) =>
                        setNoBranchEnabled(checked === true)
                      }
                      className="mt-0.5"
                    />
                    <span>
                      <span className="block text-[11px] font-medium">
                        Если условия не совпали — создать задачу
                      </span>
                      <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                        Основное действие не запустится; задача попадёт в журнал
                        этой ветки.
                      </span>
                    </span>
                  </label>
                  {noBranchEnabled && (
                    <div className="space-y-2.5 border-t border-sky-500/15 pt-3">
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Тип задачи ветки</Label>
                        <Select
                          value={noBranchTaskTypeId}
                          onValueChange={setNoBranchTaskTypeId}
                        >
                          <SelectTrigger className="h-8 rounded-lg text-[10px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {taskTypes.map((type) => (
                              <SelectItem key={type.id} value={type.id}>
                                {type.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Заголовок задачи</Label>
                        <TokenizedRichInput
                          value={noBranchTitle}
                          onChange={setNoBranchTitle}
                          singleLine
                          tokenContext="crm_automation"
                          className="h-8 min-h-0 rounded-lg text-[10px]"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Описание</Label>
                        <TokenizedRichInput
                          value={noBranchDescription}
                          onChange={setNoBranchDescription}
                          tokenContext="crm_automation"
                          rows={3}
                          className="min-h-16 rounded-lg text-[10px]"
                        />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1.5">
                          <Label className="text-[11px]">Исполнитель</Label>
                          <Select
                            value={noBranchAssignee}
                            onValueChange={setNoBranchAssignee}
                          >
                            <SelectTrigger className="h-8 rounded-lg text-[10px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={OWNER}>
                                Ответственный
                              </SelectItem>
                              {staff.map((person) => (
                                <SelectItem
                                  key={person.user_id}
                                  value={person.user_id}
                                >
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
                            onChange={(event) =>
                              setNoBranchDueHours(Number(event.target.value))
                            }
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
                    onCheckedChange={(checked) =>
                      setErrorBranchEnabled(checked === true)
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-[11px] font-medium">
                      После окончательной ошибки — создать задачу
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                      Сработает только после пяти попыток и не сработает, если
                      резервный канал доставил сообщение.
                    </span>
                  </span>
                </label>
                {errorBranchEnabled && (
                  <div className="space-y-2.5 border-t border-rose-500/15 pt-3">
                    <div className="space-y-1.5">
                      <Label className="text-[11px]">Тип задачи ветки</Label>
                      <Select
                        value={errorBranchTaskTypeId}
                        onValueChange={setErrorBranchTaskTypeId}
                      >
                        <SelectTrigger className="h-8 rounded-lg text-[10px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {taskTypes.map((type) => (
                            <SelectItem key={type.id} value={type.id}>
                              {type.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px]">Заголовок задачи</Label>
                      <TokenizedRichInput
                        value={errorBranchTitle}
                        onChange={setErrorBranchTitle}
                        singleLine
                        tokenContext="crm_automation"
                        className="h-8 min-h-0 rounded-lg text-[10px]"
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-[11px]">Описание</Label>
                      <TokenizedRichInput
                        value={errorBranchDescription}
                        onChange={setErrorBranchDescription}
                        tokenContext="crm_automation"
                        rows={3}
                        className="min-h-16 rounded-lg text-[10px]"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label className="text-[11px]">Исполнитель</Label>
                        <Select
                          value={errorBranchAssignee}
                          onValueChange={setErrorBranchAssignee}
                        >
                          <SelectTrigger className="h-8 rounded-lg text-[10px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={OWNER}>Ответственный</SelectItem>
                            {staff.map((person) => (
                              <SelectItem
                                key={person.user_id}
                                value={person.user_id}
                              >
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
                          onChange={(event) =>
                            setErrorBranchDueHours(Number(event.target.value))
                          }
                          className="h-8 rounded-lg text-[10px]"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
              {triggerType !== "at_datetime" &&
                triggerType !== "weekday" &&
                triggerType !== "month_day" && (
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">
                      {triggerType === "after_event"
                        ? "Период после события"
                        : "Запустить через"}
                    </Label>
                    <div className="grid grid-cols-[1fr_116px] gap-2">
                      <Input
                        type="number"
                        min={triggerType === "after_event" ? 1 : 0}
                        max={525600 / delayUnitMinutes}
                        value={delayMinutes / delayUnitMinutes}
                        onChange={(event) => {
                          const next = Number(event.target.value);
                          if (Number.isFinite(next))
                            setDelayMinutes(
                              Math.round(next * delayUnitMinutes),
                            );
                        }}
                        className="h-9 rounded-xl text-xs"
                      />
                      <Select
                        value={delayUnit}
                        onValueChange={(value) =>
                          setDelayUnit(value as typeof delayUnit)
                        }
                      >
                        <SelectTrigger className="h-9 rounded-xl text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {DELAY_UNITS.map((unit) => (
                            <SelectItem key={unit.value} value={unit.value}>
                              {unit.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <p className="text-[10px] text-muted-foreground">
                      {triggerType === "after_event"
                        ? "Период отсчитывается с момента входа сделки в эту стадию"
                        : "0 — сразу после перехода в стадию"}
                    </p>
                  </div>
                )}
              {triggerType === "deal_left_stage" ? (
                <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.035] p-3 text-[10px] leading-4 text-muted-foreground">
                  Для этого события проверка текущей стадии отключена: сделка уже
                  вышла из выбранной стадии, и действие должно быть выполнено для неё.
                </div>
              ) : (
                <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border/30 bg-background/35 p-3">
                  <Checkbox
                    checked={requireSameStage}
                    onCheckedChange={(checked) =>
                      setRequireSameStage(checked === true)
                    }
                    className="mt-0.5"
                  />
                  <span>
                    <span className="block text-[11px] font-medium">
                      Проверить стадию перед запуском
                    </span>
                    <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                      Если сделка уже ушла дальше, действие будет безопасно
                      пропущено
                    </span>
                  </span>
                </label>
              )}
              <div className="space-y-1.5">
                <Label className="text-[11px]">Часовой пояс</Label>
                <Select value={timezone} onValueChange={setTimezone}>
                  <SelectTrigger className="h-9 rounded-xl text-xs">
                    <SelectValue />
                  </SelectTrigger>
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
                  onCheckedChange={(checked) =>
                    setQuietHoursEnabled(checked === true)
                  }
                  className="mt-0.5"
                />
                <span>
                  <span className="block text-[11px] font-medium">
                    Не выполнять в тихие часы
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
                    Запуск автоматически переносится на конец тихого периода
                  </span>
                </span>
              </label>
              {quietHoursEnabled && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Начало</Label>
                    <Input
                      type="time"
                      value={quietHoursStart}
                      onChange={(event) =>
                        setQuietHoursStart(event.target.value)
                      }
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label className="text-[11px]">Окончание</Label>
                    <Input
                      type="time"
                      value={quietHoursEnd}
                      onChange={(event) => setQuietHoursEnd(event.target.value)}
                      className="h-9 rounded-xl text-xs"
                    />
                  </div>
                </div>
              )}
              {actionType === "create_task" && (
                <div className="space-y-1.5">
                  <Label className="text-[11px]">Срок выполнения, часов</Label>
                  <Input
                    type="number"
                    min={0}
                    max={8760}
                    value={dueHours}
                    onChange={(event) =>
                      setDueHours(Number(event.target.value))
                    }
                    className="h-9 rounded-xl text-xs"
                  />
                </div>
              )}
            </div>
            <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border/25 bg-background/85 px-4 py-3 backdrop-blur-xl sm:justify-end sm:px-5 sm:py-4">
              <Button
                variant="ghost"
                size="sm"
                className="h-9 rounded-xl px-2.5 text-xs sm:h-8"
                onClick={resetEditor}
              >
                Отмена
              </Button>
              <Button
                size="sm"
                className="h-9 rounded-xl px-3 text-xs sm:h-8 sm:px-4"
                disabled={createRule.isPending}
                onClick={submit}
              >
                {createRule.isPending && (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                )}
                Сохранить черновик
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
