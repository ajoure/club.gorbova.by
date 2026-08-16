import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Plus, Pencil, Power, PowerOff } from "lucide-react";
import { Link } from "react-router-dom";

import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import type { CrmTaskType } from "@/hooks/useCrmTasks";
import { useAdminAccess } from "@/hooks/useAdminAccess";

interface FormState {
  id?: string;
  key: string;
  label: string;
  icon: string;
  color: string;
  default_due_offset_minutes: string;
  default_reminder_offset_minutes: string;
  sort_order: string;
  is_active: boolean;
}

const EMPTY: FormState = {
  key: "",
  label: "",
  icon: "CircleDot",
  color: "",
  default_due_offset_minutes: "",
  default_reminder_offset_minutes: "",
  sort_order: "0",
  is_active: true,
};

function useTaskTypesAll() {
  return useQuery({
    queryKey: ["crm-task-types-all"],
    queryFn: async (): Promise<CrmTaskType[]> => {
      const { data, error } = await (supabase as any)
        .from("crm_task_types")
        .select("*")
        .order("sort_order", { ascending: true })
        .order("label", { ascending: true });
      if (error) throw error;
      return (data ?? []) as CrmTaskType[];
    },
  });
}

export default function AdminTaskTypes() {
  const access = useAdminAccess();
  const canEdit = access.canAccessSection("deals", "edit");
  const qc = useQueryClient();
  const { data: types = [], isLoading } = useTaskTypesAll();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY);

  const isEdit = !!form.id;

  const upsert = useMutation({
    mutationFn: async (f: FormState) => {
      const payload: Record<string, unknown> = {
        key: f.key.trim(),
        label: f.label.trim(),
        icon: f.icon.trim() || null,
        color: f.color.trim() || null,
        default_due_offset_minutes: f.default_due_offset_minutes
          ? Number(f.default_due_offset_minutes)
          : null,
        default_reminder_offset_minutes: f.default_reminder_offset_minutes
          ? Number(f.default_reminder_offset_minutes)
          : null,
        sort_order: Number(f.sort_order || "0"),
        is_active: f.is_active,
      };
      if (f.id) {
        const { error } = await (supabase as any)
          .from("crm_task_types")
          .update(payload)
          .eq("id", f.id);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any)
          .from("crm_task_types")
          .insert(payload);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-task-types-all"] });
      qc.invalidateQueries({ queryKey: ["crm-task-types"] });
      setOpen(false);
      toast.success(isEdit ? "Тип обновлён" : "Тип создан");
    },
    onError: (e: Error) => toast.error(`Не сохранилось: ${e.message}`),
  });

  const toggle = useMutation({
    mutationFn: async (t: CrmTaskType) => {
      const { error } = await (supabase as any)
        .from("crm_task_types")
        .update({ is_active: !t.is_active })
        .eq("id", t.id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["crm-task-types-all"] });
      qc.invalidateQueries({ queryKey: ["crm-task-types"] });
    },
    onError: (e: Error) => toast.error(`Не удалось: ${e.message}`),
  });

  const startCreate = () => {
    const maxOrder = types.reduce((m, t) => Math.max(m, t.sort_order), 0);
    setForm({ ...EMPTY, sort_order: String(maxOrder + 10) });
    setOpen(true);
  };

  const startEdit = (t: CrmTaskType) => {
    setForm({
      id: t.id,
      key: t.key,
      label: t.label,
      icon: t.icon ?? "",
      color: t.color ?? "",
      default_due_offset_minutes:
        t.default_due_offset_minutes != null ? String(t.default_due_offset_minutes) : "",
      default_reminder_offset_minutes:
        t.default_reminder_offset_minutes != null
          ? String(t.default_reminder_offset_minutes)
          : "",
      sort_order: String(t.sort_order),
      is_active: t.is_active,
    });
    setOpen(true);
  };

  const canSave = useMemo(
    () => form.key.trim().length > 0 && form.label.trim().length > 0,
    [form],
  );

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-2 justify-between flex-wrap">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/admin/tasks">
              <ArrowLeft className="h-4 w-4 mr-1" />К задачам
            </Link>
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">Типы задач</h1>
            <p className="text-sm text-muted-foreground">
              Управление справочником типов задач CRM (звонок, встреча, и т.д.).
              Иконка — имя из lucide-react (например, Phone, Mail, Video).
            </p>
          </div>
        </div>
        {canEdit && (
          <Button onClick={startCreate} size="sm">
            <Plus className="h-4 w-4 mr-1" />Новый тип
          </Button>
        )}
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[60px]">№</TableHead>
              <TableHead>Ключ</TableHead>
              <TableHead>Название</TableHead>
              <TableHead>Иконка</TableHead>
              <TableHead className="text-right">due / remind, мин</TableHead>
              <TableHead>Статус</TableHead>
              <TableHead className="w-[140px] text-right">Действия</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  Загрузка…
                </TableCell>
              </TableRow>
            ) : types.length === 0 ? (
              <TableRow>
                <TableCell colSpan={7} className="text-muted-foreground">
                  Типы не настроены
                </TableCell>
              </TableRow>
            ) : (
              types.map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="text-muted-foreground">{t.sort_order}</TableCell>
                  <TableCell className="font-mono text-xs">{t.key}</TableCell>
                  <TableCell className="font-medium">{t.label}</TableCell>
                  <TableCell className="text-xs">
                    <span className="font-mono">{t.icon ?? "—"}</span>
                    {t.color ? (
                      <span
                        className="inline-block ml-2 h-3 w-3 rounded-full align-middle"
                        style={{ background: t.color }}
                      />
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right text-xs text-muted-foreground">
                    {t.default_due_offset_minutes ?? "—"} /{" "}
                    {t.default_reminder_offset_minutes ?? "—"}
                  </TableCell>
                  <TableCell>
                    {t.is_active ? (
                      <Badge variant="secondary">Активен</Badge>
                    ) : (
                      <Badge variant="outline">Выключен</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {canEdit ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => startEdit(t)}
                          title="Редактировать"
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => toggle.mutate(t)}
                          disabled={toggle.isPending}
                          title={t.is_active ? "Выключить" : "Включить"}
                        >
                          {t.is_active ? (
                            <PowerOff className="h-4 w-4" />
                          ) : (
                            <Power className="h-4 w-4" />
                          )}
                        </Button>
                      </>
                    ) : (
                      <span className="text-xs text-muted-foreground">Только чтение</span>
                    )}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{isEdit ? "Изменить тип задачи" : "Новый тип задачи"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Ключ *</Label>
                <Input
                  value={form.key}
                  onChange={(e) =>
                    setForm({ ...form, key: e.target.value.replace(/[^a-z0-9_]/g, "_") })
                  }
                  placeholder="call_back"
                  disabled={isEdit}
                />
              </div>
              <div className="space-y-1">
                <Label>Сортировка</Label>
                <Input
                  type="number"
                  value={form.sort_order}
                  onChange={(e) => setForm({ ...form, sort_order: e.target.value })}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Название *</Label>
              <Input
                value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })}
                placeholder="Перезвонить клиенту"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Иконка (lucide)</Label>
                <Input
                  value={form.icon}
                  onChange={(e) => setForm({ ...form, icon: e.target.value })}
                  placeholder="Phone"
                />
              </div>
              <div className="space-y-1">
                <Label>Цвет (hex)</Label>
                <Input
                  value={form.color}
                  onChange={(e) => setForm({ ...form, color: e.target.value })}
                  placeholder="#22c55e"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Дедлайн по умолчанию, мин</Label>
                <Input
                  type="number"
                  value={form.default_due_offset_minutes}
                  onChange={(e) =>
                    setForm({ ...form, default_due_offset_minutes: e.target.value })
                  }
                  placeholder="60"
                />
              </div>
              <div className="space-y-1">
                <Label>Напоминание, мин</Label>
                <Input
                  type="number"
                  value={form.default_reminder_offset_minutes}
                  onChange={(e) =>
                    setForm({ ...form, default_reminder_offset_minutes: e.target.value })
                  }
                  placeholder="15"
                />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-1">
              <Switch
                checked={form.is_active}
                onCheckedChange={(v) => setForm({ ...form, is_active: v })}
              />
              <Label>Активен</Label>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Отмена
            </Button>
            <Button
              onClick={() => upsert.mutate(form)}
              disabled={!canSave || upsert.isPending}
            >
              {isEdit ? "Сохранить" : "Создать"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
