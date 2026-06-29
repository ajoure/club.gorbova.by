import { useState } from "react";
import {
  CheckCircle2,
  XCircle,
  PlayCircle,
  RotateCcw,
  UserCog,
  Tag as TagIcon,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import {
  useBulkUpdateCrmTaskStatus,
  useBulkUpdateCrmTask,
  type CrmTaskStatus,
  type CrmTaskType,
} from "@/hooks/useCrmTasks";
import { useStaffOptions } from "@/hooks/useStaffOptions";
import { StaffOptionRow } from "./StaffOptionRow";

interface Props {
  selectedIds: string[];
  types: CrmTaskType[];
  onClear: () => void;
}

type Mode =
  | { kind: "status"; status: CrmTaskStatus }
  | { kind: "assignee" }
  | { kind: "type" }
  | null;

const STATUS_BUTTONS: Array<{
  status: CrmTaskStatus;
  label: string;
  icon: typeof CheckCircle2;
  requiresComment: boolean;
  className: string;
}> = [
  { status: "in_progress", label: "В работу", icon: PlayCircle, requiresComment: false, className: "border-sky-200/70 bg-sky-50/70 text-sky-700 hover:bg-sky-100/80" },
  { status: "done", label: "Готово", icon: CheckCircle2, requiresComment: true, className: "border-emerald-200/70 bg-emerald-50/70 text-emerald-700 hover:bg-emerald-100/80" },
  { status: "canceled", label: "Отменить", icon: XCircle, requiresComment: true, className: "border-rose-200/70 bg-rose-50/70 text-rose-700 hover:bg-rose-100/80" },
  { status: "open", label: "Открыть", icon: RotateCcw, requiresComment: false, className: "border-slate-200/70 bg-slate-50/70 text-slate-700 hover:bg-slate-100/80" },
];

export function TasksBulkActionsBar({ selectedIds, types, onClear }: Props) {
  const [mode, setMode] = useState<Mode>(null);
  const [comment, setComment] = useState("");
  const [assigneeId, setAssigneeId] = useState<string>("");
  const [typeId, setTypeId] = useState<string>("");

  const { data: staff = [] } = useStaffOptions();
  const bulkStatus = useBulkUpdateCrmTaskStatus();
  const bulkUpdate = useBulkUpdateCrmTask();

  const closeDialog = () => {
    setMode(null);
    setComment("");
    setAssigneeId("");
    setTypeId("");
  };

  const handleStatusClick = (status: CrmTaskStatus, requiresComment: boolean) => {
    if (requiresComment) {
      setMode({ kind: "status", status });
      return;
    }
    bulkStatus.mutate(
      { taskIds: selectedIds, status, requestId: crypto.randomUUID() },
      { onSuccess: () => onClear() },
    );
  };

  const handleStatusConfirm = () => {
    if (mode?.kind !== "status") return;
    if (!comment.trim()) return;
    bulkStatus.mutate(
      {
        taskIds: selectedIds,
        status: mode.status,
        resultComment: comment.trim(),
        requestId: crypto.randomUUID(),
      },
      {
        onSuccess: () => {
          closeDialog();
          onClear();
        },
      },
    );
  };

  const handleAssigneeConfirm = () => {
    bulkUpdate.mutate(
      {
        taskIds: selectedIds,
        patch: { assignee_user_id: assigneeId || null },
        requestId: crypto.randomUUID(),
      },
      {
        onSuccess: () => {
          closeDialog();
          onClear();
        },
      },
    );
  };

  const handleTypeConfirm = () => {
    if (!typeId) return;
    bulkUpdate.mutate(
      {
        taskIds: selectedIds,
        patch: { task_type_id: typeId },
        requestId: crypto.randomUUID(),
      },
      {
        onSuccess: () => {
          closeDialog();
          onClear();
        },
      },
    );
  };

  const dialogOpen = mode !== null;
  const dialogTitle =
    mode?.kind === "status"
      ? mode.status === "done"
        ? "Закрыть задачи (требуется комментарий)"
        : "Отменить задачи (требуется комментарий)"
      : mode?.kind === "assignee"
        ? "Сменить ответственного"
        : mode?.kind === "type"
          ? "Сменить тип задач"
          : "";

  return (
    <>
      <div className="sticky top-0 z-20 flex flex-wrap items-center gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 backdrop-blur-md shadow-sm">
        <span className="text-sm font-medium mr-2">
          Выбрано: <b>{selectedIds.length}</b>
        </span>

        <div className="flex flex-wrap items-center gap-1.5">
          {STATUS_BUTTONS.map(({ status, label, icon: Icon, requiresComment, className }) => (
            <Button
              key={status}
              size="sm"
              variant="outline"
              className={`h-7 text-xs gap-1 ${className}`}
              onClick={() => handleStatusClick(status, requiresComment)}
              disabled={bulkStatus.isPending}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Button>
          ))}

          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={() => setMode({ kind: "assignee" })}
            disabled={bulkUpdate.isPending}
          >
            <UserCog className="h-3.5 w-3.5" />
            Ответственный
          </Button>

          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1"
            onClick={() => setMode({ kind: "type" })}
            disabled={bulkUpdate.isPending}
          >
            <TagIcon className="h-3.5 w-3.5" />
            Тип
          </Button>
        </div>

        <Button
          size="sm"
          variant="ghost"
          className="ml-auto h-7 text-xs"
          onClick={onClear}
        >
          <X className="h-3.5 w-3.5 mr-1" />
          Снять выделение
        </Button>
      </div>

      <Dialog open={dialogOpen} onOpenChange={(v) => !v && closeDialog()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{dialogTitle}</DialogTitle>
          </DialogHeader>

          {mode?.kind === "status" && (
            <div className="space-y-2">
              <Label htmlFor="bulk-comment">Комментарий результата *</Label>
              <Textarea
                id="bulk-comment"
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                rows={4}
                placeholder="Опишите результат — будет применён ко всем выбранным задачам"
              />
              <p className="text-xs text-muted-foreground">
                Применится к {selectedIds.length} задачам. Один и тот же комментарий запишется в каждую.
              </p>
            </div>
          )}

          {mode?.kind === "assignee" && (
            <div className="space-y-2">
              <Label>Ответственный</Label>
              <Select value={assigneeId || "__unassigned__"} onValueChange={(v) => setAssigneeId(v === "__unassigned__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Выбрать…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unassigned__">
                    <span className="text-sm text-muted-foreground">Снять ответственного</span>
                  </SelectItem>
                  {staff.map((s) => (
                    <SelectItem key={s.user_id} value={s.user_id}>
                      <StaffOptionRow staff={s} />
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          {mode?.kind === "type" && (
            <div className="space-y-2">
              <Label>Тип задачи</Label>
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выбрать тип…" />
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
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" size="sm" onClick={closeDialog}>
              Отмена
            </Button>
            {mode?.kind === "status" && (
              <Button
                size="sm"
                onClick={handleStatusConfirm}
                disabled={!comment.trim() || bulkStatus.isPending}
              >
                Применить
              </Button>
            )}
            {mode?.kind === "assignee" && (
              <Button size="sm" onClick={handleAssigneeConfirm} disabled={bulkUpdate.isPending}>
                Применить
              </Button>
            )}
            {mode?.kind === "type" && (
              <Button size="sm" onClick={handleTypeConfirm} disabled={!typeId || bulkUpdate.isPending}>
                Применить
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
