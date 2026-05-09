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
import { useEffect, useMemo, useState } from "react";
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
import { Loader2, FileText, Download, Eye, Sparkles, RefreshCw, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

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
  storage_bucket: string;
  template_version: number | string | null;
  created_at: string;
  document_number: string | null;
  document_date: string | null;
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

  // ── load templates + history ─────────────────────────────────────────
  const fetchAll = async () => {
    setLoading(true);
    const [{ data: tmpls }, { data: ord }, { data: docs }, { data: regs }] = await Promise.all([
      supabase
        .from("document_templates")
        .select("id, name, current_version_id, template_status")
        .not("current_version_id", "is", null)
        .eq("template_status", "active")
        .order("name"),
      supabase.from("orders_v2").select("meta").eq("id", orderId).maybeSingle(),
      supabase
        .from("ai_generated_documents")
        .select("id, title, file_path, storage_bucket, template_version, created_at")
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
    return Array.from(uniq.values()).map(({ id, required }) => {
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
      toast.error(`Preview: ${e.message ?? e}`);
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
      toast.success("Документ сформирован");
      const url = (data as any).download_url;
      if (url) window.open(url, "_blank");
      await fetchAll();
    } catch (e: any) {
      toast.error(`Генерация: ${e.message ?? e}`);
    } finally {
      setGenerating(false);
    }
  };

  const downloadDoc = async (doc: HistoryDoc) => {
    if (!doc.file_path) return;
    const { data, error } = await supabase.storage
      .from(doc.storage_bucket)
      .createSignedUrl(doc.file_path, 3600);
    if (error || !data?.signedUrl) { toast.error("Не удалось получить ссылку"); return; }
    window.open(data.signedUrl, "_blank");
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
          {/* Fields editor */}
          <div className="border rounded-lg">
            <div className="px-3 py-2 border-b flex items-center justify-between">
              <h3 className="text-sm font-semibold">Поля документа (FLD-ID)</h3>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={runPreview} disabled={previewLoading}>
                  {previewLoading ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Eye className="h-3 w-3 mr-1" />}
                  Preview
                </Button>
                <Button
                  size="sm"
                  onClick={runGenerate}
                  disabled={generating || !preview?.can_generate}
                  title={!preview ? "Сначала Preview" : !preview.can_generate ? "Заполните required" : ""}
                >
                  {generating ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                  Сформировать DOCX
                </Button>
              </div>
            </div>
            {fieldRows.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">
                В активной версии шаблона нет FLD-плейсхолдеров.
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Поле</TableHead>
                    <TableHead>FLD-ID</TableHead>
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
                            <Badge variant="secondary" className="text-[10px]">manual</Badge>
                          ) : row.source ? (
                            <span className="text-muted-foreground">{row.source}</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell className="text-xs">
                          {isReqEmpty ? (
                            <span className="text-red-600 flex items-center gap-1">
                              <AlertCircle className="h-3 w-3" /> required-empty
                            </span>
                          ) : trace?.status === "resolved" ? (
                            <span className="text-emerald-600">resolved</span>
                          ) : trace?.status === "missing" ? (
                            <span className="text-amber-600">missing</span>
                          ) : trace?.status === "empty" ? (
                            <span className="text-amber-600">empty</span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="sm" variant="ghost"
                            disabled={editing === undefined || savingFlds.has(row.field_public_id)}
                            onClick={() => saveField(row.field_public_id)}
                          >
                            {savingFlds.has(row.field_public_id)
                              ? <Loader2 className="h-3 w-3 animate-spin" />
                              : "Сохранить"}
                          </Button>
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
                Генерация заблокирована: {preview.required_empty_field_ids.length} required-полей пусто.
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
                    <TableHead>Название</TableHead>
                    <TableHead>Версия</TableHead>
                    <TableHead>Создан</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {history.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell className="text-sm">{d.title}</TableCell>
                      <TableCell className="text-xs">v{d.template_version ?? "—"}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(new Date(d.created_at), "dd.MM.yyyy HH:mm", { locale: ru })}
                      </TableCell>
                      <TableCell>
                        <Button size="sm" variant="ghost" onClick={() => downloadDoc(d)} disabled={!d.file_path}>
                          <Download className="h-3 w-3" />
                        </Button>
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
