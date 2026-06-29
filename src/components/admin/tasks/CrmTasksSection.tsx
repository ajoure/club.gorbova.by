import { useState } from "react";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import {
  Plus,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Phone,
  MessageCircle,
  Calendar,
  CreditCard,
  Briefcase,
  Database,
  CircleDot,
  Pencil,
} from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useCrmTaskTypes,
  useCrmTasks,
  useUpdateCrmTaskStatus,
  type CrmTask,
  type CrmTaskListFilters,
} from "@/hooks/useCrmTasks";
import { CreateCrmTaskDialog } from "./CreateCrmTaskDialog";
import { EditCrmTaskDialog } from "./EditCrmTaskDialog";

const TYPE_ICONS: Record<string, typeof CircleDot> = {
  Phone,
  MessageCircle,
  Calendar,
  CreditCard,
  Briefcase,
  Database,
  CircleDot,
};

interface Props {
  /** When set, lists tasks bound to a deal (orders_v2.id) */
  dealId?: string | null;
  /** When set, lists tasks bound to a contact (profiles.id) */
  contactId?: string | null;
  /** Optional override title */
  title?: string;
  /** Show as Card (default) or as bare list */
  bare?: boolean;
}

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

export function CrmTasksSection({ dealId, contactId, title, bare }: Props) {
  const filters: CrmTaskListFilters = {
    deal_id: dealId ?? null,
    contact_id: contactId ?? null,
    limit: 100,
  };
  const { data: tasks = [], isLoading } = useCrmTasks(filters);
  const { data: types = [] } = useCrmTaskTypes();
  const typeMap = Object.fromEntries(types.map((t) => [t.id, t]));
  const updateStatus = useUpdateCrmTaskStatus();
  const [createOpen, setCreateOpen] = useState(false);
  const [editTask, setEditTask] = useState<CrmTask | null>(null);

  const openTasks = tasks.filter((t) => t.status === "open" || t.status === "in_progress");
  const closedTasks = tasks.filter((t) => t.status === "done" || t.status === "canceled");

  const renderTask = (t: CrmTask) => {
    const tt = typeMap[t.task_type_id];
    const Icon = TYPE_ICONS[tt?.icon ?? "CircleDot"] ?? CircleDot;
    const overdue = isOverdue(t);
    return (
      <div
        key={t.id}
        className="flex items-start gap-2 rounded-md border border-border/50 bg-card p-2 hover:bg-muted/30 transition"
      >
        <Icon className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <button
              type="button"
              onClick={() => setEditTask(t)}
              className="text-sm font-medium text-left hover:underline truncate"
            >
              {t.title}
            </button>
            {t.public_id ? (
              <span className="text-[10px] font-mono text-muted-foreground shrink-0">
                {t.public_id}
              </span>
            ) : null}
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
            <span className="inline-flex items-center gap-1">
              {overdue ? (
                <AlertTriangle className="h-3 w-3 text-destructive" />
              ) : (
                <Clock className="h-3 w-3" />
              )}
              <span className={overdue ? "text-destructive" : ""}>
                {formatDue(t.due_at)}
              </span>
            </span>
            <span>·</span>
            <span>{tt?.label ?? "Задача"}</span>
            {t.status === "in_progress" ? (
              <Badge variant="secondary" className="text-[10px]">в работе</Badge>
            ) : null}
            {t.status === "canceled" ? (
              <Badge variant="outline" className="text-[10px]">отменена</Badge>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {t.status !== "done" && t.status !== "canceled" ? (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 w-7 p-0"
              title="Готово"
              onClick={() => updateStatus.mutate({ taskId: t.id, status: "done" })}
              disabled={updateStatus.isPending}
            >
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 w-7 p-0"
            title="Изменить"
            onClick={() => setEditTask(t)}
          >
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
    );
  };

  const body = (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs text-muted-foreground">
          {isLoading
            ? "Загрузка…"
            : `Открыто: ${openTasks.length} · Закрыто: ${closedTasks.length}`}
        </div>
        <Button size="sm" variant="outline" onClick={() => setCreateOpen(true)}>
          <Plus className="h-3.5 w-3.5 mr-1" />Задача
        </Button>
      </div>

      {!isLoading && tasks.length === 0 ? (
        <div className="text-sm text-muted-foreground py-4 text-center">
          Задач пока нет
        </div>
      ) : (
        <div className="space-y-1.5">
          {openTasks.map(renderTask)}
          {closedTasks.length > 0 ? (
            <div className="pt-2">
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                Закрытые
              </div>
              <div className="space-y-1.5 opacity-70">{closedTasks.map(renderTask)}</div>
            </div>
          ) : null}
        </div>
      )}

      <CreateCrmTaskDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        defaultDealId={dealId ?? null}
        defaultContactId={contactId ?? null}
      />
      <EditCrmTaskDialog
        open={!!editTask}
        onOpenChange={(v) => !v && setEditTask(null)}
        task={editTask}
      />
    </div>
  );

  if (bare) return body;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm text-muted-foreground flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4" />
          {title ?? "Задачи"}
        </CardTitle>
      </CardHeader>
      <CardContent>{body}</CardContent>
    </Card>
  );
}
