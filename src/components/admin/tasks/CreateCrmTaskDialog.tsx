import { useEffect, useState } from "react";
import { addMinutes } from "date-fns";

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

import { useCrmTaskTypes, useCreateCrmTask } from "@/hooks/useCrmTasks";
import { useStaffOptions } from "@/hooks/useStaffOptions";
import { DateTimePickerField } from "./DateTimePickerField";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultContactId?: string | null;
  defaultDealId?: string | null;
}

const UNASSIGNED = "__unassigned__";

export function CreateCrmTaskDialog({
  open,
  onOpenChange,
  defaultContactId,
  defaultDealId,
}: Props) {
  const { data: types = [] } = useCrmTaskTypes();
  const { data: staff = [] } = useStaffOptions();
  const create = useCreateCrmTask();

  const [typeId, setTypeId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState<string>("");
  const [remindAt, setRemindAt] = useState<string>("");
  const [assignee, setAssignee] = useState<string>(UNASSIGNED);

  useEffect(() => {
    if (open && types.length > 0 && !typeId) {
      setTypeId(types[0].id);
    }
  }, [open, types, typeId]);

  useEffect(() => {
    if (!open) {
      setTitle("");
      setDescription("");
      setDueAt("");
      setRemindAt("");
      setTypeId("");
      setAssignee(UNASSIGNED);
    }
  }, [open]);

  useEffect(() => {
    const tt = types.find((t) => t.id === typeId);
    if (!tt) return;
    if (!dueAt && tt.default_due_offset_minutes != null) {
      setDueAt(addMinutes(new Date(), tt.default_due_offset_minutes).toISOString());
    }
    if (!remindAt && tt.default_reminder_offset_minutes != null && dueAt) {
      setRemindAt(addMinutes(new Date(dueAt), -tt.default_reminder_offset_minutes).toISOString());
    }
  }, [typeId, types, dueAt, remindAt]);

  const submit = () => {
    if (!typeId || !title.trim()) return;
    create.mutate(
      {
        task_type_id: typeId,
        title: title.trim(),
        description: description.trim() || null,
        due_at: dueAt || null,
        remind_at: remindAt || null,
        assignee_user_id: assignee === UNASSIGNED ? null : assignee,
        contact_id: defaultContactId ?? null,
        deal_id: defaultDealId ?? null,
        source: "manual",
      },
      {
        onSuccess: () => onOpenChange(false),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Новая задача</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          <div className="space-y-1">
            <Label>Тип</Label>
            <Select value={typeId} onValueChange={setTypeId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите тип" />
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

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={submit} disabled={create.isPending || !title.trim() || !typeId}>
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
