import { useMemo, useState, useEffect } from "react";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import {
  AlertTriangle,
  Briefcase,
  Calendar as CalendarIcon,
  CheckSquare,
  CircleDot,
  CreditCard,
  Database,
  MessageCircle,
  Phone,
  User as UserIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import {
  useUpdateCrmTaskStatus,
  type CrmTask,
  type CrmTaskType,
} from "@/hooks/useCrmTasks";
import { useStaffOptions } from "@/hooks/useStaffOptions";
import { useTaskRelations } from "@/hooks/useTaskRelations";
import { normalizeCompanyName } from "@/lib/companies/normalizeCompanyName";
import { TasksBulkActionsBar } from "./TasksBulkActionsBar";
import { useAdminAccess } from "@/hooks/useAdminAccess";

const TYPE_ICONS: Record<string, typeof CircleDot> = {
  Phone,
  MessageCircle,
  Calendar: CalendarIcon,
  CreditCard,
  Briefcase,
  Database,
  CheckSquare,
  CircleDot,
};

const STATUS_LABELS: Record<CrmTask["status"], string> = {
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

function isOverdue(task: CrmTask) {
  return (
    (task.status === "open" || task.status === "in_progress") &&
    !!task.due_at &&
    parseISO(task.due_at).getTime() < Date.now()
  );
}

interface Props {
  tasks: CrmTask[];
  types: CrmTaskType[];
  onOpenTask: (task: CrmTask) => void;
  onOpenCompany?: (companyId: string) => void;
}

export function TasksListView({ tasks, types, onOpenTask, onOpenCompany }: Props) {
  const access = useAdminAccess();
  const canEdit = access.canAccessSection("deals", "edit");
  const typeMap = useMemo(() => Object.fromEntries(types.map((t) => [t.id, t])), [types]);
  const { data: staff = [] } = useStaffOptions();
  const staffMap = useMemo(
    () => Object.fromEntries(staff.map((s) => [s.user_id, s])),
    [staff],
  );
  const dealIds = useMemo(
    () => tasks.map((t) => t.deal_id).filter((x): x is string => !!x),
    [tasks],
  );
  const contactIds = useMemo(
    () => tasks.map((t) => t.contact_id).filter((x): x is string => !!x),
    [tasks],
  );
  const companyIds = useMemo(
    () => tasks.map((t) => t.company_id).filter((x): x is string => !!x),
    [tasks],
  );
  const { deals, contacts, companies } = useTaskRelations(dealIds, contactIds, companyIds);

  const updateStatus = useUpdateCrmTaskStatus();

  // Selection
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Reset selection that no longer exists in the current task slice.
  useEffect(() => {
    setSelected((prev) => {
      const ids = new Set(tasks.map((t) => t.id));
      const next = new Set<string>();
      prev.forEach((id) => ids.has(id) && next.add(id));
      return next.size === prev.size ? prev : next;
    });
  }, [tasks]);

  const allSelected = tasks.length > 0 && selected.size === tasks.length;
  const someSelected = selected.size > 0 && !allSelected;

  const toggleOne = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => (prev.size === tasks.length ? new Set() : new Set(tasks.map((t) => t.id))));

  if (tasks.length === 0) {
    return <div className="text-sm text-muted-foreground p-6 text-center">Задач не найдено</div>;
  }

  return (
    <div className="space-y-2">
      {canEdit && selected.size > 0 && (
        <TasksBulkActionsBar
          selectedIds={Array.from(selected)}
          types={types}
          onClear={() => setSelected(new Set())}
        />
      )}

      <div className="rounded-lg border border-border overflow-hidden bg-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[36px]">
                <Checkbox
                  disabled={!canEdit}
                  checked={allSelected ? true : someSelected ? "indeterminate" : false}
                  onCheckedChange={toggleAll}
                  aria-label="Выбрать все задачи на странице"
                />
              </TableHead>
              <TableHead className="w-[140px]">Дата</TableHead>
              <TableHead>Ответственный</TableHead>
              <TableHead>Тип</TableHead>
              <TableHead>Задача</TableHead>
              <TableHead>Контакт</TableHead>
              <TableHead>Сделка</TableHead>
              <TableHead>Компания</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {tasks.map((t) => {
              const tt = typeMap[t.task_type_id];
              const Icon = TYPE_ICONS[tt?.icon ?? "CircleDot"] ?? CircleDot;
              const assignee = t.assignee_user_id ? staffMap[t.assignee_user_id] : null;
              const deal = t.deal_id ? deals[t.deal_id] : null;
              const contact = t.contact_id ? contacts[t.contact_id] : null;
              const company = t.company_id ? companies[t.company_id] : null;
              const overdue = isOverdue(t);
              const checked = selected.has(t.id);
              return (
                <TableRow
                  key={t.id}
                  className={cn(
                    "cursor-pointer hover:bg-muted/40",
                    checked && "bg-primary/5",
                  )}
                  onClick={() => onOpenTask(t)}
                >
                  <TableCell
                    className="w-[36px]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Checkbox
                      disabled={!canEdit}
                      checked={checked}
                      onCheckedChange={() => toggleOne(t.id)}
                      aria-label="Выбрать задачу"
                    />
                  </TableCell>
                  <TableCell className={cn("whitespace-nowrap", overdue && "text-destructive font-medium")}>
                    {overdue ? (
                      <span className="inline-flex items-center gap-1">
                        <AlertTriangle className="h-3 w-3" />
                        {formatDue(t.due_at)}
                      </span>
                    ) : (
                      formatDue(t.due_at)
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {assignee?.label ?? <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-sm">
                      <Icon className="h-3.5 w-3.5" style={{ color: tt?.color || undefined }} />
                      {tt?.label ?? "Задача"}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[280px]">
                    <div className="text-sm font-medium truncate">{t.title}</div>
                  </TableCell>
                  <TableCell className="text-sm">
                    {contact ? (
                      <span className="inline-flex items-center gap-1">
                        <UserIcon className="h-3 w-3" />
                        {contact.full_name || contact.email || contact.phone || "Контакт"}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {deal ? (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        {deal.public_id ?? deal.id.slice(0, 8)}
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">
                    {company ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onOpenCompany?.(company.id); }}
                        disabled={!onOpenCompany}
                        className={cn("inline-flex max-w-[220px] items-center gap-1 truncate text-left", onOpenCompany && "text-primary hover:underline")}
                      >
                        <Briefcase className="h-3 w-3 shrink-0" />
                        <span className="truncate">{normalizeCompanyName(company.full_name) || company.public_id || "Компания"}</span>
                      </button>
                    ) : <span className="text-muted-foreground">—</span>}
                  </TableCell>
                  <TableCell>
                    <Badge variant="secondary" className="text-[10px]">
                      {STATUS_LABELS[t.status]}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                    {canEdit && t.status !== "done" && t.status !== "canceled" ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() =>
                          updateStatus.mutate({ taskId: t.id, status: "done" })
                        }
                        disabled={updateStatus.isPending}
                      >
                        Готово
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
