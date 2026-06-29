import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Search,
  Plus,
  LayoutList,
  Columns3,
  CircleDot,
  Phone,
  MessageCircle,
  Calendar,
  CreditCard,
  Briefcase,
  Database,
  AlertTriangle,
  Clock,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

import {
  useCrmTaskTypes,
  useCrmTasks,
  useUpdateCrmTaskStatus,
  type CrmTask,
  type CrmTaskBucket,
  type CrmTaskStatus,
} from "@/hooks/useCrmTasks";
import { CreateCrmTaskDialog } from "@/components/admin/tasks/CreateCrmTaskDialog";

const TYPE_ICONS: Record<string, typeof CircleDot> = {
  Phone,
  MessageCircle,
  Calendar,
  CreditCard,
  Briefcase,
  Database,
  CircleDot,
};

const BUCKETS: { id: CrmTaskBucket; label: string }[] = [
  { id: "overdue", label: "Просрочено" },
  { id: "today", label: "Сегодня" },
  { id: "tomorrow", label: "Завтра" },
  { id: "week", label: "На этой неделе" },
  { id: "later", label: "Позже" },
  { id: "no_due", label: "Без срока" },
  { id: "closed", label: "Закрытые" },
];

const STATUS_LABELS: Record<CrmTaskStatus, string> = {
  open: "Открыта",
  in_progress: "В работе",
  done: "Готово",
  canceled: "Отменена",
};

function formatDue(dt: string | null) {
  if (!dt) return "—";
  try {
    return format(parseISO(dt), "d MMM, HH:mm", { locale: ru });
  } catch {
    return dt;
  }
}

function isOverdue(t: CrmTask) {
  return (
    (t.status === "open" || t.status === "in_progress") &&
    !!t.due_at &&
    parseISO(t.due_at).getTime() < Date.now()
  );
}

interface TaskCardProps {
  task: CrmTask;
  typeLabel: string;
  typeIcon: string | null;
}

function TaskCard({ task, typeLabel, typeIcon }: TaskCardProps) {
  const updateStatus = useUpdateCrmTaskStatus();
  const Icon = TYPE_ICONS[typeIcon ?? "CircleDot"] ?? CircleDot;
  const overdue = isOverdue(task);

  return (
    <Card className="mb-2">
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              <div className="text-sm font-medium truncate">{task.title}</div>
              <div className="text-xs text-muted-foreground">{typeLabel}</div>
            </div>
          </div>
          {task.public_id ? (
            <Badge variant="outline" className="text-[10px] font-mono">
              {task.public_id}
            </Badge>
          ) : null}
        </div>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          {overdue ? (
            <span className="inline-flex items-center gap-1 text-destructive">
              <AlertTriangle className="h-3 w-3" />
              {formatDue(task.due_at)}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {formatDue(task.due_at)}
            </span>
          )}
          <Badge variant="secondary" className="text-[10px]">
            {STATUS_LABELS[task.status]}
          </Badge>
        </div>

        {task.status !== "done" && task.status !== "canceled" ? (
          <div className="flex gap-1">
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              onClick={() => updateStatus.mutate({ taskId: task.id, status: "done" })}
              disabled={updateStatus.isPending}
            >
              Готово
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-7 text-xs">
                  Ещё
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {task.status !== "in_progress" ? (
                  <DropdownMenuItem
                    onClick={() => updateStatus.mutate({ taskId: task.id, status: "in_progress" })}
                  >
                    В работу
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem
                  onClick={() => updateStatus.mutate({ taskId: task.id, status: "canceled" })}
                >
                  Отменить
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default function AdminTasks() {
  const [view, setView] = useState<"list" | "board">("list");
  const [search, setSearch] = useState("");
  const [typeId, setTypeId] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"open" | "all" | CrmTaskStatus>("open");

  const { data: types = [] } = useCrmTaskTypes();
  const typeMap = useMemo(
    () => Object.fromEntries(types.map((t) => [t.id, t])),
    [types],
  );

  const baseFilters = useMemo(() => {
    const f: Record<string, unknown> = { search: search || undefined, limit: 500 };
    if (typeId !== "all") f.task_type_id = [typeId];
    if (statusFilter === "all") {
      // no status filter
    } else if (statusFilter === "open") {
      f.status = ["open", "in_progress"];
    } else {
      f.status = [statusFilter];
    }
    return f;
  }, [search, typeId, statusFilter]);

  const { data: tasks = [], isLoading } = useCrmTasks(baseFilters);

  const byBucket = useMemo(() => {
    const now = Date.now();
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const dayAfter = new Date(tomorrowStart);
    dayAfter.setDate(dayAfter.getDate() + 1);
    const weekEnd = new Date(now + 7 * 24 * 3600 * 1000);
    const groups: Record<CrmTaskBucket, CrmTask[]> = {
      overdue: [],
      today: [],
      tomorrow: [],
      week: [],
      later: [],
      no_due: [],
      closed: [],
    };
    for (const t of tasks) {
      if (t.status === "done" || t.status === "canceled") {
        groups.closed.push(t);
        continue;
      }
      if (!t.due_at) {
        groups.no_due.push(t);
        continue;
      }
      const due = parseISO(t.due_at).getTime();
      if (due < now) groups.overdue.push(t);
      else if (due < tomorrowStart.getTime()) groups.today.push(t);
      else if (due < dayAfter.getTime()) groups.tomorrow.push(t);
      else if (due < weekEnd.getTime()) groups.week.push(t);
      else groups.later.push(t);
    }
    return groups;
  }, [tasks]);

  const [createOpen, setCreateOpen] = useState(false);

  return (
    <div className="space-y-4 p-4">
      <div className="flex flex-wrap items-center gap-2 justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Задачи</h1>
          <p className="text-sm text-muted-foreground">
            Прозвоны, встречи, контроль оплат и другие задачи команды
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setCreateOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            Новая задача
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[240px] max-w-md">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Поиск по заголовку, описанию, TASK-..."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Select value={typeId} onValueChange={setTypeId}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Тип" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все типы</SelectItem>
            {types.map((t) => (
              <SelectItem key={t.id} value={t.id}>
                {t.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as never)}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="open">Активные</SelectItem>
            <SelectItem value="all">Все</SelectItem>
            <SelectItem value="done">Готово</SelectItem>
            <SelectItem value="canceled">Отменённые</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Tabs value={view} onValueChange={(v) => setView(v as "list" | "board")}>
        <TabsList>
          <TabsTrigger value="list">
            <LayoutList className="h-4 w-4 mr-1" />
            Список
          </TabsTrigger>
          <TabsTrigger value="board">
            <Columns3 className="h-4 w-4 mr-1" />
            Доска
          </TabsTrigger>
        </TabsList>

        <TabsContent value="list" className="mt-4">
          {isLoading ? (
            <div className="text-sm text-muted-foreground">Загрузка…</div>
          ) : tasks.length === 0 ? (
            <div className="text-sm text-muted-foreground">Задач не найдено</div>
          ) : (
            <div className="space-y-2">
              {tasks.map((t) => (
                <TaskCard
                  key={t.id}
                  task={t}
                  typeLabel={typeMap[t.task_type_id]?.label ?? "Задача"}
                  typeIcon={typeMap[t.task_type_id]?.icon ?? null}
                />
              ))}
            </div>
          )}
        </TabsContent>

        <TabsContent value="board" className="mt-4">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
            {BUCKETS.map((b) => (
              <div key={b.id} className="bg-muted/30 rounded-md p-2 min-h-[200px]">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold uppercase text-muted-foreground">
                    {b.label}
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    {byBucket[b.id].length}
                  </Badge>
                </div>
                <div>
                  {byBucket[b.id].map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      typeLabel={typeMap[t.task_type_id]?.label ?? "Задача"}
                      typeIcon={typeMap[t.task_type_id]?.icon ?? null}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </TabsContent>
      </Tabs>

      <CreateCrmTaskDialog open={createOpen} onOpenChange={setCreateOpen} />
    </div>
  );
}
