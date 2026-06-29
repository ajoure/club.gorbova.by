import { useEffect, useMemo, useState } from "react";
import { Loader2, Pencil, Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import { useCrmTaskTypes } from "@/hooks/useCrmTasks";
import { useStaffOptions } from "@/hooks/useStaffOptions";
import {
  AssigneeStrategy,
  CrmTaskAutomationRule,
  useCrmTaskAutomationRules,
  useToggleCrmTaskAutomationRule,
  useUpsertCrmTaskAutomationRule,
} from "@/hooks/useCrmTaskAutomationRules";

interface Props {
  offerId: string | null;
}

const UNASSIGNED = "__unassigned__";

function formatMinutes(min: number | null | undefined): string {
  if (min == null) return "—";
  if (min === 0) return "сразу";
  if (min % 1440 === 0) return `${min / 1440} дн`;
  if (min % 60 === 0) return `${min / 60} ч`;
  return `${min} мин`;
}

interface EditState {
  open: boolean;
  rule: CrmTaskAutomationRule | null;
}

export function OfferAutomationRulesSection({ offerId }: Props) {
  const { data: rules = [], isLoading } = useCrmTaskAutomationRules(offerId);
  const { data: types = [] } = useCrmTaskTypes();
  const { data: staff = [] } = useStaffOptions();
  const toggle = useToggleCrmTaskAutomationRule();

  const [edit, setEdit] = useState<EditState>({ open: false, rule: null });

  const typeMap = useMemo(() => Object.fromEntries(types.map((t) => [t.id, t])), [types]);
  const staffMap = useMemo(() => Object.fromEntries(staff.map((s) => [s.user_id, s])), [staff]);

  if (!offerId) {
    return (
      <div className="space-y-2 rounded-md border border-dashed p-4">
        <Label className="text-sm font-medium">Авто-задачи на оплату</Label>
        <p className="text-xs text-muted-foreground">
          Сохраните кнопку оплаты, чтобы настроить правила автозадач.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <Label className="text-sm font-medium">Авто-задачи на оплату</Label>
          <p className="text-xs text-muted-foreground">
            Срабатывают при создании сделки по этой кнопке (предзапись / оплата).
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => setEdit({ open: true, rule: null })}
        >
          <Plus className="mr-1 h-3 w-3" /> Правило
        </Button>
      </div>

      {isLoading ? (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" /> Загрузка…
        </div>
      ) : rules.length === 0 ? (
        <p className="text-xs text-muted-foreground">Правил пока нет.</p>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => {
            const t = typeMap[rule.task_type_id];
            const assigneeLabel =
              rule.assignee_strategy === "fixed_user"
                ? staffMap[rule.assignee_user_id ?? ""]?.label ?? "(не задан)"
                : rule.assignee_strategy === "deal_owner"
                ? "Владелец сделки"
                : "Round-robin";
            return (
              <div
                key={rule.id}
                className="flex flex-col gap-2 rounded-md border bg-card p-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary">{t?.label ?? "тип?"}</Badge>
                    <span className="text-sm font-medium">{rule.title_template}</span>
                    {!rule.is_active && (
                      <Badge variant="outline" className="text-muted-foreground">
                        выкл.
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span>Дедлайн: {formatMinutes(rule.due_offset_minutes)}</span>
                    <span>Напомнить: {formatMinutes(rule.reminder_offset_minutes)}</span>
                    <span>Ответственный: {assigneeLabel}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Switch
                    checked={rule.is_active}
                    onCheckedChange={(v) =>
                      toggle.mutate({ id: rule.id, offer_id: rule.offer_id, is_active: v })
                    }
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="ghost"
                    onClick={() => setEdit({ open: true, rule })}
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <RuleEditorDialog
        open={edit.open}
        rule={edit.rule}
        offerId={offerId}
        onOpenChange={(open) => setEdit({ open, rule: open ? edit.rule : null })}
      />
    </div>
  );
}

interface EditorProps {
  open: boolean;
  rule: CrmTaskAutomationRule | null;
  offerId: string;
  onOpenChange: (v: boolean) => void;
}

function RuleEditorDialog({ open, rule, offerId, onOpenChange }: EditorProps) {
  const { data: types = [] } = useCrmTaskTypes();
  const { data: staff = [] } = useStaffOptions();
  const upsert = useUpsertCrmTaskAutomationRule();

  const [typeId, setTypeId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [strategy, setStrategy] = useState<AssigneeStrategy>("fixed_user");
  const [assignee, setAssignee] = useState<string>(UNASSIGNED);
  const [dueMinutes, setDueMinutes] = useState<number>(1440);
  const [remindMinutes, setRemindMinutes] = useState<number | "">("");
  const [isActive, setIsActive] = useState(true);

  useEffect(() => {
    if (!open) return;
    if (rule) {
      setTypeId(rule.task_type_id);
      setTitle(rule.title_template);
      setDescription(rule.description_template ?? "");
      setStrategy(rule.assignee_strategy);
      setAssignee(rule.assignee_user_id ?? UNASSIGNED);
      setDueMinutes(rule.due_offset_minutes);
      setRemindMinutes(rule.reminder_offset_minutes ?? "");
      setIsActive(rule.is_active);
    } else {
      setTypeId(types[0]?.id ?? "");
      setTitle("");
      setDescription("");
      setStrategy("fixed_user");
      setAssignee(UNASSIGNED);
      setDueMinutes(1440);
      setRemindMinutes(60);
      setIsActive(true);
    }
  }, [open, rule, types]);

  const submit = () => {
    if (!typeId || !title.trim()) return;
    if (strategy === "fixed_user" && (!assignee || assignee === UNASSIGNED)) return;
    if (typeof remindMinutes === "number" && remindMinutes >= dueMinutes) return;

    upsert.mutate(
      {
        id: rule?.id,
        offer_id: offerId,
        task_type_id: typeId,
        title_template: title,
        description_template: description,
        assignee_strategy: strategy,
        assignee_user_id: strategy === "fixed_user" ? assignee : null,
        due_offset_minutes: dueMinutes,
        reminder_offset_minutes: remindMinutes === "" ? null : Number(remindMinutes),
        is_active: isActive,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  const reminderInvalid =
    typeof remindMinutes === "number" && remindMinutes >= dueMinutes;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{rule ? "Правило автозадачи" : "Новое правило автозадачи"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-1">
          <div className="space-y-1">
            <Label>Тип задачи</Label>
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
            <Label>Шаблон названия</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="space-y-1">
            <Label>Шаблон описания</Label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Дедлайн (мин)</Label>
              <Input
                type="number"
                min={1}
                value={dueMinutes}
                onChange={(e) => setDueMinutes(Math.max(1, Number(e.target.value || 0)))}
              />
              <p className="text-[10px] text-muted-foreground">
                {formatMinutes(dueMinutes)} от создания сделки
              </p>
            </div>
            <div className="space-y-1">
              <Label>Напоминание (мин до)</Label>
              <Input
                type="number"
                min={0}
                value={remindMinutes}
                onChange={(e) =>
                  setRemindMinutes(e.target.value === "" ? "" : Math.max(0, Number(e.target.value)))
                }
              />
              {reminderInvalid && (
                <p className="text-[10px] text-destructive">
                  Должно быть меньше дедлайна
                </p>
              )}
            </div>
          </div>

          <div className="space-y-1">
            <Label>Стратегия назначения</Label>
            <Select value={strategy} onValueChange={(v) => setStrategy(v as AssigneeStrategy)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="fixed_user">Конкретный сотрудник</SelectItem>
                <SelectItem value="deal_owner">Владелец сделки</SelectItem>
                <SelectItem value="round_robin">Round-robin</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {strategy === "fixed_user" && (
            <div className="space-y-1">
              <Label>Ответственный</Label>
              <Select value={assignee} onValueChange={setAssignee}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите сотрудника" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNASSIGNED}>—</SelectItem>
                  {staff.map((s) => (
                    <SelectItem key={s.user_id} value={s.user_id}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <div className="flex items-center gap-2 pt-1">
            <Switch checked={isActive} onCheckedChange={setIsActive} />
            <Label className="text-sm">Правило активно</Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            onClick={submit}
            disabled={
              upsert.isPending ||
              !typeId ||
              !title.trim() ||
              reminderInvalid ||
              (strategy === "fixed_user" && (!assignee || assignee === UNASSIGNED))
            }
          >
            {rule ? "Сохранить" : "Создать"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
