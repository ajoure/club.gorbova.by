import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { formatTrainingReleaseDate, useTrainingReleaseSchedule } from "@/hooks/useTrainingReleaseSchedule";

export function TrainingReleaseSettings({ moduleId }: { moduleId: string }) {
  const { data: schedule, isLoading, error } = useTrainingReleaseSchedule(moduleId);
  const [date, setDate] = useState("");
  const [delay, setDelay] = useState(45);
  const [manual, setManual] = useState(false);
  const [saving, setSaving] = useState(false);
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!schedule) return;
    setDate(schedule.start_date);
    setDelay(schedule.addon_delay_days);
    setManual(schedule.addon_mode === "manual");
  }, [schedule?.start_date, schedule?.addon_delay_days, schedule?.addon_mode]);
  if (isLoading) return <p className="text-sm text-muted-foreground">Загрузка расписания…</p>;
  if (error) return <p role="alert" className="text-sm text-destructive">Не удалось загрузить расписание обучения.</p>;
  if (!schedule) return null;
  const save = async () => {
    setSaving(true);
    try {
      const { error } = await supabase.rpc("set_training_release_schedule", {
        _flow_id: schedule.flow_id, _start_date: date, _addon_delay_days: delay,
        _addon_mode: manual ? "manual" : "scheduled",
      });
      if (error) throw error;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["training-release-schedule"] }),
        queryClient.invalidateQueries({ queryKey: ["flows"] }),
      ]);
      toast.success("Расписание обучения сохранено");
    } catch {
      toast.error("Не удалось сохранить расписание. Проверьте настройки и повторите попытку.");
    } finally { setSaving(false); }
  };
  return <section className="space-y-4 rounded-xl border p-4" aria-label="Расписание обучения">
    <div><h3 className="font-semibold">Расписание обучения</h3>
      <p className="text-sm text-muted-foreground">Все уроки закрыты до старта, включая предобучение и конференции. Время — Минск, 00:00.</p></div>
    <div className="space-y-2"><Label htmlFor="training-release-date">Старт обучения</Label>
      <Input id="training-release-date" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
    <div className="space-y-2"><Label htmlFor="training-addon-delay">Дополнительные модули: дней после старта</Label>
      <Input id="training-addon-delay" type="number" min={0} max={730} value={delay} onChange={e => setDelay(Number(e.target.value))} /></div>
    <div className="flex items-start gap-3"><Switch id="training-addon-manual" checked={manual} onCheckedChange={setManual} />
      <Label htmlFor="training-addon-manual">Открывать дополнительные модули вручную</Label></div>
    <p className="text-sm text-muted-foreground">{schedule.addon_mode === "manual" ? "Сохранён ручной режим. Открытие — в оплаченной сделке дополнительного модуля." : `Сохранённая дата открытия дополнительных модулей: ${formatTrainingReleaseDate(schedule.addons_open_at)}.`}</p>
    <p className="text-xs text-muted-foreground">Уроки выключенных модулей остаются закрыты до их публикации. Самостоятельные и исторические покупки дополнительных модулей сохраняют свои условия.</p>
    <Button type="button" onClick={save} disabled={saving || !date || !Number.isInteger(delay) || delay < 0 || delay > 730}>{saving ? "Сохранение…" : "Сохранить расписание"}</Button>
  </section>;
}
