import { useEffect, useState } from "react";
import { addMinutes, format } from "date-fns";

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

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultContactId?: string | null;
  defaultDealId?: string | null;
}

export function CreateCrmTaskDialog({
  open,
  onOpenChange,
  defaultContactId,
  defaultDealId,
}: Props) {
  const { data: types = [] } = useCrmTaskTypes();
  const create = useCreateCrmTask();

  const [typeId, setTypeId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState<string>("");

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
      setTypeId("");
    }
  }, [open]);

  useEffect(() => {
    const tt = types.find((t) => t.id === typeId);
    if (!tt) return;
    if (!dueAt && tt.default_due_offset_minutes != null) {
      const dt = addMinutes(new Date(), tt.default_due_offset_minutes);
      setDueAt(format(dt, "yyyy-MM-dd'T'HH:mm"));
    }
  }, [typeId, types, dueAt]);

  const submit = () => {
    if (!typeId || !title.trim()) return;
    create.mutate(
      {
        task_type_id: typeId,
        title: title.trim(),
        description: description.trim() || null,
        due_at: dueAt ? new Date(dueAt).toISOString() : null,
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Новая задача</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
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
            <Label>Дедлайн</Label>
            <Input
              type="datetime-local"
              value={dueAt}
              onChange={(e) => setDueAt(e.target.value)}
            />
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
