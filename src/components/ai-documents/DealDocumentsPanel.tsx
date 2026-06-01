/**
 * DealDocumentsPanel — Sprint 11 C3.
 *
 * Per-deal admin panel for the strict ID-first document pipeline:
 *   1. Pick an active template (current_version_id, validation_status='valid').
 *   2. Show its FLD-IDs from token_manifest (fallback: detected_tokens).
 *   3. Show current snapshot value from orders_v2.meta.document_data.fields[FLD-...].
 *   4. Edit values inline — saved via canonical-deal-fields-update (audit + manual_override).
 *   5. Preview resolved values (canonical-document-generate-strict mode=preview).
 *   6. Block generation when any required field is empty.
 *   7. Generate DOCX (mode=generate) → ai_generated_documents row + signed URL.
 *   8. List ai_generated_documents history for this deal (with download).
 *
 * Strict rules (no legacy):
 *   - Only {{field:FLD-XXXXXX}} placeholders are recognised.
 *   - Никогда не редактирует product/tariff/order_number/final_price.
 *   - Email/Telegram/auto-generation НЕ триггерятся.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, FileText, Download, Eye, Sparkles, RefreshCw, AlertCircle, FileType2, UserCog, Wand2, ExternalLink } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { normalizeEdgeFunctionError, normalizeEdgeFunctionErrorAsync } from "@/utils/normalizeEdgeFunctionError";
import { HelpTooltip } from "@/components/help/HelpComponents";
import { useHasRoleV2 } from "@/hooks/useHasRoleV2";
import { downloadDocumentBlob } from "@/utils/downloadDocumentBlob";

// Executor FLD-IDs (entity_type='executor'). Hardcoded fast path; UI also
// filters by entity_type from fields_registry as the registry-driven SOT.
const EXECUTOR_FLD_IDS = new Set([
  "FLD-000103","FLD-000104","FLD-000105","FLD-000106","FLD-000107",
  "FLD-000108","FLD-000109","FLD-000110","FLD-000111","FLD-000112",
  "FLD-000150","FLD-000151","FLD-000152","FLD-000153","FLD-000154",
]);

interface TemplateOption {
  id: string;
  name: string;
  current_version_id: string | null;
}
interface ActiveVersion {
  id: string;
  version_number: number;
  token_manifest: any[];
  detected_tokens: any[];
  validation_status: string | null;
}
interface FieldRegEntry {
  public_id: string;
  label: string;
  data_type: string | null;
  entity_type: string | null;
}
interface FieldRow {
  field_public_id: string;
  label: string;
  data_type: string | null;
  required: boolean;
  value: any;
  source: string | null;
  manual_override: boolean;
  updated_at: string | null;
}
interface PreviewResult {
  found_field_ids: string[];
  required_empty_field_ids: string[];
  missing_field_ids: string[];
  source_trace: Record<string, any>;
  can_generate: boolean;
  resolved_tokens: Record<string, string>;
}
interface HistoryDoc {
  id: string;
  title: string;
  file_path: string | null;
  file_mime: string | null;
  storage_bucket: string;
  template_version: number | string | null;
  created_at: string;
  document_number: string | null;
  document_date: string | null;
  meta: Record<string, any> | null;
}

export function DealDocumentsPanel({ orderId }: { orderId: string }) {
  const [loading, setLoading] = useState(true);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const [activeVersion, setActiveVersion] = useState<ActiveVersion | null>(null);
  const [fieldRegistry, setFieldRegistry] = useState<Map<string, FieldRegEntry>>(new Map());
  const [orderMeta, setOrderMeta] = useState<any>({});
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [savingFlds, setSavingFlds] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [history, setHistory] = useState<HistoryDoc[]>([]);
  const [executorInfo, setExecutorInfo] = useState<{
    id: string | null;
    name: string;
    source: string | null;
    hasManualOverrideHistory: boolean;
  } | null>(null);
  const [rebuildingExecutor, setRebuildingExecutor] = useState(false);
  const [testingExecutor, setTestingExecutor] = useState(false);
  const [executorTestResult, setExecutorTestResult] = useState<null | {
    found: string[];
    resolved: { fid: string; label: string; value: string }[];
    empty: { fid: string; label: string }[];
  }>(null);

  const { hasRole: isAdmin } = useHasRoleV2("admin");
  const { hasRole: isSuperAdmin } = useHasRoleV2("super_admin");
  const canSeeDocx = isAdmin || isSuperAdmin;

  // ── load templates + history ─────────────────────────────────────────
  const fetchAll = async () => {
    setLoading(true);
    const [{ data: tmpls }, { data: ord }, { data: docs }, { data: regs }] = await Promise.all([
      supabase
        .from("document_templates")
        .select("id, name, current_version_id, template_status")
        .not("current_version_id", "is", null)
        .eq("template_status", "active")
        .is("deleted_at", null)
        .order("name"),
      supabase.from("orders_v2").select("meta").eq("id", orderId).maybeSingle(),
      supabase
        .from("ai_generated_documents")
        .select("id, title, file_path, file_mime, storage_bucket, template_version, created_at, document_number, document_date, meta")
        .eq("context_type", "order")
        .eq("context_id", orderId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false }),
      supabase
        .from("fields_registry")
        .select("public_id, label, data_type, entity_type")
        .is("archived_at", null),
    ]);
    setTemplates(((tmpls ?? []) as any[]).map((t) => ({
      id: t.id, name: t.name, current_version_id: t.current_version_id,
    })));
    setOrderMeta((ord?.meta as any) || {});
    setHistory((docs ?? []) as HistoryDoc[]);
    setFieldRegistry(new Map((regs ?? []).map((r: any) => [r.public_id, r])));
    setLoading(false);
  };
  useEffect(() => { fetchAll(); /* eslint-disable-next-line */ }, [orderId]);

  // Auto-select template from snapshot (one-shot, never overrides user choice)
  const autoSelectAppliedRef = useRef(false);
  useEffect(() => {
    if (autoSelectAppliedRef.current) return;
    if (selectedTemplateId) return;
    if (!templates.length) return;
    const snapshotTemplateId = orderMeta?.document_data?.template_id;
    if (!snapshotTemplateId) return;
    const exists = templates.some((t) => t.id === snapshotTemplateId);
    if (exists) {
      setSelectedTemplateId(snapshotTemplateId);
      autoSelectAppliedRef.current = true;
    } else {
      // Mark as attempted so we don't keep re-checking; warn once.
      autoSelectAppliedRef.current = true;
      console.warn("[DealDocumentsPanel] snapshot template_id not in active templates list", snapshotTemplateId);
    }
  }, [orderMeta, templates, selectedTemplateId]);

  // load active version when template selected
  useEffect(() => {
    if (!selectedTemplateId) { setActiveVersion(null); setPreview(null); return; }
    const tpl = templates.find((t) => t.id === selectedTemplateId);
    if (!tpl?.current_version_id) { setActiveVersion(null); return; }
    (async () => {
      const { data } = await supabase
        .from("document_template_versions")
        .select("id, version_number, token_manifest, detected_tokens, validation_status")
        .eq("id", tpl.current_version_id!)
        .maybeSingle();
      setActiveVersion(data ? {
        id: data.id,
        version_number: data.version_number,
        token_manifest: (data.token_manifest as any[]) ?? [],
        detected_tokens: (data.detected_tokens as any[]) ?? [],
        validation_status: data.validation_status,
      } : null);
      setPreview(null);
      setEdits({});
    })();
  }, [selectedTemplateId, templates]);

  // ── derive field rows ───────────────────────────────────────────────
  const fieldRows: FieldRow[] = useMemo(() => {
    if (!activeVersion) return [];
    const docFields = ((orderMeta?.document_data?.fields) || {}) as Record<string, any>;

    // 1. preferred: token_manifest (canonical strict)
    const manifest = activeVersion.token_manifest;
    let ids: Array<{ id: string; required: boolean }> = [];
    if (Array.isArray(manifest) && manifest.length > 0) {
      ids = manifest
        .filter((m: any) => typeof m?.field_public_id === "string")
        .map((m: any) => ({ id: m.field_public_id as string, required: m.required === true }));
    } else {
      // fallback: detected_tokens
      const dt = activeVersion.detected_tokens || [];
      const seen = new Set<string>();
      for (const tok of dt) {
        const inside = typeof tok === "string" ? tok : tok?.token ?? "";
        const m = String(inside).match(/^field:(FLD-\d+)$/);
        if (m && !seen.has(m[1])) { seen.add(m[1]); ids.push({ id: m[1], required: false }); }
      }
    }
    const uniq = new Map<string, { id: string; required: boolean }>();
    for (const x of ids) if (!uniq.has(x.id)) uniq.set(x.id, x);
    return Array.from(uniq.values())
      // HIDE-EXECUTOR: executor.* (entity_type='executor') не редактируется вручную.
      .filter(({ id }) => {
        if (EXECUTOR_FLD_IDS.has(id)) return false;
        const reg = fieldRegistry.get(id);
        if (reg?.entity_type === "executor") return false;
        return true;
      })
      .map(({ id, required }) => {
        const reg = fieldRegistry.get(id);
        const v = docFields[id];
        return {
          field_public_id: id,
          label: reg?.label || id,
          data_type: reg?.data_type ?? null,
          required,
          value: v?.value ?? null,
          source: v?.source ?? null,
          manual_override: !!v?.manual_override,
          updated_at: v?.updated_at ?? null,
        };
      }).sort((a, b) => a.field_public_id.localeCompare(b.field_public_id));
  }, [activeVersion, orderMeta, fieldRegistry]);

  // List of executor FLDs present in active version's manifest (for plate + test).
  const executorFldsInTemplate = useMemo<string[]>(() => {
    if (!activeVersion) return [];
    const ids: string[] = [];
    const manifest = activeVersion.token_manifest;
    if (Array.isArray(manifest) && manifest.length > 0) {
      for (const m of manifest) {
        const fid = (m as any)?.field_public_id;
        if (typeof fid === "string" && EXECUTOR_FLD_IDS.has(fid) && !ids.includes(fid)) ids.push(fid);
      }
    } else {
      for (const tok of activeVersion.detected_tokens || []) {
        const inside = typeof tok === "string" ? tok : (tok as any)?.token ?? "";
        const m = String(inside).match(/^field:(FLD-\d+)$/);
        if (m && EXECUTOR_FLD_IDS.has(m[1]) && !ids.includes(m[1])) ids.push(m[1]);
      }
    }
    return ids.sort();
  }, [activeVersion]);

  // Detect any historical manual_override on executor.* (warning trigger).
  const executorManualOverrideHistory = useMemo<string[]>(() => {
    const docFields = ((orderMeta?.document_data?.fields) || {}) as Record<string, any>;
    const arr: string[] = [];
    for (const fid of EXECUTOR_FLD_IDS) {
      const e = docFields[fid];
      if (e?.manual_override === true) arr.push(fid);
    }
    return arr;
  }, [orderMeta]);

  // Load executor display info when orderMeta changes.
  useEffect(() => {
    const docFields = ((orderMeta?.document_data?.fields) || {}) as Record<string, any>;
    const dd = orderMeta?.document_data || {};
    // Prefer executor_id stored at document_data root, fallback to FLD-000103 entry.
    const execId: string | null =
      (dd.executor_id as string | null) ||
      (docFields["FLD-000103"]?.executor_id as string | null) ||
      null;
    const execSource: string | null =
      (dd.executor_source as string | null) ||
      (docFields["FLD-000103"]?.source as string | null) ||
      null;
    if (!execId) {
      setExecutorInfo({
        id: null,
        name: "",
        source: execSource,
        hasManualOverrideHistory: executorManualOverrideHistory.length > 0,
      });
      return;
    }
    (async () => {
      const { data } = await supabase
        .from("executors")
        .select("id, full_name, short_name")
        .eq("id", execId)
        .maybeSingle();
      setExecutorInfo({
        id: execId,
        name: (data?.short_name || data?.full_name || "(не найден)") as string,
        source: execSource,
        hasManualOverrideHistory: executorManualOverrideHistory.length > 0,
      });
    })();
  }, [orderMeta, executorManualOverrideHistory]);

  // ── actions ────────────────────────────────────────────────────────
  const setEdit = (fid: string, v: string) => setEdits((p) => ({ ...p, [fid]: v }));

  const saveField = async (fid: string) => {
    const v = edits[fid];
    if (v === undefined) return;
    setSavingFlds((p) => new Set(p).add(fid));
    try {
      const { data, error } = await supabase.functions.invoke("canonical-deal-fields-update", {
        body: { order_id: orderId, updates: [{ field_public_id: fid, value: v }] },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success(`${fid} обновлён`);
      setEdits((p) => { const n = { ...p }; delete n[fid]; return n; });
      setPreview(null);
      await fetchAll();
    } catch (e: any) {
      toast.error(`Ошибка: ${e.message ?? e}`);
    } finally {
      setSavingFlds((p) => { const n = new Set(p); n.delete(fid); return n; });
    }
  };

  const runPreview = async () => {
    if (!selectedTemplateId) return;
    setPreviewLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("canonical-document-generate-strict", {
        body: { mode: "preview", order_id: orderId, template_id: selectedTemplateId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      setPreview(data as PreviewResult);
    } catch (e: any) {
      toast.error(`Тест: ${await normalizeEdgeFunctionErrorAsync(e)}`);
    } finally {
      setPreviewLoading(false);
    }
  };

  const runGenerate = async () => {
    if (!selectedTemplateId) return;
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("canonical-document-generate-strict", {
        body: { mode: "generate", order_id: orderId, template_id: selectedTemplateId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("PDF создан");
      const documentId = (data as any).document_id as string | undefined;
      if (documentId) {
        const r = await downloadDocumentBlob(documentId, "pdf");
        if (r.ok === false) toast.error(r.message);
      }
      await fetchAll();
    } catch (e: any) {
      toast.error(`Создание PDF: ${await normalizeEdgeFunctionErrorAsync(e)}`);
    } finally {
      setGenerating(false);
    }
  };

  const downloadHistory = async (docId: string, kind: "pdf" | "docx") => {
    const r = await downloadDocumentBlob(docId, kind);
    if (r.ok === false) toast.error(r.message);
  };

  const rebuildExecutor = async () => {
    setRebuildingExecutor(true);
    try {
      const { data, error } = await supabase.functions.invoke("canonical-deal-fields-update", {
        body: { order_id: orderId, mode: "rebuild_executor" },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      toast.success("Поля исполнителя пересобраны");
      setExecutorTestResult(null);
      setPreview(null);
      await fetchAll();
    } catch (e: any) {
      toast.error(`Пересборка: ${normalizeEdgeFunctionError(e, e?.context?.body ?? null)}`);
    } finally {
      setRebuildingExecutor(false);
    }
  };

  const testExecutor = async () => {
    if (!selectedTemplateId) { toast.error("Сначала выберите шаблон"); return; }
    setTestingExecutor(true);
    try {
      const { data, error } = await supabase.functions.invoke("canonical-document-generate-strict", {
        body: { mode: "preview", order_id: orderId, template_id: selectedTemplateId },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      const pv = data as PreviewResult;
      setPreview(pv);
      const found = (pv.found_field_ids || []).filter((f) => EXECUTOR_FLD_IDS.has(f));
      const resolved: { fid: string; label: string; value: string }[] = [];
      const empty: { fid: string; label: string }[] = [];
      for (const fid of found) {
        const reg = fieldRegistry.get(fid);
        const label = reg?.label || fid;
        const trace = (pv.source_trace as any)?.[fid];
        const status = trace?.status;
        const val = trace?.rendered_value ?? trace?.value ?? "";
        if (status === "resolved" && String(val).trim().length > 0) {
          resolved.push({ fid, label, value: String(val) });
        } else {
          empty.push({ fid, label });
        }
      }
      setExecutorTestResult({ found, resolved, empty });
      toast.success(`Поля исполнителя в шаблоне: всего ${found.length}, заполнено ${resolved.length}, пусто ${empty.length}.`);
    } catch (e: any) {
      toast.error(`Тест исполнителя: ${await normalizeEdgeFunctionErrorAsync(e)}`);
    } finally {
      setTestingExecutor(false);
    }
  };

  if (loading) {
    return <div className="p-4 flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
    </div>;
  }

  return (
    <div className="space-y-4 p-2">
      {/* Template picker */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium">Шаблон:</span>
        <Select value={selectedTemplateId ?? ""} onValueChange={(v) => setSelectedTemplateId(v || null)}>
          <SelectTrigger className="w-[320px]"><SelectValue placeholder="Выбрать активный шаблон" /></SelectTrigger>
          <SelectContent>
            {templates.length === 0 && (
              <div className="px-2 py-1 text-xs text-muted-foreground">Нет активных шаблонов</div>
            )}
            {templates.map((t) => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {activeVersion && (
          <Badge variant="outline" className="text-xs">v{activeVersion.version_number}</Badge>
        )}
      </div>

      {selectedTemplateId && activeVersion && (
        <>
          {/* Executor plate (read-only) */}
          <div className="border rounded-lg p-3 bg-muted/20 space-y-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-start gap-2 min-w-0">
                <UserCog className="h-4 w-4 mt-0.5 text-primary shrink-0" />
                <div className="min-w-0">
                  <div className="text-sm font-medium">
                    Исполнитель: {executorInfo?.name || <span className="text-muted-foreground">не определён</span>}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap mt-0.5">
                    {executorInfo?.source === "executor_offer" && <Badge variant="outline" className="text-[10px]">из настроек оффера</Badge>}
                    {executorInfo?.source === "executor_default" && <Badge variant="outline" className="text-[10px]">по умолчанию</Badge>}
                    {executorInfo?.source && executorInfo.source !== "executor_offer" && executorInfo.source !== "executor_default" && (
                      <Badge variant="outline" className="text-[10px]">{executorInfo.source}</Badge>
                    )}
                    {executorInfo?.id && <code className="text-[10px] font-mono">{executorInfo.id}</code>}
                    <span>Поля исполнителя подставляются автоматически.</span>
                  </div>
                </div>
              </div>
              <div className="flex gap-2 shrink-0">
                <HelpTooltip helpKey="" customShort="Проверить, какие поля исполнителя нужны этому шаблону и какие из них заполнены." alwaysShow>
                  <Button size="sm" variant="outline" onClick={testExecutor} disabled={testingExecutor}>
                    {testingExecutor ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Eye className="h-3 w-3 mr-1" />}
                    Протестировать
                  </Button>
                </HelpTooltip>
                <HelpTooltip helpKey="" customShort="Подтянуть свежие данные исполнителя из карточки в эту сделку." alwaysShow>
                  <Button size="sm" variant="outline" onClick={rebuildExecutor} disabled={rebuildingExecutor}>
                    {rebuildingExecutor ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Wand2 className="h-3 w-3 mr-1" />}
                    Пересобрать
                  </Button>
                </HelpTooltip>
                <Button size="sm" variant="ghost" asChild>
                  <Link to="/admin/ai" title="Открыть карточки исполнителей">
                    <ExternalLink className="h-3 w-3 mr-1" /> Исполнители
                  </Link>
                </Button>
              </div>
            </div>
            {executorInfo?.hasManualOverrideHistory && (
              <div className="text-xs text-amber-700 dark:text-amber-300 flex items-center gap-1">
                <AlertCircle className="h-3 w-3" />
                В этой сделке для отдельных полей исполнителя сохранены ручные значения — пересборка их не перетрёт. При необходимости очистите их вручную.
              </div>
            )}
            {executorFldsInTemplate.length > 0 && (
              <div className="text-[11px] text-muted-foreground">
                В шаблоне используется полей исполнителя: {executorFldsInTemplate.length}.
              </div>
            )}
            {executorTestResult && (
              <div className="border-t pt-2 mt-1 space-y-1 text-xs">
                <div className="font-medium">Результат теста:</div>
                <div>Найдено в шаблоне: {executorTestResult.found.length}; заполнено: {executorTestResult.resolved.length}; пусто: {executorTestResult.empty.length}</div>
                {executorTestResult.resolved.length > 0 && (
                  <ul className="text-emerald-700 dark:text-emerald-400 space-y-0.5">
                    {executorTestResult.resolved.map((r) => (
                      <li key={r.fid}><code className="font-mono">{r.fid}</code> · {r.label}: {r.value}</li>
                    ))}
                  </ul>
                )}
                {executorTestResult.empty.length > 0 && (
                  <ul className="text-amber-700 dark:text-amber-400 space-y-0.5">
                    {executorTestResult.empty.map((r) => (
                      <li key={r.fid}><code className="font-mono">{r.fid}</code> · {r.label}: пусто</li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          {/* Fields editor */}
          <div className="border rounded-lg">
            <div className="px-3 py-2 border-b flex items-center justify-between">
              <h3 className="text-sm font-semibold">Поля документа</h3>
              <div className="flex gap-2">
                <HelpTooltip helpKey="" customShort="Проверить, какие данные подставятся в документ, без его создания." alwaysShow>
                  <Button size="sm" variant="outline" onClick={runPreview} disabled={previewLoading}>
                    {previewLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Eye className="h-3 w-3 mr-1" />}
                    Тест
                  </Button>
                </HelpTooltip>
                <HelpTooltip helpKey="" customShort="Сформировать готовый PDF документа по этой сделке." alwaysShow>
                  <Button
                    size="sm"
                    onClick={runGenerate}
                    disabled={generating || !preview?.can_generate}
                    title={!preview ? "Сначала нажмите «Тест»" : !preview.can_generate ? "Заполните обязательные поля" : "Создать PDF"}
                  >
                    {generating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                    Создать PDF
                  </Button>
                </HelpTooltip>
              </div>
            </div>
            {fieldRows.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                В этом шаблоне нет полей для подстановки.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Поле</TableHead>
                    <TableHead>Код поля</TableHead>
                    <TableHead>Значение</TableHead>
                    <TableHead>Источник</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {fieldRows.map((row) => {
                    const editing = edits[row.field_public_id];
                    const trace = preview?.source_trace?.[row.field_public_id];
                    const isReqEmpty = preview?.required_empty_field_ids?.includes(row.field_public_id);
                    return (
                      <TableRow key={row.field_public_id}>
                        <TableCell className="font-medium text-sm">
                          {row.label}
                          {row.required && <span className="text-red-500 ml-1">*</span>}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {row.field_public_id}
                        </TableCell>
                        <TableCell>
                          <Input
                            value={editing !== undefined ? editing : (row.value == null ? "" : String(row.value))}
                            onChange={(e) => setEdit(row.field_public_id, e.target.value)}
                            className="h-8 text-sm"
                          />
                        </TableCell>
                        <TableCell className="text-xs">
                          {row.manual_override ? (
                            <Badge variant="secondary" className="text-[10px]">введено вручную</Badge>
                          ) : row.source ? (
                            <span className="text-muted-foreground">{row.source}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {isReqEmpty ? (
                            <span className="text-red-600 flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" /> обязательное, не заполнено
                            </span>
                          ) : trace?.status === "resolved" ? (
                            <span className="text-emerald-600">заполнено</span>
                          ) : trace?.status === "missing" ? (
                            <span className="text-amber-600">нет данных</span>
                          ) : trace?.status === "empty" ? (
                            <span className="text-amber-600">пусто</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <HelpTooltip helpKey="" customShort="Сохранить введённое значение в эту сделку." alwaysShow>
                            <Button
                              size="sm" variant="ghost"
                              disabled={editing === undefined || savingFlds.has(row.field_public_id)}
                              onClick={() => saveField(row.field_public_id)}
                            >
                              {savingFlds.has(row.field_public_id)
                                ? <Loader2 className="h-3 w-3 animate-spin" />
                                : "Сохранить"}
                            </Button>
                          </HelpTooltip>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
            {preview && !preview.can_generate && (
              <div className="px-3 py-2 border-t bg-red-50 dark:bg-red-950/20 text-xs text-red-700 dark:text-red-300 flex items-center gap-2">
                <AlertCircle className="h-3.5 w-3.5" />
                Создание PDF недоступно: не заполнено обязательных полей — {preview.required_empty_field_ids.length}.
              </div>
            )}
          </div>

          {/* History */}
          <div className="border rounded-lg">
            <div className="px-3 py-2 border-b flex items-center justify-between">
              <h3 className="text-sm font-semibold flex items-center gap-2">
                <FileText className="h-4 w-4" /> История документов сделки
              </h3>
              <Button size="sm" variant="ghost" onClick={fetchAll}>
                <RefreshCw className="h-3 w-3" />
              </Button>
            </div>
            {history.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">Пока документов нет.</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>№ документа</TableHead>
                    <TableHead>Дата документа</TableHead>
                    <TableHead>Название</TableHead>
                    <TableHead>Версия</TableHead>
                    <TableHead>Создан</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="text-sm font-mono font-semibold">
                        {d.document_number ? (
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(d.document_number!);
                              toast.success(`Скопировано: ${d.document_number}`);
                            }}
                            className="hover:text-primary transition-colors"
                            title="Копировать номер"
                          >
                            {d.document_number}
                          </button>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {d.document_date
                          ? format(new Date(d.document_date), "dd.MM.yyyy", { locale: ru })
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm">{d.title}</TableCell>
                      <TableCell className="text-xs">v{d.template_version ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(d.created_at), "dd.MM.yyyy HH:mm", { locale: ru })}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => downloadHistory(d.id, "pdf")}
                            disabled={!d.file_path}
                            title="Скачать PDF"
                          >
                            <Download className="h-3 w-3 mr-1" /> PDF
                          </Button>
                          {canSeeDocx && d.meta?.docx_storage_path && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => downloadHistory(d.id, "docx")}
                              title="Скачать DOCX (только для админов)"
                            >
                              <FileType2 className="h-3 w-3 mr-1" /> DOCX
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </>
      )}
    </div>
  );
}
