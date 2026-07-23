import { useEffect, useMemo, useState } from "react";
import {
  Archive,
  ArrowRight,
  CalendarClock,
  CheckCircle2,
  CirclePause,
  Clock3,
  History,
  Loader2,
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
import { cn } from "@/lib/utils";
import { CrmPipeline, CrmPipelineStage } from "@/services/pipelineService";
import { useCrmTaskTypes } from "@/hooks/useCrmTasks";
import { useStaffOptions } from "@/hooks/useStaffOptions";
import {
  PipelineAutomationRule,
  useCreatePipelineAutomationRule,
  usePipelineAutomationJobs,
  usePipelineAutomationRules,
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

function statusLabel(status: PipelineAutomationRule["status"]) {
  if (status === "active") return "Работает";
  if (status === "paused") return "Пауза";
  return "Черновик";
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
            {rule.status === "active" ? (
              <CheckCircle2 className="h-3.5 w-3.5" />
            ) : (
              <Workflow className="h-3.5 w-3.5" />
            )}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground/90">{rule.name}</p>
            <p className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-muted-foreground">
              {rule.title_template}
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
        <span className="inline-flex items-center gap-1">
          <CalendarClock className="h-3 w-3" /> {rule.due_offset_minutes / 60} ч
        </span>
        <span className="inline-flex items-center gap-1">
          <UserRound className="h-3 w-3" />
          {rule.assignee_strategy === "deal_owner" ? "ответственный" : "сотрудник"}
        </span>
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
  const [delayMinutes, setDelayMinutes] = useState(0);
  const [requireSameStage, setRequireSameStage] = useState(true);
  const [timezone, setTimezone] = useState("Europe/Warsaw");
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(false);
  const [quietHoursStart, setQuietHoursStart] = useState("22:00");
  const [quietHoursEnd, setQuietHoursEnd] = useState("08:00");

  useEffect(() => {
    if (!taskTypeId && taskTypes[0]?.id) setTaskTypeId(taskTypes[0].id);
  }, [taskTypeId, taskTypes]);

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
    setDelayMinutes(0);
    setRequireSameStage(true);
    setTimezone("Europe/Warsaw");
    setQuietHoursEnabled(false);
    setQuietHoursStart("22:00");
    setQuietHoursEnd("08:00");
  };

  const submit = () => {
    if (!pipeline || !selectedStageId || !taskTypeId || !name.trim() || !title.trim()) return;
    createRule.mutate(
      {
        pipeline_id: pipeline.id,
        stage_id: selectedStageId,
        name,
        task_type_id: taskTypeId,
        title_template: title,
        description_template: description,
        assignee_strategy: assignee === OWNER ? "deal_owner" : "fixed_user",
        assignee_user_id: assignee === OWNER ? null : assignee,
        due_offset_minutes: dueHours * 60,
        reminder_offset_minutes: null,
        delay_minutes: delayMinutes,
        require_same_stage: requireSameStage,
        timezone,
        quiet_hours_start: quietHoursEnabled ? quietHoursStart : null,
        quiet_hours_end: quietHoursEnabled ? quietHoursEnd : null,
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
                              ? "Выполнено"
                              : job.status === "skipped"
                                ? "Пропущено: сделка ушла"
                                : job.status === "running"
                                  ? "Выполняется"
                                  : job.status === "pending"
                                    ? "Ожидает запуска"
                                    : job.status === "dead"
                                      ? "Остановлено после ошибок"
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
              <p className="text-sm font-semibold">Создать задачу</p>
              <p className="mt-1 text-[11px] text-muted-foreground">После перехода сделки в стадию</p>
            </div>
            <div className="space-y-4 overflow-y-auto p-5">
              <div className="space-y-1.5">
                <Label className="text-[11px]">Название правила</Label>
                <Input value={name} onChange={(event) => setName(event.target.value)} className="h-9 rounded-xl text-xs" />
              </div>
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
              <div className="space-y-1.5">
                <Label className="text-[11px]">Срок выполнения, часов</Label>
                <Input type="number" min={0} max={8760} value={dueHours} onChange={(event) => setDueHours(Number(event.target.value))} className="h-9 rounded-xl text-xs" />
              </div>
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
