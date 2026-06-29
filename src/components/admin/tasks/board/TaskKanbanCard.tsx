import { memo } from "react";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import {
  AlertTriangle,
  Bell,
  Briefcase,
  Calendar as CalendarIcon,
  CheckSquare,
  CircleDot,
  Clock,
  CreditCard,
  Database,
  MessageCircle,
  Phone,
  User as UserIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { CrmTask, CrmTaskType } from "@/hooks/useCrmTasks";
import type { StaffOption } from "@/hooks/useStaffOptions";
import type { TaskContactLite, TaskDealLite } from "@/hooks/useTaskRelations";
import {
  TASK_BUCKET_THEME,
  TASK_CARD_GLASS,
  TASK_CARD_PILL,
  type TaskBucketId,
} from "../taskUiTheme";

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

const STATUS_VARIANTS: Record<CrmTask["status"], string> = {
  open: "bg-sky-100 text-sky-800 border-sky-200",
  in_progress: "bg-amber-100 text-amber-800 border-amber-200",
  done: "bg-emerald-100 text-emerald-800 border-emerald-200",
  canceled: "bg-muted text-muted-foreground border-border",
};

function formatDue(dt: string | null) {
  if (!dt) return "Без срока";
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

function initials(name?: string | null) {
  if (!name) return "—";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? "").join("") || "—";
}

interface Props {
  task: CrmTask;
  type: CrmTaskType | null;
  assignee: StaffOption | null;
  deal: TaskDealLite | null;
  contact: TaskContactLite | null;
  bucketId?: TaskBucketId;
  onOpen: (task: CrmTask) => void;
  onOpenDeal?: (dealId: string) => void;
}

export const TaskKanbanCard = memo(function TaskKanbanCard({
  task,
  type,
  assignee,
  deal,
  contact,
  bucketId = "later",
  onOpen,
  onOpenDeal,
}: Props) {
  const Icon = TYPE_ICONS[type?.icon ?? "CircleDot"] ?? CircleDot;
  const accent = type?.color || "#6366f1";
  const overdue = isOverdue(task);
  const theme = TASK_BUCKET_THEME[bucketId];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen(task)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onOpen(task);
        }
      }}
      className={cn(
        TASK_CARD_GLASS,
        theme.cardGradient,
        theme.ring,
        "p-3 mb-2 cursor-pointer",
        overdue && "ring-2 ring-rose-300/70",
      )}
    >
      {/* Left accent stripe by type color */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{
          backgroundColor: accent,
          boxShadow: `0 0 12px 0 ${accent}55`,
        }}
        aria-hidden
      />

      <div className="pl-2 space-y-2">
        {/* Header: type label only — public_id скрыт по требованию UX */}
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: accent }} />
          <span className="text-[11px] font-medium text-muted-foreground truncate">
            {type?.label ?? "Задача"}
          </span>
        </div>

        {/* Title */}
        <div className="text-sm font-medium leading-snug line-clamp-2">
          {task.title}
        </div>

        {/* Description */}
        {task.description ? (
          <div className="text-xs text-muted-foreground line-clamp-1">
            {task.description}
          </div>
        ) : null}


        {/* Due & reminder */}
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              TASK_CARD_PILL,
              overdue
                ? "bg-rose-100/80 text-rose-700 border-rose-200/70 font-medium"
                : "text-muted-foreground",
            )}
          >
            {overdue ? (
              <AlertTriangle className="h-3 w-3" />
            ) : (
              <Clock className="h-3 w-3" />
            )}
            {formatDue(task.due_at)}
          </span>
          {task.remind_at ? (
            <span className={cn(TASK_CARD_PILL, "text-muted-foreground")}>
              <Bell className="h-3 w-3" />
              {formatDue(task.remind_at)}
            </span>
          ) : null}
        </div>

        {/* Relations */}
        {(deal || contact) && (
          <div className="flex flex-wrap items-center gap-1.5">
            {deal ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  if (onOpenDeal) onOpenDeal(deal.id);
                }}
                className={cn(TASK_CARD_PILL, "font-mono hover:bg-white")}
                title="Открыть сделку"
              >
                <Briefcase className="h-3 w-3" />
                {deal.public_id ?? deal.id.slice(0, 8)}
              </button>
            ) : null}
            {contact ? (
              <span className={cn(TASK_CARD_PILL, "max-w-[160px] truncate")}>
                <UserIcon className="h-3 w-3" />
                <span className="truncate">
                  {contact.full_name || contact.email || contact.phone || "Контакт"}
                </span>
              </span>
            ) : null}
          </div>
        )}

        {/* Footer: assignee + status */}
        <div className="flex items-center justify-between gap-2 pt-1">
          <div className="flex items-center gap-1.5 min-w-0">
            <div
              className="h-6 w-6 rounded-full flex items-center justify-center text-[10px] font-semibold text-white shrink-0 shadow-sm"
              style={{
                background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
              }}
              title={assignee?.label ?? "Не назначен"}
            >
              {initials(assignee?.label)}
            </div>
            <span className="text-[11px] text-muted-foreground truncate">
              {assignee?.label ?? "Не назначен"}
            </span>
          </div>
          <Badge
            variant="outline"
            className={cn("text-[10px] px-1.5 py-0 bg-white/70 backdrop-blur-sm", STATUS_VARIANTS[task.status])}
          >
            {STATUS_LABELS[task.status]}
          </Badge>
        </div>

      </div>
    </div>
  );
});
