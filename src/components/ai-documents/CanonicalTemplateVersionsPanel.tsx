/**
 * CanonicalTemplateVersionsPanel — Sprint 2
 *
 * Управление версиями шаблона (document_template_versions):
 *  • список версий с detected/mapped/unmapped/validation_status
 *  • кнопка "Перепроверить токены" → canonical-template-validate
 *  • кнопка "Активировать версию" → canonical-document-generate(mode=activate_version)
 *  • просмотр manifest (locations внутри DOCX)
 *
 * Add-only: не трогает legacy AiDocumentTemplatesManager.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Loader2, RefreshCw, CheckCircle2, AlertTriangle, FileText, Star, Wand2, Copy } from "lucide-react";
import { toast } from "sonner";
import { TokenMappingDialog } from "./TokenMappingDialog";

interface VersionRow {
  id: string;
  template_id: string;
  version_number: number;
  is_current: boolean;
  storage_path: string;
  storage_bucket: string;
  detected_tokens: string[] | null;
  token_manifest: any[] | null;
  validation_status: string | null;
  validation_errors: any[] | null;
  validation_checked_at: string | null;
  created_at: string;
}

const STATUS_BADGE: Record<string, { label: string; className: string; icon: any }> = {
  valid: { label: "Готов к генерации", className: "border-emerald-300 text-emerald-700", icon: CheckCircle2 },
  valid_with_warnings: { label: "Есть предупреждения", className: "border-amber-300 text-amber-700", icon: AlertTriangle },
  invalid_unknown_required: { label: "Есть ошибки", className: "border-rose-300 text-rose-700", icon: AlertTriangle },
  unchecked: { label: "Не проверен", className: "border-slate-300 text-slate-600", icon: AlertTriangle },
};

export function CanonicalTemplateVersionsPanel() {
  const qc = useQueryClient();
  const [templateId, setTemplateId] = useState<string>("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [mapDlg, setMapDlg] = useState<{ token: string; versionId: string } | null>(null);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillResult, setBackfillResult] = useState<any | null>(null);

  const runBackfill = async (dryRun: boolean) => {
    setBackfillBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke("canonical-template-backfill-validation", {
        body: { dry_run: dryRun, limit: 50, force: !dryRun ? false : true },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      setBackfillResult(data.summary);
      toast.success(dryRun ? `Проверка без изменений: ${data.summary.total_to_process} версий, не сопоставлено ${data.summary.total_unmapped}` : `Готово: обновлено ${data.summary.would_update}`);
      if (!dryRun && templateId) qc.invalidateQueries({ queryKey: ["doc-template-versions", templateId] });
    } catch (e: any) {
      toast.error(`Ошибка проверки шаблонов: ${e?.message || e}`);
    } finally {
      setBackfillBusy(false);
    }
  };

  const { data: templates = [] } = useQuery({
    queryKey: ["doc-templates-canonical-vers"],
    queryFn: async () => {
      const { data } = await supabase
        .from("document_templates")
        .select("id, name, code, current_version_id")
        .eq("is_active", true)
        .order("name");
      return data || [];
    },
  });

  const { data: versions = [], isFetching } = useQuery<VersionRow[]>({
    queryKey: ["doc-template-versions", templateId],
    enabled: !!templateId,
    queryFn: async () => {
      const { data } = await supabase
        .from("document_template_versions")
        .select("*")
        .eq("template_id", templateId)
        .order("version_number", { ascending: false });
      return (data || []) as any;
    },
  });

  const handleValidate = async (v: VersionRow) => {
    setBusyId(v.id);
    try {
      const { data, error } = await supabase.functions.invoke("canonical-template-validate", {
        body: { template_version_id: v.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success(`Проверка завершена: найдено ${data.detected_count}, сопоставлено ${data.mapped_count}, не сопоставлено ${data.unmapped_count}`);
      qc.invalidateQueries({ queryKey: ["doc-template-versions", templateId] });
    } catch (e: any) {
      toast.error(`Ошибка проверки: ${e?.message || e}`);
    } finally {
      setBusyId(null);
    }
  };

  const handleActivate = async (v: VersionRow) => {
    if (v.validation_status === "invalid_unknown_required") {
      toast.error("Нельзя активировать версию: есть ошибки в обязательных полях");
      return;
    }
    setBusyId(v.id);
    try {
      const { data, error } = await supabase.functions.invoke("canonical-document-generate", {
        body: { mode: "activate_version", template_version_id: v.id },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      toast.success("Версия активирована");
      qc.invalidateQueries({ queryKey: ["doc-template-versions", templateId] });
      qc.invalidateQueries({ queryKey: ["doc-templates-canonical-vers"] });
    } catch (e: any) {
      toast.error(`Не удалось активировать: ${e?.message || e}`);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          Версии Word-шаблонов
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-xs text-muted-foreground rounded-md bg-blue-50/50 border border-blue-200 p-2">
          Здесь система проверяет Word-шаблоны: какие плейсхолдеры найдены, какие уже связаны с полями системы, а какие нужно сопоставить вручную.
        </div>
        <div className="flex items-center gap-2">
          <Select value={templateId} onValueChange={setTemplateId}>
            <SelectTrigger className="max-w-md"><SelectValue placeholder="Выберите шаблон" /></SelectTrigger>
            <SelectContent>
              {templates.map((t: any) => (
                <SelectItem key={t.id} value={t.id}>{t.name}{t.code ? ` · ${t.code}` : ""}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="outline" disabled={backfillBusy} onClick={() => runBackfill(true)}>
              {backfillBusy && <Loader2 className="h-3 w-3 animate-spin mr-1" />}
              Проверить все без изменений
            </Button>
            <Button size="sm" disabled={backfillBusy || !backfillResult} onClick={() => runBackfill(false)}>
              Проверить и обновить все версии
            </Button>
          </div>
        </div>
        {backfillResult && (
          <div className="text-xs rounded-md border bg-muted/40 p-2">
            <div>Всего: <b>{backfillResult.total_to_process}</b> · обновится: <b>{backfillResult.would_update}</b> · файлы не найдены: <b>{backfillResult.missing_files}</b> · не сопоставлено: <b>{backfillResult.total_unmapped}</b> · режим: <b>{backfillResult.dry_run ? "проверка без изменений" : "выполнение"}</b></div>
          </div>
        )}

        {isFetching && <div className="text-xs text-muted-foreground"><Loader2 className="h-3 w-3 animate-spin inline mr-1" /> Загружаем версии…</div>}

        {templateId && versions.length === 0 && !isFetching && (
          <div className="text-sm text-muted-foreground rounded-md bg-muted/40 p-3">
            У шаблона пока нет версий. Загрузите DOCX через менеджер шаблонов или создайте версию вручную.
          </div>
        )}

        <div className="space-y-2">
          {versions.map((v) => {
            const status = STATUS_BADGE[v.validation_status || "unchecked"];
            const Icon = status.icon;
            const detected = Array.isArray(v.detected_tokens) ? v.detected_tokens.length : 0;
            const manifest = Array.isArray(v.token_manifest) ? v.token_manifest : [];
            const mapped = manifest.filter((m: any) => m.status === "mapped").length;
            const unmapped = manifest.filter((m: any) => m.status === "unmapped").length;
            return (
              <div key={v.id} className="border rounded-md">
                <div className="flex items-center gap-3 p-3">
                  <div className="font-mono text-sm">v{v.version_number}</div>
                  {v.is_current && (
                    <Badge variant="outline" className="border-emerald-300 text-emerald-700">
                      <Star className="h-3 w-3 mr-1" /> текущая
                    </Badge>
                  )}
                  <Badge variant="outline" className={status.className}>
                    <Icon className="h-3 w-3 mr-1" /> {status.label}
                  </Badge>
                  <div className="text-xs text-muted-foreground">
                    найдено: <b>{detected}</b> · сопоставлено: <b>{mapped}</b> · не сопоставлено: <b className={unmapped > 0 ? "text-amber-700" : ""}>{unmapped}</b>
                  </div>
                  <div className="ml-auto flex items-center gap-2">
                    <Button size="sm" variant="outline" onClick={() => handleValidate(v)} disabled={busyId === v.id}>
                      {busyId === v.id ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <RefreshCw className="h-3 w-3 mr-1" />}
                      Проверить шаблон снова
                    </Button>
                    <Button
                      size="sm"
                      onClick={() => handleActivate(v)}
                      disabled={busyId === v.id || v.is_current || v.validation_status === "invalid_unknown_required"}
                    >
                      Сделать текущей
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setExpanded(expanded === v.id ? null : v.id)}>
                      {expanded === v.id ? "Скрыть" : "Плейсхолдеры"}
                    </Button>
                  </div>
                </div>
                {expanded === v.id && manifest.length > 0 && (
                  <div className="border-t p-3 text-xs space-y-1 max-h-72 overflow-auto">
                    {manifest.map((m: any) => (
                      <div key={m.token} className="flex items-start gap-2 py-0.5">
                        <code className="font-mono text-[11px]">{m.token}</code>
                        <Badge variant="outline" className={m.status === "mapped" ? "border-emerald-300 text-emerald-700" : "border-amber-300 text-amber-700"}>
                          {m.status === "mapped" ? "Сопоставлен" : "Не сопоставлен"}
                        </Badge>
                        {m.registry?.ui_label && <span className="text-muted-foreground">— {m.registry.ui_label}</span>}
                        <span className="ml-auto text-muted-foreground" title="Где найден плейсхолдер в DOCX">
                          {(m.locations || []).map((l: any) => `${l.part.replace("word/", "")} ×${l.count}`).join(", ")}
                        </span>
                        {m.status === "unmapped" && (
                          <>
                            <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => setMapDlg({ token: m.token, versionId: v.id })}>
                              <Wand2 className="h-3 w-3 mr-1" /> Связать с полем системы
                            </Button>
                            <Button size="sm" variant="ghost" className="h-6 px-2" onClick={() => { navigator.clipboard.writeText(`{{${m.token}}}`); toast.success("Скопировано"); }}>
                              <Copy className="h-3 w-3" />
                            </Button>
                          </>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                {v.validation_errors && (v.validation_errors as any[]).length > 0 && expanded === v.id && (
                  <div className="border-t p-3 text-xs bg-amber-50/40">
                    {(v.validation_errors as any[]).map((err: any, i: number) => (
                      <div key={i} className="text-amber-800">
                        <b>{err.code}</b>{err.count ? ` (${err.count})` : ""}: {err.hint || ""}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        {mapDlg && (
          <TokenMappingDialog
            open={!!mapDlg}
            onOpenChange={(o) => { if (!o) setMapDlg(null); }}
            token={mapDlg.token}
            templateId={templateId}
            templateVersionId={mapDlg.versionId}
            onMapped={() => qc.invalidateQueries({ queryKey: ["doc-template-versions", templateId] })}
          />
        )}
      </CardContent>
    </Card>
  );
}
