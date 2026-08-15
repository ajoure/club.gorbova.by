/**
 * ViewCrmTaskDialog — read-only «паспорт» задачи.
 * Открывается по клику на карточку задачи. Никакие поля не редактируются
 * и не сохраняются при открытии/закрытии; переход в редактор — только по
 * явной кнопке «Редактировать».
 *
 * Быстрые действия: «В работу / Готово / Отменить» — используют общий
 * useUpdateCrmTaskStatus, без изменения полей задачи. Для «Готово/Отменить»
 * (требуют комментарий) диалог просто открывает редактор, чтобы пользователь
 * ввёл результат в существующей форме.
 */
import { useMemo } from "react";
import { format, parseISO } from "date-fns";
import { ru } from "date-fns/locale";
import {
  AlertTriangle,
  Bell,
  Briefcase,
  Calendar as CalendarIcon,
  CheckCircle2,
  CheckSquare,
  CircleDot,
  Clock,
  CreditCard,
  Database,
  Mail,
  MessageCircle,
  Pencil,
  Phone,
  PlayCircle,
  User as UserIcon,
  XCircle,
} from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import {
  useCrmTaskTypes,
  useUpdateCrmTaskStatus,
  type CrmTask,
} from "@/hooks/useCrmTasks";
import { useStaffOptions } from "@/hooks/useStaffOptions";
import { useTaskRelations } from "@/hooks/useTaskRelations";
import { normalizeCompanyName } from "@/lib/companies/normalizeCompanyName";
import { useAdminAccess } from "@/hooks/useAdminAccess";

import {
  TASK_DIALOG_GLASS,
  TASK_DIALOG_SECTION,
  TASK_DIALOG_SAVE_CTA,
  TASK_DIALOG_DONE_CTA,
  TASK_DIALOG_CANCEL_CTA,
  TASK_DIALOG_INPROGRESS_CTA,
  TASK_STATUS_BADGE,
  TASK_STATUS_LABEL,
} from "./taskUiTheme";

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

function fmtDT(dt: string | null) {
  if (!dt) return "—";
  try {
    return format(parseISO(dt), "d MMMM yyyy, HH:mm", { locale: ru });
  } catch {
    return dt;
  }
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  task: CrmTask | null;
  onEdit: (task: CrmTask) => void;
  /** Открывает ContactDetailSheet поверх страницы. Передаётся из AdminTasks. */
  onOpenContact?: (contactUserOrProfileId: string) => void;
  /** Открывает CompanyDetailsSheet поверх страницы. */
  onOpenCompany?: (companyId: string) => void;
  onOpenDeal?: (dealId: string) => void;
}

export function ViewCrmTaskDialog({
  open,
  onOpenChange,
  task,
  onEdit,
  onOpenContact,
  onOpenCompany,
  onOpenDeal,
}: Props) {
  const { data: types = [] } = useCrmTaskTypes();
  const { data: staff = [] } = useStaffOptions();
  const updateStatus = useUpdateCrmTaskStatus();
  const access = useAdminAccess();
  const canEdit = access.canAccessSection("deals", "edit");

  const relations = useTaskRelations(
    task?.deal_id ? [task.deal_id] : [],
    task?.contact_id ? [task.contact_id] : [],
    task?.company_id ? [task.company_id] : [],
  );

  const type = useMemo(
    () => types.find((t) => t.id === task?.task_type_id) ?? null,
    [types, task?.task_type_id],
  );
  const assignee = useMemo(
    () => (task?.assignee_user_id ? staff.find((s) => s.user_id === task.assignee_user_id) ?? null : null),
    [staff, task?.assignee_user_id],
  );

  if (!task) return null;

  const Icon = TYPE_ICONS[type?.icon ?? "CircleDot"] ?? CircleDot;
  const accent = type?.color || "#059669";
  const overdue =
    (task.status === "open" || task.status === "in_progress") &&
    !!task.due_at &&
    parseISO(task.due_at).getTime() < Date.now();

  const deal = task.deal_id ? relations.deals[task.deal_id] ?? null : null;
  const contact = task.contact_id ? relations.contacts[task.contact_id] ?? null : null;
  const company = task.company_id ? relations.companies[task.company_id] ?? null : null;

  // Fallback контакта из snapshot сделки, если contact_id по какой-то
  // причине не разрешился (например, историческая лид-задача).
  const dealContactName = deal?.contact_name ?? null;
  const contactName =
    contact?.full_name || contact?.email || contact?.phone || dealContactName || null;
  const contactEmail = contact?.email ?? null;
  const contactPhone = contact?.phone ?? null;
  const contactOpenId = task.contact_id || null;

  const showInProgress =
    task.status !== "in_progress" && task.status !== "done" && task.status !== "canceled";
  const showDone = task.status !== "done";
  const showCancel = task.status !== "canceled";

  const handleQuickInProgress = async () => {
    await updateStatus.mutateAsync({ taskId: task.id, status: "in_progress" });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-xl p-0 overflow-hidden", TASK_DIALOG_GLASS)}>
        {/* Header */}
        <div
          className="px-5 pt-5 pb-4 border-b border-white/50"
          style={{
            background: `linear-gradient(135deg, ${accent}18, transparent 60%)`,
          }}
        >
          <DialogHeader className="pr-10">
            <div className="flex items-center gap-2 mb-2">
              <div
                className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 shadow-sm"
                style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}
              >
                <Icon className="h-4 w-4 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {type?.label ?? "Задача"}
                </div>
                <DialogTitle className="text-base font-semibold leading-tight truncate">
                  {task.title}
                </DialogTitle>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "text-[11px] font-normal backdrop-blur-sm shrink-0",
                  TASK_STATUS_BADGE[task.status],
                )}
              >
                {TASK_STATUS_LABEL[task.status]}
              </Badge>
            </div>
          </DialogHeader>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-3 max-h-[65vh] overflow-y-auto">
          {/* Дедлайн / напоминание */}
          <div className={cn(TASK_DIALOG_SECTION, "!py-2.5")}>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
                  Дедлайн
                </div>
                <div className={cn("flex items-center gap-1.5", overdue && "text-rose-700 font-medium")}>
                  {overdue ? (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  ) : (
                    <Clock className="h-3.5 w-3.5 text-muted-foreground" />
                  )}
                  {fmtDT(task.due_at)}
                </div>
              </div>
              <div>
                <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
                  Напоминание
                </div>
                <div className="flex items-center gap-1.5">
                  <Bell className="h-3.5 w-3.5 text-muted-foreground" />
                  {fmtDT(task.remind_at)}
                </div>
              </div>
            </div>
          </div>

          {/* Контакт */}
          {(contactName || contactEmail || contactPhone) && (
            <div className={TASK_DIALOG_SECTION}>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Контакт
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <UserIcon className="h-4 w-4 text-muted-foreground shrink-0" />
                {contactOpenId && onOpenContact ? (
                  <button
                    type="button"
                    onClick={() => onOpenContact(contactOpenId)}
                    className="text-sm font-medium text-emerald-800 hover:text-emerald-900 hover:underline underline-offset-2"
                  >
                    {contactName ?? "Открыть карточку контакта"}
                  </button>
                ) : (
                  <span className="text-sm font-medium">{contactName ?? "—"}</span>
                )}
              </div>
              {(contactPhone || contactEmail) && (
                <div className="flex flex-wrap items-center gap-2">
                  {contactPhone ? (
                    <a
                      href={`tel:${contactPhone}`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-white/70 hover:bg-white border border-white/70 px-2.5 py-1 text-xs shadow-sm"
                    >
                      <Phone className="h-3 w-3 text-emerald-700" />
                      {contactPhone}
                    </a>
                  ) : null}
                  {contactEmail ? (
                    <a
                      href={`mailto:${contactEmail}`}
                      className="inline-flex items-center gap-1.5 rounded-full bg-white/70 hover:bg-white border border-white/70 px-2.5 py-1 text-xs shadow-sm"
                    >
                      <Mail className="h-3 w-3 text-teal-700" />
                      {contactEmail}
                    </a>
                  ) : null}
                </div>
              )}
            </div>
          )}

          {task.company_id && (
            <div className={TASK_DIALOG_SECTION}>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Компания
              </div>
              {company ? (
                <button
                  type="button"
                  onClick={() => onOpenCompany?.(company.id)}
                  disabled={!onOpenCompany}
                  className={cn(
                    "w-full text-left rounded-lg bg-white/60 border border-white/70 px-3 py-2 flex items-center gap-3 shadow-sm",
                    onOpenCompany && "hover:bg-white cursor-pointer",
                  )}
                >
                  <Briefcase className="h-4 w-4 text-sky-700 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">
                      {normalizeCompanyName(company.full_name) || "Компания без названия"}
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {company.public_id || company.email || company.phone || "Открыть карточку компании"}
                    </div>
                  </div>
                </button>
              ) : (
                <div className="text-sm text-muted-foreground">Компания недоступна</div>
              )}
            </div>
          )}

          {/* Сделка */}
          {deal && (
            <div className={TASK_DIALOG_SECTION}>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Сделка
              </div>
              <button
                type="button"
                onClick={() => onOpenDeal?.(deal.id)}
                disabled={!onOpenDeal}
                className={cn(
                  "w-full text-left rounded-lg bg-white/60 border border-white/70 px-3 py-2 flex items-center gap-3 shadow-sm",
                  onOpenDeal && "hover:bg-white cursor-pointer",
                )}
              >
                <Briefcase className="h-4 w-4 text-emerald-700 shrink-0" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium truncate">
                    {deal.contact_name || dealContactName || "Без контакта"}
                  </div>
                  <div className="text-[11px] text-muted-foreground truncate">
                    {deal.product_name || deal.public_id || deal.id.slice(0, 8)}
                  </div>
                </div>
                {deal.public_id ? (
                  <Badge variant="outline" className="font-mono text-[10px]">
                    {deal.public_id}
                  </Badge>
                ) : null}
              </button>
            </div>
          )}

          {/* Ответственный */}
          <div className={TASK_DIALOG_SECTION}>
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Ответственный
            </div>
            <div className="flex items-center gap-2">
              <div
                className="h-7 w-7 rounded-full flex items-center justify-center text-[11px] font-semibold text-white shadow-sm"
                style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}
              >
                {(assignee?.label ?? "—")
                  .split(/\s+/)
                  .slice(0, 2)
                  .map((s) => s[0]?.toUpperCase() ?? "")
                  .join("") || "—"}
              </div>
              <span className="text-sm">{assignee?.label ?? "Не назначен"}</span>
              {assignee && !assignee.telegram_linked ? (
                <span className="text-[11px] text-amber-700">· Telegram не привязан</span>
              ) : null}
            </div>
          </div>

          {/* Описание (только если непустое) */}
          {task.description && task.description.trim() ? (
            <div className={TASK_DIALOG_SECTION}>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Описание
              </div>
              <div className="text-sm whitespace-pre-wrap leading-relaxed">
                {task.description}
              </div>
            </div>
          ) : null}

          {/* Результат / комментарий */}
          {task.result_comment && task.result_comment.trim() ? (
            <div className={TASK_DIALOG_SECTION}>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Результат
              </div>
              <div className="text-sm whitespace-pre-wrap leading-relaxed">
                {task.result_comment}
              </div>
            </div>
          ) : null}

          {/* Аудит */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground pt-1">
            <span>Создана: {fmtDT(task.created_at)}</span>
            <span>Обновлена: {fmtDT(task.updated_at)}</span>
            {task.source ? <span>Источник: {task.source}</span> : null}
          </div>
        </div>

        {/* Footer */}
        {canEdit && <DialogFooter className="px-5 py-3 border-t border-white/50 bg-white/30 flex flex-row flex-nowrap items-center justify-end gap-2 overflow-x-auto">
          {showCancel && (
            <Button
              size="sm"
              onClick={() => onEdit(task)}
              disabled={updateStatus.isPending}
              className={cn("h-9 px-2.5 text-xs font-medium rounded-lg shrink-0", TASK_DIALOG_CANCEL_CTA)}
              title="Отменить (нужно указать причину)"
            >
              <XCircle className="h-3.5 w-3.5 mr-1" />
              Отменить
            </Button>
          )}
          {showInProgress && (
            <Button
              size="sm"
              onClick={handleQuickInProgress}
              disabled={updateStatus.isPending}
              className={cn("h-9 px-2.5 text-xs font-medium rounded-lg shrink-0", TASK_DIALOG_INPROGRESS_CTA)}
            >
              <PlayCircle className="h-3.5 w-3.5 mr-1" />
              В работу
            </Button>
          )}
          <Button
            size="sm"
            onClick={() => onEdit(task)}
            className={cn("h-9 px-3 text-xs font-medium rounded-lg shrink-0", TASK_DIALOG_SAVE_CTA)}
          >
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Редактировать
          </Button>
          {showDone && (
            <Button
              size="sm"
              onClick={() => onEdit(task)}
              disabled={updateStatus.isPending}
              className={cn("h-9 px-2.5 text-xs font-medium rounded-lg shrink-0", TASK_DIALOG_DONE_CTA)}
              title="Готово (нужно указать результат)"
            >
              <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
              Готово
            </Button>
          )}
        </DialogFooter>}
      </DialogContent>
    </Dialog>
  );
}
