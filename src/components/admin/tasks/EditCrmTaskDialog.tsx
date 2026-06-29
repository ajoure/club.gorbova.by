import { useEffect, useState } from "react";

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
  const [remindAt, setRemindAt] = useState("");
  const [assignee, setAssignee] = useState<string>(UNASSIGNED);
  const [status, setStatus] = useState<CrmTaskStatus>("open");
  const [result, setResult] = useState("");

  useEffect(() => {
    if (!task || !open) return;
    setTypeId(task.task_type_id);
    setTitle(task.title ?? "");
    setDescription(task.description ?? "");
    setDueAt(toLocalInput(task.due_at));
    setRemindAt(toLocalInput(task.remind_at));
    setAssignee(task.assignee_user_id ?? UNASSIGNED);
    setStatus(task.status);
    setResult(task.result_comment ?? "");
  }, [task, open]);

  if (!task) return null;

  const submit = async () => {
    const patch = {
      task_type_id: typeId,
      title: title.trim(),
      description: description.trim() || null,
      due_at: dueAt ? new Date(dueAt).toISOString() : null,
      remind_at: remindAt ? new Date(remindAt).toISOString() : null,
      assignee_user_id: assignee === UNASSIGNED ? null : assignee,
      result_comment: result.trim() || null,
    };
    await update.mutateAsync({ taskId: task.id, patch });
    if (status !== task.status) {
      await updateStatus.mutateAsync({
        taskId: task.id,
        status,
        resultComment: result.trim() || undefined,
      });
    }
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            Редактировать задачу{task.public_id ? ` · ${task.public_id}` : ""}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Тип</Label>
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger>
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
              <Label>Статус</Label>
              <Select value={status} onValueChange={(v) => setStatus(v as CrmTaskStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="open">Открыта</SelectItem>
                  <SelectItem value="in_progress">В работе</SelectItem>
                  <SelectItem value="done">Готово</SelectItem>
                  <SelectItem value="canceled">Отменена</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1">
            <Label>Название</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label>Описание</Label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Дедлайн</Label>
              <Input
                type="datetime-local"
                value={dueAt}
                onChange={(e) => setDueAt(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <Label>Напомнить</Label>
              <Input
                type="datetime-local"
                value={remindAt}
                onChange={(e) => setRemindAt(e.target.value)}
              />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Ответственный</Label>
            <Select value={assignee} onValueChange={setAssignee}>
              <SelectTrigger>
                <SelectValue placeholder="Не назначен" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={UNASSIGNED}>Не назначен</SelectItem>
                {staff.map((s) => (
                  <SelectItem key={s.user_id} value={s.user_id}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label>Результат / комментарий</Label>
            <Textarea
              value={result}
              onChange={(e) => setResult(e.target.value)}
              rows={2}
              placeholder="Заполняется при закрытии"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={submit}
            disabled={update.isPending || updateStatus.isPending || !title.trim() || !typeId}
          >
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
