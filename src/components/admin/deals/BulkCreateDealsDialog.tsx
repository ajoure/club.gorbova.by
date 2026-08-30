import { useEffect, useMemo, useState } from "react";
import { Handshake, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { usePipelines } from "@/hooks/usePipelines";
import { useCrmTaskTypes } from "@/hooks/useCrmTasks";
import { useStaffOptions } from "@/hooks/useStaffOptions";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/hooks/usePermissions";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export type BulkDealSourceType = "contact" | "company" | "deal";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sourceType: BulkDealSourceType;
  sourceIds: string[];
  defaultPipelineId?: string | null;
  defaultStageId?: string | null;
  onCreated?: (result: { created: number; skipped: number; created_ids: string[] }) => void;
}

export function BulkCreateDealsDialog({ open, onOpenChange, sourceType, sourceIds, defaultPipelineId, defaultStageId, onCreated }: Props) {
  const { user } = useAuth();
  const { hasPermission } = usePermissions();
  const canReassign = hasPermission("deals.reassign");
  const { pipelines } = usePipelines();
  const { data: taskTypes = [] } = useCrmTaskTypes();
  const { data: staff = [] } = useStaffOptions();
  const [pipelineId, setPipelineId] = useState("");
  const [stageId, setStageId] = useState("");
  const [responsibleId, setResponsibleId] = useState("");
  const [titleTemplate, setTitleTemplate] = useState("{{name}}");
  const [campaignKey, setCampaignKey] = useState("");
  const [createTask, setCreateTask] = useState(true);
  const [taskTypeId, setTaskTypeId] = useState("");
  const [taskTitle, setTaskTitle] = useState("Первый контакт");
  const [taskDueAt, setTaskDueAt] = useState("");
  const [saving, setSaving] = useState(false);

  const { data: stages = [], isLoading: stagesLoading } = useQuery({
    queryKey: ["crm-pipeline-stages", pipelineId, "bulk-create"],
    enabled: open && !!pipelineId,
    queryFn: async () => {
      const { data, error } = await supabase.from("crm_pipeline_stages").select("id,name,is_default,order_index")
        .eq("pipeline_id", pipelineId).order("order_index");
      if (error) throw error;
      return data ?? [];
    },
  });

  useEffect(() => {
    if (!open) return;
    if (user?.id) setResponsibleId(user.id);
    const preferred = defaultPipelineId ?? pipelines.find((item) => item.is_default)?.id ?? pipelines[0]?.id ?? "";
    setPipelineId(preferred);
  }, [defaultPipelineId, open, pipelines, user?.id]);

  useEffect(() => {
    if (!open || stages.length === 0) return;
    const preferred = stages.find((item) => item.id === defaultStageId)
      ?? stages.find((item) => item.is_default)
      ?? stages[0];
    setStageId(preferred.id);
  }, [defaultStageId, open, stages]);

  useEffect(() => {
    if (open && taskTypes.length && !taskTypeId) setTaskTypeId(taskTypes[0].id);
  }, [open, taskTypeId, taskTypes]);

  const sourceLabel = useMemo(() => ({ contact: "контактов", company: "компаний", deal: "сделок" }[sourceType]), [sourceType]);
  const canSubmit = sourceIds.length > 0 && !!pipelineId && !!stageId && (!createTask || !!taskTypeId) && !saving;

  const submit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    try {
      const { data, error } = await (supabase as any).rpc("crm_bulk_create_deals", {
        _source_type: sourceType,
        _source_ids: sourceIds,
        _pipeline_id: pipelineId,
        _stage_id: stageId,
        _responsible_user_id: responsibleId || user?.id || null,
        _title_template: titleTemplate.trim() || "{{name}}",
        _campaign_key: campaignKey.trim() || null,
        _task_type_id: createTask ? taskTypeId : null,
        _task_title: createTask ? taskTitle.trim() || "Первый контакт" : null,
        _task_due_at: createTask && taskDueAt ? new Date(taskDueAt).toISOString() : null,
        _request_id: crypto.randomUUID(),
      });
      if (error) throw error;
      const result = data as { created: number; skipped: number; created_ids: string[] };
      toast.success(`Создано сделок: ${result.created}. Пропущено: ${result.skipped}.`);
      onCreated?.(result);
      onOpenChange(false);
    } catch (error: any) {
      toast.error(error?.message || "Не удалось создать сделки");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(value) => !saving && onOpenChange(value)}>
      <DialogContent className="sm:max-w-[620px] bg-background/95 backdrop-blur-xl">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600"><Handshake className="h-4 w-4" /></div>
            <div>
              <DialogTitle className="text-base">Массовое создание сделок</DialogTitle>
              <DialogDescription className="text-xs">Выбрано {sourceIds.length} {sourceLabel}. Одна сущность создаёт одну сделку.</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="grid max-h-[65vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
          <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Воронка</Label><Select value={pipelineId} onValueChange={(value) => { setPipelineId(value); setStageId(""); }}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent>{pipelines.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Стадия</Label><Select value={stageId} onValueChange={setStageId} disabled={stagesLoading}><SelectTrigger className="h-9"><SelectValue placeholder="Выберите стадию" /></SelectTrigger><SelectContent>{stages.map((item) => <SelectItem key={item.id} value={item.id}>{item.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Менеджер продажи</Label><Select value={responsibleId} onValueChange={setResponsibleId} disabled={!canReassign}><SelectTrigger className="h-9"><SelectValue placeholder="Выберите сотрудника" /></SelectTrigger><SelectContent>{staff.map((item) => <SelectItem key={item.user_id} value={item.user_id}>{item.label}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Кампания — защита от дублей</Label><Input className="h-9" value={campaignKey} onChange={(event) => setCampaignKey(event.target.value)} placeholder="Например: обзвон-июль-2026" /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label className="text-xs text-muted-foreground">Название сделки</Label><Input className="h-9" value={titleTemplate} onChange={(event) => setTitleTemplate(event.target.value)} placeholder="Первичный звонок — {{name}}" /><p className="text-[11px] text-muted-foreground">Маркер {"{{name}}"} заменится именем контакта или названием компании.</p></div>

          <div className="flex items-center justify-between rounded-lg border bg-muted/20 px-3 py-2 sm:col-span-2"><div><div className="text-sm font-medium">Создать первую задачу</div><div className="text-[11px] text-muted-foreground">Задача будет привязана непосредственно к новой сделке.</div></div><Switch checked={createTask} onCheckedChange={setCreateTask} /></div>
          {createTask && <>
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Тип задачи</Label><Select value={taskTypeId} onValueChange={setTaskTypeId}><SelectTrigger className="h-9"><SelectValue /></SelectTrigger><SelectContent>{taskTypes.map((item) => <SelectItem key={item.id} value={item.id}>{item.label}</SelectItem>)}</SelectContent></Select></div>
            <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">Срок</Label><Input className="h-9" type="datetime-local" value={taskDueAt} onChange={(event) => setTaskDueAt(event.target.value)} /></div>
            <div className="space-y-1.5 sm:col-span-2"><Label className="text-xs text-muted-foreground">Название задачи</Label><Input className="h-9" value={taskTitle} onChange={(event) => setTaskTitle(event.target.value)} /></div>
          </>}

          <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-xs sm:col-span-2">
            Будет обработано: <b>{sourceIds.length}</b>. При заполненной кампании активные дубли будут пропущены и попадут в итоговый отчёт.
          </div>
        </div>
        <DialogFooter><Button variant="outline" size="sm" onClick={() => onOpenChange(false)} disabled={saving}>Отмена</Button><Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-700" onClick={submit} disabled={!canSubmit}>{saving && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}Создать сделки</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
