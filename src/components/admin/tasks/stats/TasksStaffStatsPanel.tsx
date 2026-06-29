import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  CalendarDays,
  CheckCircle2,
  CircleSlash,
  Loader2,
  PlusCircle,
  UserRound,
} from "lucide-react";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";

import { useCrmTaskStats, type CrmTaskStatsItem } from "@/hooks/useCrmTaskStats";

/**
 * Панель статистики задач по сотрудникам.
 * Показывает: открытые/просроченные/в работе/на сегодня
 * + созданные/закрытые/отменённые за 7д и 30д
 * + среднее время закрытия за 30д.
 *
 * Данные приходят из RPC `crm_task_stats_by_assignee` (SECURITY DEFINER, staff-only).
 */
export function TasksStaffStatsPanel() {
  const { data, isLoading, error } = useCrmTaskStats();

  const items = useMemo(() => data?.items ?? [], [data]);
  const totals = data?.totals;

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground p-6">
        <Loader2 className="h-4 w-4 animate-spin" />
        Загружаем статистику…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-rose-500 p-6">
        Не удалось загрузить статистику: {(error as Error).message}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Totals strip */}
      {totals && (
        <Card className="bg-gradient-to-br from-emerald-50/60 via-background to-teal-50/40 dark:from-emerald-950/30 dark:to-teal-950/20 border-emerald-200/40">
          <CardContent className="p-4 grid grid-cols-2 md:grid-cols-6 gap-3">
            <TotalCell icon={<Activity className="h-4 w-4 text-emerald-600" />} label="Открыто" value={totals.total_open} />
            <TotalCell icon={<AlertTriangle className="h-4 w-4 text-rose-500" />} label="Просрочено" value={totals.total_overdue} tone="warn" />
            <TotalCell icon={<PlusCircle className="h-4 w-4 text-sky-500" />} label="Создано / 30д" value={totals.total_created_30d} />
            <TotalCell icon={<CheckCircle2 className="h-4 w-4 text-emerald-500" />} label="Готово / 7д" value={totals.total_done_7d} />
            <TotalCell icon={<CheckCircle2 className="h-4 w-4 text-emerald-600" />} label="Готово / 30д" value={totals.total_done_30d} />
            <TotalCell icon={<CircleSlash className="h-4 w-4 text-muted-foreground" />} label="Отмен. / 30д" value={totals.total_canceled_30d} />
          </CardContent>
        </Card>
      )}

      {/* Per-assignee grid */}
      {items.length === 0 ? (
        <div className="text-sm text-muted-foreground p-6 text-center">
          Нет данных по сотрудникам.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {items.map((s) => (
            <StaffStatCard key={s.assignee_user_id ?? "unassigned"} stat={s} />
          ))}
        </div>
      )}
    </div>
  );
}

function TotalCell({
  icon,
  label,
  value,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
  tone?: "warn";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
        {icon}
        {label}
      </div>
      <div
        className={cn(
          "text-xl font-semibold tabular-nums",
          tone === "warn" && value > 0 && "text-rose-600",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function initials(name: string | null) {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "—";
}

function StaffStatCard({ stat }: { stat: CrmTaskStatsItem }) {
  const unassigned = !stat.assignee_user_id;
  const name = unassigned ? "Без ответственного" : stat.full_name || "Без имени";

  return (
    <Card
      className={cn(
        "border-emerald-200/30 bg-gradient-to-br from-white/70 via-emerald-50/30 to-teal-50/20",
        "dark:from-slate-900/50 dark:via-emerald-950/20 dark:to-teal-950/10",
        "backdrop-blur-md",
      )}
    >
      <CardContent className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-center gap-3">
          {unassigned ? (
            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
              <UserRound className="h-5 w-5 text-muted-foreground" />
            </div>
          ) : (
            <Avatar className="h-10 w-10 ring-2 ring-emerald-200/50">
              {stat.avatar_url ? <AvatarImage src={stat.avatar_url} alt={name} /> : null}
              <AvatarFallback>{initials(stat.full_name)}</AvatarFallback>
            </Avatar>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{name}</div>
            <div className="text-[11px] text-muted-foreground flex items-center gap-2">
              {!unassigned && (
                <span className={cn("inline-flex items-center gap-1", stat.has_telegram ? "text-emerald-600" : "text-amber-600")}>
                  ● {stat.has_telegram ? "Telegram привязан" : "Без Telegram"}
                </span>
              )}
            </div>
          </div>
          {stat.overdue > 0 && (
            <Badge variant="destructive" className="h-6">
              {stat.overdue} просроч.
            </Badge>
          )}
        </div>

        <Separator className="opacity-50" />

        {/* Open buckets */}
        <div className="grid grid-cols-4 gap-2 text-center">
          <Bucket label="Открыто" value={stat.open_total} accent="emerald" />
          <Bucket label="В работе" value={stat.in_progress} accent="sky" />
          <Bucket label="Сегодня" value={stat.due_today} accent="amber" />
          <Bucket label="Просроч." value={stat.overdue} accent="rose" />
        </div>

        <Separator className="opacity-50" />

        {/* Period rows */}
        <div className="space-y-1.5">
          <PeriodRow label="7 дней" created={stat.created_7d} done={stat.done_7d} canceled={stat.canceled_7d} />
          <PeriodRow label="30 дней" created={stat.created_30d} done={stat.done_30d} canceled={stat.canceled_30d} />
        </div>

        {/* Avg close time */}
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <CalendarDays className="h-3 w-3" />
          Среднее время закрытия (30д):{" "}
          <span className="font-medium tabular-nums text-foreground">
            {stat.avg_close_hours_30d != null ? `${stat.avg_close_hours_30d} ч` : "—"}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

function Bucket({
  label,
  value,
  accent,
}: {
  label: string;
  value: number;
  accent: "emerald" | "sky" | "amber" | "rose";
}) {
  const tone = {
    emerald: "text-emerald-700 bg-emerald-100/60 dark:bg-emerald-900/30 dark:text-emerald-200",
    sky: "text-sky-700 bg-sky-100/60 dark:bg-sky-900/30 dark:text-sky-200",
    amber: "text-amber-700 bg-amber-100/60 dark:bg-amber-900/30 dark:text-amber-200",
    rose: "text-rose-700 bg-rose-100/60 dark:bg-rose-900/30 dark:text-rose-200",
  }[accent];
  return (
    <div className={cn("rounded-md py-1.5", tone)}>
      <div className="text-[10px] uppercase tracking-wide opacity-80">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function PeriodRow({
  label,
  created,
  done,
  canceled,
}: {
  label: string;
  created: number;
  done: number;
  canceled: number;
}) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-muted-foreground">{label}</span>
      <div className="flex items-center gap-3 tabular-nums">
        <span className="inline-flex items-center gap-1 text-sky-600">
          <PlusCircle className="h-3 w-3" />
          {created}
        </span>
        <span className="inline-flex items-center gap-1 text-emerald-600">
          <CheckCircle2 className="h-3 w-3" />
          {done}
        </span>
        <span className="inline-flex items-center gap-1 text-muted-foreground">
          <CircleSlash className="h-3 w-3" />
          {canceled}
        </span>
      </div>
    </div>
  );
}
