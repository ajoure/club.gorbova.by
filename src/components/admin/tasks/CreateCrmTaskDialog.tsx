import { useEffect, useMemo, useState } from "react";
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
import { StaffOptionRow } from "./StaffOptionRow";
import { TaskRelationsField } from "./TaskRelationsField";
import {
  RemindOffsetSelect,
  computeRemindAt,
} from "./RemindOffsetSelect";
import {
  TASK_DIALOG_GLASS,
  TASK_DIALOG_SECTION,
  TASK_DIALOG_SAVE_CTA,
} from "./taskUiTheme";
import { cn } from "@/lib/utils";


interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  defaultContactId?: string | null;
  defaultCompanyId?: string | null;
  defaultDealId?: string | null;
}

const UNASSIGNED = "__unassigned__";

export function CreateCrmTaskDialog({
  open,
  onOpenChange,
  defaultContactId,
  defaultCompanyId,
  defaultDealId,
}: Props) {
  const { data: types = [] } = useCrmTaskTypes();
  const { data: staff = [] } = useStaffOptions();
  const create = useCreateCrmTask();

  const [typeId, setTypeId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueAt, setDueAt] = useState<string>("");
  const [remindOffset, setRemindOffset] = useState<number | null>(null);
  const [assignee, setAssignee] = useState<string>(UNASSIGNED);
  const [dealId, setDealId] = useState<string | null>(defaultDealId ?? null);
  const [contactId, setContactId] = useState<string | null>(defaultContactId ?? null);
  const [companyId, setCompanyId] = useState<string | null>(defaultCompanyId ?? null);

  useEffect(() => {
    if (open && types.length > 0 && !typeId) {
      setTypeId(types[0].id);
    }
  }, [open, types, typeId]);

  useEffect(() => {
    if (open) {
      setDealId(defaultDealId ?? null);
      setContactId(defaultContactId ?? null);
      setCompanyId(defaultCompanyId ?? null);
    } else {
      setTitle("");
      setDescription("");
      setDueAt("");
      setRemindOffset(null);
      setTypeId("");
      setAssignee(UNASSIGNED);
      setDealId(null);
      setContactId(null);
      setCompanyId(null);
    }
  }, [open, defaultDealId, defaultContactId, defaultCompanyId]);

  // Автозаполнение из шаблона типа задачи
  useEffect(() => {
    const tt = types.find((t) => t.id === typeId);
    if (!tt) return;
    if (!dueAt && tt.default_due_offset_minutes != null) {
      setDueAt(addMinutes(new Date(), tt.default_due_offset_minutes).toISOString());
    }
    if (remindOffset == null && tt.default_reminder_offset_minutes != null) {
      setRemindOffset(tt.default_reminder_offset_minutes);
    }
  }, [typeId, types, dueAt, remindOffset]);

  const remindAtComputed = useMemo(
    () => computeRemindAt(dueAt || null, remindOffset),
    [dueAt, remindOffset],
  );
  const remindWarnPast = useMemo(() => {
    if (!remindAtComputed) return false;
    return new Date(remindAtComputed).getTime() < Date.now();
  }, [remindAtComputed]);

  const submit = () => {
    if (!typeId || !title.trim()) return;
    create.mutate(
      {
        task_type_id: typeId,
        title: title.trim(),
        description: description.trim() || null,
        due_at: dueAt || null,
        remind_at: remindAtComputed,
        assignee_user_id: assignee === UNASSIGNED ? null : assignee,
        contact_id: contactId,
        company_id: companyId,
        deal_id: dealId,
        source: "manual",
      },
      {
        onSuccess: () => onOpenChange(false),
      },
    );
  };


  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-w-lg", TASK_DIALOG_GLASS)}>
        <DialogHeader>
          <DialogTitle>Новая задача</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          <div className={TASK_DIALOG_SECTION}>
            <div className="space-y-1">
              <Label>Тип</Label>
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger className="bg-white/80">
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
                <RemindOffsetSelect
                  offsetMinutes={remindOffset}
                  onChange={setRemindOffset}
                  dueAt={dueAt || null}
                  warnPast={remindWarnPast}
                />
              </div>
            </div>
          </div>

          <TaskRelationsField
            dealId={dealId}
            contactId={contactId}
            onChangeDeal={setDealId}
            onChangeContact={setContactId}
            lockDeal={!!defaultDealId}
            lockContact={!!defaultContactId}
          />

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
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={submit}
            disabled={create.isPending || !title.trim() || !typeId}
            className={TASK_DIALOG_SAVE_CTA}
          >
            Создать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
