/**
 * D-slice-3: Admin-only Scenario Editor CRUD for autowebinar rooms.
 *
 * ⚠️ ISOLATION INVARIANT
 *   Пишет ТОЛЬКО в public.autoweb_scenario_entries.
 *   Никогда не трогает live_event_comments / live_event_questions.
 *   Runtime overlay (AutowebTimelineOverlay) читает эти же строки — но чтение
 *   реального оверлея добавляется отдельной задачей; здесь только CRUD.
 *
 * Workflow: draft → preview → apply (или cancel = archive drafts).
 * Bulk shift двигает offset всех драфтов на N секунд (clamped 0..86400).
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, Plus, Save, Trash2, Undo2, PlayCircle, Pause, Eye, Clock } from "lucide-react";
import { toast } from "sonner";

type EntryType = "chat" | "question" | "host_message" | "reaction" | "cta";
type EntryState = "draft" | "applied" | "archived";

interface Entry {
  id: string;
  live_event_id: string;
  entry_type: EntryType;
  offset_seconds: number;
  actor_display_name: string | null;
  actor_avatar_url: string | null;
  content_text: string;
  visibility_scope: "public" | "private";
  metadata: Record<string, unknown>;
  state: EntryState;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
}

interface DraftRow {
  id?: string;                 // undefined = new
  entry_type: EntryType;
  offset_seconds: number;
  actor_display_name: string;
  content_text: string;
  cta_url: string;
  visibility_scope: "public" | "private";
  _dirty?: boolean;
  _new?: boolean;
}

type ShiftScope = "comments" | "buttons" | "all";
interface ShiftPreview {
  scope: ShiftScope;
  delta_seconds: number;
  affected: number;
  sample: Array<{
    id: string;
    entry_type: EntryType;
    from_offset_seconds: number;
    to_offset_seconds: number;
  }>;
}

function fmtOffset(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

function parseOffset(v: string): number {
  const parts = v.split(":").map((p) => parseInt(p, 10));
  if (parts.some(Number.isNaN)) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

const TYPE_LABEL: Record<EntryType, string> = {
  chat: "Чат",
  question: "Вопрос",
  host_message: "Ведущий",
  reaction: "Реакция",
  cta: "CTA-кнопка",
};

export function AutowebScenarioEditor({ liveEventId }: { liveEventId: string }) {
  const qc = useQueryClient();
  const [rows, setRows] = useState<Record<string, DraftRow>>({});
  const [shiftDelta, setShiftDelta] = useState<string>("30");
  const [shiftScope, setShiftScope] = useState<ShiftScope>("all");
  const [shiftPreview, setShiftPreview] = useState<ShiftPreview | null>(null);
  // Local-only test mode. It intentionally has no session/player/heartbeat path.
  const [previewSeconds, setPreviewSeconds] = useState(0);
  const [previewPlaying, setPreviewPlaying] = useState(false);
  const [previewSpeed, setPreviewSpeed] = useState(1);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["autoweb-scenario-entries", liveEventId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("autoweb_scenario_list", {
        _live_event_id: liveEventId,
        _include_applied: true,
      });
      if (error) throw error;
      return (data ?? []) as Entry[];
    },
  });

  const merged = useMemo<DraftRow[]>(() => {
    const server = (data ?? []).map((e) => ({
      id: e.id,
      entry_type: e.entry_type,
      offset_seconds: e.offset_seconds,
      actor_display_name: e.actor_display_name ?? "",
      content_text: e.content_text,
      cta_url: String(e.metadata?.url ?? ""),
      visibility_scope: e.visibility_scope,
    }));
    const withLocal = server.map((r) => rows[r.id!] ?? r);
    const newOnes = Object.values(rows).filter((r) => !r.id);
    return [...withLocal, ...newOnes].sort((a, b) => a.offset_seconds - b.offset_seconds);
  }, [data, rows]);

  const dirtyCount = Object.values(rows).filter((r) => r._dirty || r._new).length;
  const previewEntries = merged.filter((entry) => entry.offset_seconds <= previewSeconds);
  useEffect(() => {
    if (!previewPlaying) return;
    const id = window.setInterval(() => setPreviewSeconds((value) => value + previewSpeed), 1000);
    return () => window.clearInterval(id);
  }, [previewPlaying, previewSpeed]);

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["autoweb-scenario-entries", liveEventId] });
    setRows({});
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = Object.values(rows)
        .filter((r) => r._dirty || r._new)
        .map((r) => ({
          id: r.id ?? null,
          entry_type: r.entry_type,
          offset_seconds: r.offset_seconds,
          actor_display_name: r.actor_display_name || null,
          content_text: r.content_text,
          metadata: r.entry_type === "cta" && r.cta_url ? { url: r.cta_url } : {},
          visibility_scope: r.visibility_scope,
        }));
      if (payload.length === 0) return { status: "noop" };
      const { data, error } = await supabase.rpc("autoweb_scenario_upsert", {
        _live_event_id: liveEventId,
        _entries: payload as any,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (res: any) => {
      toast.success(`Сохранено (created ${res?.created ?? 0}, updated ${res?.updated ?? 0})`);
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Ошибка сохранения"),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { data, error } = await supabase.rpc("autoweb_scenario_delete", {
        _live_event_id: liveEventId,
        _entry_ids: [id],
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => { toast.success("Удалено"); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Ошибка удаления"),
  });

  const shiftMut = useMutation({
    mutationFn: async () => {
      const delta = parseInt(shiftDelta, 10) || 0;
      const { data, error } = await supabase.rpc("autoweb_scenario_bulk_shift", {
        _live_event_id: liveEventId,
        _delta_seconds: delta,
        _scope: shiftScope,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: (res: any) => {
      toast.success(`Сдвиг применён (${res?.affected ?? 0})`);
      setShiftPreview(null);
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Ошибка bulk shift"),
  });

  const shiftPreviewMut = useMutation({
    mutationFn: async () => {
      const delta = parseInt(shiftDelta, 10) || 0;
      const { data, error } = await supabase.rpc("autoweb_scenario_bulk_shift_preview", {
        _live_event_id: liveEventId,
        _delta_seconds: delta,
        _scope: shiftScope,
      });
      if (error) throw error;
      return data as unknown as ShiftPreview;
    },
    onSuccess: (res) => setShiftPreview(res),
    onError: (e: any) => toast.error(e?.message ?? "Ошибка preview сдвига"),
  });

  const previewMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("autoweb_scenario_preview", {
        _live_event_id: liveEventId,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res: any) => {
      toast.success(`Preview: draft=${res?.draft_count}, applied=${res?.applied_count}`);
    },
    onError: (e: any) => toast.error(e?.message ?? "Preview error"),
  });

  const applyMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("autoweb_scenario_apply", {
        _live_event_id: liveEventId,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res: any) => { toast.success(`Applied ${res?.applied ?? 0}`); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Apply error"),
  });

  const cancelMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.rpc("autoweb_scenario_cancel", {
        _live_event_id: liveEventId,
      });
      if (error) throw error;
      return data as any;
    },
    onSuccess: (res: any) => { toast.success(`Отменено ${res?.cancelled ?? 0}`); invalidate(); },
    onError: (e: any) => toast.error(e?.message ?? "Cancel error"),
  });

  function patchRow(key: string, patch: Partial<DraftRow>) {
    setRows((prev) => {
      const existing = prev[key] ?? merged.find((r) => (r.id ?? "new") === key);
      if (!existing) return prev;
      return { ...prev, [key]: { ...existing, ...patch, _dirty: !!existing.id, _new: !existing.id } };
    });
  }

  function addRow() {
    const key = `new-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    setRows((prev) => ({
      ...prev,
      [key]: {
        entry_type: "chat",
        offset_seconds: 60,
        actor_display_name: "",
        content_text: "",
        cta_url: "",
        visibility_scope: "public",
        _new: true,
      },
    }));
  }

  function toggleTestMode() {
    setPreviewPlaying((active) => {
      const next = !active;
      // The preview itself remains local. This small audit RPC is deliberately
      // the only server interaction and cannot create any runtime artefact.
      void supabase.rpc("autoweb_scenario_test_mode_audit", {
        _live_event_id: liveEventId,
        _active: next,
      }).then(({ error }) => {
        if (error) console.warn("[autoweb test mode] audit failed", error.message);
      });
      return next;
    });
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <PlayCircle className="h-4 w-4" /> Сценарий (draft-first CRUD)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="outline" onClick={addRow}>
            <Plus className="h-3.5 w-3.5 mr-1" /> Добавить запись
          </Button>
          <Button size="sm" onClick={() => saveMut.mutate()} disabled={dirtyCount === 0 || saveMut.isPending}>
            {saveMut.isPending ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Save className="h-3.5 w-3.5 mr-1" />}
            Сохранить драфт ({dirtyCount})
          </Button>
          <div className="flex items-center gap-1 ml-2">
            <Clock className="h-3.5 w-3.5 text-muted-foreground" />
            <Input
              className="h-8 w-20"
              type="number"
              value={shiftDelta}
              onChange={(e) => {
                setShiftDelta(e.target.value);
                setShiftPreview(null);
              }}
            />
            <Select value={shiftScope} onValueChange={(value) => {
              setShiftScope(value as ShiftScope);
              setShiftPreview(null);
            }}>
              <SelectTrigger className="h-8 w-28"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="comments">Комментарии</SelectItem>
                <SelectItem value="buttons">Кнопки</SelectItem>
                <SelectItem value="all">Все</SelectItem>
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={() => shiftPreviewMut.mutate()} disabled={shiftPreviewMut.isPending}>
              <Eye className="h-3.5 w-3.5 mr-1" /> Preview сдвига
            </Button>
            <Button size="sm" variant="outline" onClick={() => shiftMut.mutate()} disabled={shiftMut.isPending || !shiftPreview}>
              Применить сдвиг
            </Button>
          </div>
          <div className="ml-auto flex items-center gap-1">
            <Button size="sm" variant="ghost" onClick={() => previewMut.mutate()} disabled={previewMut.isPending}>
              <Eye className="h-3.5 w-3.5 mr-1" /> Preview
            </Button>
            <Button size="sm" variant="outline" onClick={() => cancelMut.mutate()} disabled={cancelMut.isPending}>
              <Undo2 className="h-3.5 w-3.5 mr-1" /> Отменить драфты
            </Button>
            <Button size="sm" onClick={() => applyMut.mutate()} disabled={applyMut.isPending}>
              Apply
            </Button>
          </div>
        </div>

        {shiftPreview && (
          <div className="rounded-md border bg-muted/30 p-2 text-xs space-y-1">
            <div className="font-medium">
              Preview сдвига: {shiftPreview.affected} draft-записей · {shiftPreview.scope} · {shiftPreview.delta_seconds >= 0 ? "+" : ""}{shiftPreview.delta_seconds} сек
            </div>
            {shiftPreview.sample.length === 0 ? (
              <p className="text-muted-foreground">Подходящих draft-записей нет.</p>
            ) : (
              <div className="space-y-0.5 text-muted-foreground">
                {shiftPreview.sample.map((item) => (
                  <div key={item.id}>
                    {TYPE_LABEL[item.entry_type]}: {fmtOffset(item.from_offset_seconds)} → {fmtOffset(item.to_offset_seconds)}
                  </div>
                ))}
                {shiftPreview.affected > shiftPreview.sample.length && <div>…и ещё {shiftPreview.affected - shiftPreview.sample.length}</div>}
              </div>
            )}
            <Button size="sm" variant="ghost" onClick={() => setShiftPreview(null)}>Отменить preview</Button>
          </div>
        )}

        <div className="rounded-md border border-dashed bg-muted/30 p-3 space-y-2" data-autoweb-test-mode>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="font-medium">Test mode · локальный preview</span>
            <Button size="sm" variant="outline" onClick={toggleTestMode}>
              {previewPlaying ? <Pause className="h-3.5 w-3.5 mr-1" /> : <PlayCircle className="h-3.5 w-3.5 mr-1" />}
              {previewPlaying ? "Пауза" : "Play"}
            </Button>
            <Input className="h-8 w-24" type="number" min={0} value={previewSeconds} onChange={(e) => setPreviewSeconds(Math.max(0, Number(e.target.value) || 0))} />
            <Select value={String(previewSpeed)} onValueChange={(value) => setPreviewSpeed(Number(value))}>
              <SelectTrigger className="h-8 w-20"><SelectValue /></SelectTrigger>
              <SelectContent>
                {[0.5, 1, 1.5, 2].map((speed) => <SelectItem key={speed} value={String(speed)}>{speed}×</SelectItem>)}
              </SelectContent>
            </Select>
            <span className="text-muted-foreground">{previewEntries.length} событий к {fmtOffset(Math.floor(previewSeconds))}</span>
          </div>
          <p className="text-[11px] text-muted-foreground">Не создаёт session, heartbeat, реальные сообщения, viewers, уведомления или интеграции.</p>
          {previewEntries.length > 0 && <div className="text-xs space-y-1">{previewEntries.map((entry) => <div key={entry.id ?? `${entry.offset_seconds}-${entry.content_text}`}><Badge variant="outline" className="mr-1 text-[9px]">{TYPE_LABEL[entry.entry_type]}</Badge>{entry.content_text}</div>)}</div>}
        </div>

        {isLoading ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin" /></div>
        ) : merged.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-6">Записей сценария нет. Нажмите «Добавить запись».</p>
        ) : (
          <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
            {merged.map((r) => {
              const key = r.id ?? Object.keys(rows).find((k) => rows[k] === r) ?? `new-${r.offset_seconds}-${r.content_text.slice(0,8)}`;
              const serverEntry = data?.find((e) => e.id === r.id);
              const state = serverEntry?.state;
              return (
                <div key={key} className="grid grid-cols-12 gap-2 items-start border rounded-md p-2 text-xs">
                  <div className="col-span-2">
                    <Label className="text-[10px]">Offset (mm:ss)</Label>
                    <Input
                      className="h-7"
                      value={fmtOffset(r.offset_seconds)}
                      onChange={(e) => patchRow(key, { offset_seconds: parseOffset(e.target.value) })}
                    />
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px]">Тип</Label>
                    <Select value={r.entry_type} onValueChange={(v) => patchRow(key, { entry_type: v as EntryType })}>
                      <SelectTrigger className="h-7"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {(Object.keys(TYPE_LABEL) as EntryType[]).map((t) => (
                          <SelectItem key={t} value={t}>{TYPE_LABEL[t]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="col-span-2">
                    <Label className="text-[10px]">Имя актёра</Label>
                    <Input
                      className="h-7"
                      value={r.actor_display_name}
                      onChange={(e) => patchRow(key, { actor_display_name: e.target.value })}
                    />
                  </div>
                  <div className="col-span-5">
                    <Label className="text-[10px]">Текст</Label>
                    <Textarea
                      className="min-h-[36px] text-xs"
                      value={r.content_text}
                      onChange={(e) => patchRow(key, { content_text: e.target.value })}
                    />
                  </div>
                  {r.entry_type === "cta" && (
                    <div className="col-span-11">
                      <Label className="text-[10px]">URL кнопки</Label>
                      <Input className="h-7" value={r.cta_url} placeholder="https://…" onChange={(e) => patchRow(key, { cta_url: e.target.value })} />
                    </div>
                  )}
                  <div className="col-span-1 flex flex-col items-end gap-1 pt-4">
                    {state && (
                      <Badge variant={state === "applied" ? "default" : "outline"} className="text-[9px] px-1 py-0">
                        {state}
                      </Badge>
                    )}
                    {r.id && (
                      <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => deleteMut.mutate(r.id!)}>
                        <Trash2 className="h-3 w-3 text-destructive" />
                      </Button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
