import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, PlayCircle, XCircle } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import {
  useCrmTaskTypes,
  useUpdateCrmTask,
  useUpdateCrmTaskStatus,
  type CrmTask,
  type CrmTaskStatus,
} from "@/hooks/useCrmTasks";
import { useStaffOptions } from "@/hooks/useStaffOptions";
import { DateTimePickerField } from "./DateTimePickerField";
import { StaffOptionRow } from "./StaffOptionRow";
import { TaskRelationsField } from "./TaskRelationsField";
import {
  RemindOffsetSelect,
  computeRemindAt,
  inferOffsetMinutes,
} from "./RemindOffsetSelect";

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
import { cn } from "@/lib/utils";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  task: CrmTask | null;
}

const UNASSIGNED = "__unassigned__";

export function EditCrmTaskDialog({ open, onOpenChange, task }: Props) {
  const { data: types = [] } = useCrmTaskTypes();
  const { data: staff = [] } = useStaffOptions();
  const update = useUpdateCrmTask();
  const updateStatus = useUpdateCrmTaskStatus();

  const [typeId, setTypeId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [remindOffset, setRemindOffset] = useState<number | null>(null);
  const [assignee, setAssignee] = useState<string>(UNASSIGNED);
  const [result, setResult] = useState("");
  const [commentError, setCommentError] = useState<string | null>(null);
  const [dealId, setDealId] = useState<string | null>(null);
  const [contactId, setContactId] = useState<string | null>(null);

  useEffect(() => {
    if (!task || !open) return;
    setTypeId(task.task_type_id);
    setTitle(task.title ?? "");
    setDescription(task.description ?? "");
    setDueAt(task.due_at ?? "");
    setRemindAt(task.remind_at ?? "");
    setAssignee(task.assignee_user_id ?? UNASSIGNED);
    setResult(task.result_comment ?? "");
    setCommentError(null);
    setDealId(task.deal_id ?? null);
    setContactId(task.contact_id ?? null);
  }, [task, open]);

  if (!task) return null;

  const currentStatus = task.status;
  const isPending = update.isPending || updateStatus.isPending;
  const canSave = !!title.trim() && !!typeId && !isPending;

  const buildPatch = () => ({
    task_type_id: typeId,
    title: title.trim(),
    description: description.trim() || null,
    due_at: dueAt || null,
    remind_at: remindAt || null,
    assignee_user_id: assignee === UNASSIGNED ? null : assignee,
    result_comment: result.trim() || null,
    deal_id: dealId,
    contact_id: contactId,
  });

  // Save: persist field edits without changing status.
  const handleSave = async () => {
    if (!canSave) return;
    await update.mutateAsync({ taskId: task.id, patch: buildPatch() });
    onOpenChange(false);
  };

  // Transition to a new status. For done/canceled requires non-empty comment.
  const handleStatusTransition = async (next: CrmTaskStatus) => {
    if (!canSave) return;
    const requiresComment = next === "done" || next === "canceled";
    if (requiresComment && !result.trim()) {
      setCommentError(
        next === "done"
          ? "Укажите результат — что сделано."
          : "Укажите причину отмены задачи.",
      );
      return;
    }
    setCommentError(null);
    // 1. Persist field edits first
    await update.mutateAsync({ taskId: task.id, patch: buildPatch() });
    // 2. Then transition status
    await updateStatus.mutateAsync({
      taskId: task.id,
      status: next,
      resultComment: result.trim() || undefined,
    });
    onOpenChange(false);
  };

  const showInProgress = currentStatus !== "in_progress" && currentStatus !== "done" && currentStatus !== "canceled";
  const showDone = currentStatus !== "done";
  const showCancel = currentStatus !== "canceled";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-lg", TASK_DIALOG_GLASS)}>
        <DialogHeader>
          <div className="flex items-center justify-between gap-3 pr-6">
            <DialogTitle>Редактировать задачу</DialogTitle>
            <Badge
              variant="outline"
              className={cn(
                "text-[11px] backdrop-blur-sm",
                TASK_STATUS_BADGE[currentStatus],
              )}
            >
              {TASK_STATUS_LABEL[currentStatus]}
            </Badge>
          </div>
        </DialogHeader>

        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          <div className={TASK_DIALOG_SECTION}>
            <div className="space-y-1">
              <Label>Тип</Label>
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger className="bg-white/80">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {types.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1">
              <Label>Название</Label>
              <Input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="bg-white/80"
              />
            </div>

            <div className="space-y-1">
              <Label>Описание</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                className="bg-white/80"
              />
            </div>
          </div>

          <div className={TASK_DIALOG_SECTION}>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Дедлайн</Label>
                <DateTimePickerField value={dueAt} onChange={setDueAt} />
              </div>
              <div className="space-y-1">
                <Label>Напомнить</Label>
                <DateTimePickerField value={remindAt} onChange={setRemindAt} />
              </div>
            </div>
          </div>

          <div className={TASK_DIALOG_SECTION}>
            <div className="space-y-1">
              <Label>Ответственный</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger className="bg-white/80 h-auto py-1.5">
                  <SelectValue placeholder="Не назначен" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>Не назначен</SelectItem>
                  {staff.map((s) => (
                    <SelectItem key={s.user_id} value={s.user_id}>
                      <StaffOptionRow staff={s} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {assignee !== UNASSIGNED &&
              !staff.find((s) => s.user_id === assignee)?.telegram_linked ? (
                <p className="text-[11px] text-amber-700">
                  У сотрудника не привязан Telegram — уведомление о задаче не дойдёт.
                </p>
              ) : null}
            </div>
          </div>

          <TaskRelationsField
            dealId={dealId}
            contactId={contactId}
            onChangeDeal={setDealId}
            onChangeContact={setContactId}
          />


          <div className={TASK_DIALOG_SECTION}>
            <div className="space-y-1">
              <Label>
                Результат / комментарий{" "}
                <span className="text-[11px] text-muted-foreground font-normal">
                  (обязателен при «Готово» или «Отменить задачу»)
                </span>
              </Label>
              <Textarea
                value={result}
                onChange={(e) => {
                  setResult(e.target.value);
                  if (commentError && e.target.value.trim()) setCommentError(null);
                }}
                rows={3}
                placeholder="Что сделано / причина отмены…"
                className={cn(
                  "bg-white/80",
                  commentError && "border-rose-400 ring-1 ring-rose-300",
                )}
              />
              {commentError ? (
                <p className="text-[11px] text-rose-600">{commentError}</p>
              ) : null}
            </div>
          </div>
        </div>

        <DialogFooter className="flex flex-row flex-wrap items-center gap-2 pt-2 w-full">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
            className="h-8 px-3 text-xs"
          >
            Отмена
          </Button>
          <div className="flex flex-row flex-wrap items-center gap-2 ml-auto">
            {showCancel && (
              <Button
                size="sm"
                onClick={() => handleStatusTransition("canceled")}
                disabled={!canSave}
                className={cn("h-8 px-3 text-xs font-medium rounded-lg", TASK_DIALOG_CANCEL_CTA)}
              >
                <XCircle className="h-3.5 w-3.5 mr-1" />
                Отменить задачу
              </Button>
            )}
            {showInProgress && (
              <Button
                size="sm"
                onClick={() => handleStatusTransition("in_progress")}
                disabled={!canSave}
                className={cn("h-8 px-3 text-xs font-medium rounded-lg", TASK_DIALOG_INPROGRESS_CTA)}
              >
                <PlayCircle className="h-3.5 w-3.5 mr-1" />
                В работу
              </Button>
            )}
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!canSave}
              className={cn("h-8 px-3 text-xs font-medium rounded-lg", TASK_DIALOG_SAVE_CTA)}
            >
              Сохранить
            </Button>
            {showDone && (
              <Button
                size="sm"
                onClick={() => handleStatusTransition("done")}
                disabled={!canSave}
                className={cn("h-8 px-3 text-xs font-medium rounded-lg", TASK_DIALOG_DONE_CTA)}
              >
                <CheckCircle2 className="h-3.5 w-3.5 mr-1" />
                Готово
              </Button>
            )}
          </div>
        </DialogFooter>

      </DialogContent>
    </Dialog>
  );
}
