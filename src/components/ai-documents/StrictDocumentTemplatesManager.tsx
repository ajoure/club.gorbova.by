/**
 * StrictDocumentTemplatesManager — Sprint 11 C1.
 *
 * Strict ID-first DOCX template flow:
 *   upload .docx → preview placeholders + raw text → client-side strict validator
 *   → блокировка активации, пока validation_status != 'valid'.
 *
 * Каноническое правило (см. mem://architecture/documents/field-id-first-canon):
 *   единственный допустимый плейсхолдер — `{{field:FLD-XXXXXX}}`.
 *
 * Этот файл намеренно НЕ использует:
 *   - useDocumentTemplates (legacy hook со старой моделью template_path/code/document_type)
 *   - ai-generate-document* edge functions
 *   - generated_documents legacy таблицу
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Upload, FileText, Trash2, CheckCircle2, AlertTriangle, Sparkles, Pencil } from "lucide-react";
import { toast } from "sonner";
import mammoth from "mammoth";
import { extractDocxPlaceholders } from "@/utils/extractDocxPlaceholders";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { TemplateMarkupDialog } from "./TemplateMarkupDialog";

// Server-side audit (best-effort, never throws to UI)
async function auditEvent(
  event: string,
  payload: { template_id?: string | null; template_version_id?: string | null; meta?: Record<string, unknown> },
) {
  try {
    await supabase.functions.invoke("canonical-template-audit", {
      body: { event, ...payload },
    });
  } catch {
    /* swallow */
  }
}

// ───────────── strict validator ─────────────

const STRICT_PLACEHOLDER_RE = /^field:FLD-\d+$/;
const ANY_PLACEHOLDER_RE = /\{\{([^}]+)\}\}/g;

interface ValidationError {
  code:
    | "legacy_placeholder_format_detected"
    | "unknown_field_public_id"
    | "no_placeholders_in_template"
    | "docx_unreadable";
  placeholder?: string;
  message: string;
}

interface ValidationResult {
  status: "valid" | "invalid";
  errors: ValidationError[];
  recognized: Array<{ placeholder: string; field_public_id: string }>;
  raw_tokens: string[];
}

function buildStrict(publicId: string) {
  return `{{field:${publicId}}}`;
}

async function strictValidate(rawText: string, knownPublicIds: Set<string>): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const recognized: Array<{ placeholder: string; field_public_id: string }> = [];
  const raw_tokens: string[] = [];

  const seen = new Set<string>();
  for (const m of rawText.matchAll(ANY_PLACEHOLDER_RE)) {
    const inside = m[1].trim();
    if (seen.has(inside)) continue;
    seen.add(inside);
    raw_tokens.push(inside);

    if (!STRICT_PLACEHOLDER_RE.test(inside)) {
      errors.push({
        code: "legacy_placeholder_format_detected",
        placeholder: `{{${inside}}}`,
        message:
          `В шаблоне найден старый формат плейсхолдера «{{${inside}}}». ` +
          `Используйте только {{field:FLD-XXXXXX}}.`,
      });
      continue;
    }

    const publicId = inside.slice("field:".length);
    if (!knownPublicIds.has(publicId)) {
      errors.push({
        code: "unknown_field_public_id",
        placeholder: `{{${inside}}}`,
        message: `Field ID ${publicId} не найден в каталоге полей.`,
      });
      continue;
    }

    recognized.push({ placeholder: `{{${inside}}}`, field_public_id: publicId });
  }

  if (raw_tokens.length === 0) {
    errors.push({
      code: "no_placeholders_in_template",
      message: "В шаблоне не найдено ни одного плейсхолдера. Разметьте его перед активацией.",
    });
  }

  return {
    status: errors.length === 0 ? "valid" : "invalid",
    errors,
    recognized,
    raw_tokens,
  };
}

// ───────────── types ─────────────

interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  template_status: string;
  current_version_id: string | null;
  created_at: string;
}

interface VersionRow {
  id: string;
  template_id: string;
  version_number: number;
  storage_bucket: string;
  storage_path: string;
  file_name: string | null;
  file_size_bytes: number | null;
  is_current: boolean;
  validation_status: string | null;
  validation_errors: any[];
  validation_checked_at: string | null;
  detected_tokens: any[];
  token_manifest: any[];
  created_at: string;
}

// ───────────── component ─────────────

export function StrictDocumentTemplatesManager({ embedded = false }: { embedded?: boolean } = {}) {
  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [knownPublicIds, setKnownPublicIds] = useState<Set<string>>(new Set());

  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewText, setPreviewText] = useState<string>("");
  const [previewTokens, setPreviewTokens] = useState<string[]>([]);
  const [previewValidation, setPreviewValidation] = useState<ValidationResult | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadName, setUploadName] = useState("");
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [markupVersion, setMarkupVersion] = useState<VersionRow | null>(null);
  const [markupTemplateName, setMarkupTemplateName] = useState<string>("");
  const fetchAll = async () => {
    setLoading(true);
    const [{ data: t }, { data: v }, { data: f }] = await Promise.all([
      supabase
        .from("document_templates")
        .select("id, name, description, template_status, current_version_id, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("document_template_versions")
        .select("id, template_id, version_number, storage_bucket, storage_path, file_name, file_size_bytes, is_current, validation_status, validation_errors, validation_checked_at, detected_tokens, token_manifest, created_at")
        .order("created_at", { ascending: false }),
      supabase
        .from("fields_registry")
        .select("public_id")
        .not("public_id", "is", null)
        .is("archived_at", null),
    ]);
    setTemplates((t ?? []) as TemplateRow[]);
    setVersions(((v ?? []) as any[]).map(row => ({
      ...row,
      validation_errors: row.validation_errors ?? [],
      detected_tokens: row.detected_tokens ?? [],
      token_manifest: row.token_manifest ?? [],
    })) as VersionRow[]);
    setKnownPublicIds(new Set((f ?? []).map((x: any) => x.public_id).filter(Boolean)));
    setLoading(false);
  };

  useEffect(() => { fetchAll(); }, []);

  const versionsByTemplate = useMemo(() => {
    const m = new Map<string, VersionRow[]>();
    for (const v of versions) {
      if (!m.has(v.template_id)) m.set(v.template_id, []);
      m.get(v.template_id)!.push(v);
    }
    return m;
  }, [versions]);

  // ───────────── upload ─────────────

  const handleFilePick = (file: File | null) => {
    if (!file) { setUploadFile(null); return; }
    const lower = file.name.toLowerCase();
    if (!lower.endsWith(".docx")) {
      toast.error("Только .docx. .doc/.docm/.rtf/.zip запрещены.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Максимальный размер — 10 MB.");
      return;
    }
    setUploadFile(file);
    if (!uploadName) setUploadName(file.name.replace(/\.docx$/i, ""));
  };

  const handleUpload = async () => {
    if (!uploadFile || !uploadName.trim()) {
      toast.error("Укажите имя и выберите .docx");
      return;
    }
    setUploading(true);
    try {
      // 1. detect placeholders client-side (для записи в version snapshot)
      const detected = await extractDocxPlaceholders(uploadFile);

      // 2. upload to private bucket
      const ts = Date.now();
      const safeName = uploadFile.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `templates/${ts}-${safeName}`;
      const { error: upErr } = await supabase.storage
        .from("documents")
        .upload(storagePath, uploadFile, {
          cacheControl: "3600",
          upsert: false,
          contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        });
      if (upErr) throw upErr;

      // 3. create or reuse template row
      const { data: tmplIns, error: tmplErr } = await supabase
        .from("document_templates")
        .insert({
          name: uploadName.trim(),
          // legacy NOT NULL columns: заполняем минимально допустимыми значениями
          code: `tmpl_${ts}`,
          document_type: "act",
          template_path: storagePath,
          template_status: "draft",
          template_scope: "act",
          editor_mvp_enabled: false,
          is_active: false,
        })
        .select("id")
        .single();
      if (tmplErr) throw tmplErr;

      // 4. create version draft
      const { error: verErr } = await supabase
        .from("document_template_versions")
        .insert({
          template_id: tmplIns.id,
          version_number: 1,
          storage_bucket: "documents",
          storage_path: storagePath,
          file_name: uploadFile.name,
          file_size_bytes: uploadFile.size,
          is_current: false,
          detected_tokens: detected,
          token_manifest: [],
          unmapped_tokens: [],
          tokens: detected,
          validation_status: "pending",
          validation_errors: [],
        });
      if (verErr) throw verErr;

      toast.success(`Шаблон загружен (${detected.length} плейсхолдеров найдено)`);
      auditEvent("document_template.uploaded", {
        template_id: tmplIns.id,
        meta: {
          file_name: uploadFile.name,
          file_size_bytes: uploadFile.size,
          detected_tokens_count: detected.length,
          storage_path: storagePath,
        },
      });
      setUploadOpen(false);
      setUploadFile(null);
      setUploadName("");
      await fetchAll();
    } catch (e: any) {
      console.error(e);
      toast.error(`Ошибка загрузки: ${e.message ?? e}`);
    } finally {
      setUploading(false);
    }
  };

  // ───────────── preview + validate ─────────────

  const openPreview = async (tpl: TemplateRow, ver: VersionRow) => {
    setActiveTemplateId(tpl.id);
    setActiveVersionId(ver.id);
    setPreviewLoading(true);
    setPreviewText("");
    setPreviewTokens([]);
    setPreviewValidation(null);
    auditEvent("document_template.preview_opened", {
      template_id: tpl.id,
      template_version_id: ver.id,
    });
    try {
      const { data, error } = await supabase.storage
        .from(ver.storage_bucket)
        .download(ver.storage_path);
      if (error) throw error;
      const ab = await data.arrayBuffer();
      const result = await mammoth.extractRawText({ arrayBuffer: ab });
      const text = result.value;
      setPreviewText(text);

      const tokens = Array.from(
        new Set(Array.from(text.matchAll(ANY_PLACEHOLDER_RE), m => m[1].trim()))
      );
      setPreviewTokens(tokens);

      const validation = await strictValidate(text, knownPublicIds);
      setPreviewValidation(validation);

      // Persist validation snapshot (best-effort)
      await supabase
        .from("document_template_versions")
        .update({
          validation_status: validation.status,
          validation_errors: validation.errors as any,
          validation_checked_at: new Date().toISOString(),
          detected_tokens: tokens as any,
        })
        .eq("id", ver.id);
      auditEvent(
        validation.status === "valid"
          ? "document_template.validation_passed"
          : "document_template.validation_failed",
        {
          template_id: tpl.id,
          template_version_id: ver.id,
          meta: {
            errors_count: validation.errors.length,
            recognized_count: validation.recognized.length,
            raw_tokens_count: validation.raw_tokens.length,
            error_codes: Array.from(new Set(validation.errors.map((e) => e.code))),
          },
        },
      );
      await fetchAll();
    } catch (e: any) {
      console.error(e);
      toast.error(`Не удалось открыть DOCX: ${e.message ?? e}`);
      setPreviewValidation({
        status: "invalid",
        errors: [{ code: "docx_unreadable", message: String(e.message ?? e) }],
        recognized: [],
        raw_tokens: [],
      });
      auditEvent("document_template.validation_failed", {
        template_id: tpl.id,
        template_version_id: ver.id,
        meta: { error_codes: ["docx_unreadable"], detail: String(e.message ?? e) },
      });
    } finally {
      setPreviewLoading(false);
    }
  };

  const activateVersion = async (tpl: TemplateRow, ver: VersionRow) => {
    if (ver.validation_status !== "valid") {
      toast.error("Активация заблокирована: validation_status != valid");
      return;
    }
    // TODO C3: server-side activation via edge `canonical-template-activate-version`
    // (RLS уже ограничивает доступ ролями admin/super_admin — см. proof C2).
    try {
      await supabase
        .from("document_template_versions")
        .update({ is_current: false })
        .eq("template_id", tpl.id)
        .neq("id", ver.id);
      const { error: e1 } = await supabase
        .from("document_template_versions")
        .update({ is_current: true })
        .eq("id", ver.id);
      if (e1) throw e1;
      const { error: e2 } = await supabase
        .from("document_templates")
        .update({ current_version_id: ver.id, template_status: "active" })
        .eq("id", tpl.id);
      if (e2) throw e2;
      toast.success("Шаблон активирован как текущий");
      auditEvent("document_template.version_activated", {
        template_id: tpl.id,
        template_version_id: ver.id,
        meta: { version_number: ver.version_number },
      });
      await fetchAll();
    } catch (e: any) {
      toast.error(`Ошибка активации: ${e.message ?? e}`);
    }
  };

  const openMarkup = (tpl: TemplateRow, ver: VersionRow) => {
    setMarkupTemplateName(tpl.name);
    setMarkupVersion(ver);
  };

  const deleteTemplate = async (id: string) => {
    try {
      const verRows = versions.filter(v => v.template_id === id);
      // Remove storage files
      for (const v of verRows) {
        await supabase.storage.from(v.storage_bucket).remove([v.storage_path]);
      }
      await supabase.from("document_template_versions").delete().eq("template_id", id);
      await supabase.from("document_templates").delete().eq("id", id);
      toast.success("Шаблон удалён");
      setDeleteId(null);
      if (activeTemplateId === id) {
        setActiveTemplateId(null);
        setActiveVersionId(null);
      }
      await fetchAll();
    } catch (e: any) {
      toast.error(`Ошибка удаления: ${e.message ?? e}`);
    }
  };

  const activeVersion = versions.find(v => v.id === activeVersionId) ?? null;
  const activeTemplate = templates.find(t => t.id === activeTemplateId) ?? null;

  // ───────────── render ─────────────

  return (
    <div className={embedded ? "" : "p-4"}>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileText className="h-5 w-5 text-orange-500" />
            Шаблоны документов
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Strict ID-first.&nbsp;
            Допустим только формат <code>{`{{field:FLD-XXXXXX}}`}</code>.
            Активация заблокирована, пока validation_status ≠ valid.
          </p>
        </div>
        <Button onClick={() => setUploadOpen(true)} size="sm">
          <Upload className="h-4 w-4 mr-1" /> Загрузить .docx
        </Button>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        {/* Templates list */}
        <div className="border rounded-lg overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">
              Нет шаблонов. Загрузите первый .docx.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Шаблон</TableHead>
                  <TableHead className="w-[110px]">Статус</TableHead>
                  <TableHead className="w-[80px]">Версии</TableHead>
                  <TableHead className="w-[40px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map(t => {
                  const tplVers = versionsByTemplate.get(t.id) ?? [];
                  const cur = tplVers.find(v => v.is_current);
                  return (
                    <>
                      <TableRow
                        key={t.id}
                        className={activeTemplateId === t.id ? "bg-muted/50" : ""}
                      >
                        <TableCell>
                          <div className="font-medium text-sm">{t.name}</div>
                          {t.description && (
                            <div className="text-[11px] text-muted-foreground">{t.description}</div>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={t.template_status === "active" ? "default" : "secondary"} className="text-[10px]">
                            {t.template_status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">{tplVers.length}</TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" className="h-7 w-7"
                            onClick={() => setDeleteId(t.id)}>
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                      {tplVers.map(v => (
                        <TableRow
                          key={v.id}
                          className={activeVersionId === v.id ? "bg-muted/40" : "cursor-pointer hover:bg-muted/20"}
                          onClick={() => openPreview(t, v)}
                        >
                          <TableCell className="pl-8 text-xs">
                            v{v.version_number} · {v.file_name}
                            <div className="text-[10px] text-muted-foreground">
                              {format(new Date(v.created_at), "dd.MM.yyyy HH:mm", { locale: ru })}
                            </div>
                          </TableCell>
                          <TableCell>
                            <ValidationBadge status={v.validation_status} />
                            {v.is_current && (
                              <Badge variant="default" className="ml-1 text-[9px]">current</Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-xs text-muted-foreground">
                            {(v.detected_tokens?.length ?? 0)}
                          </TableCell>
                          <TableCell></TableCell>
                        </TableRow>
                      ))}
                    </>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </div>

        {/* Preview pane */}
        <div className="border rounded-lg p-3">
          {!activeVersion ? (
            <div className="text-sm text-muted-foreground text-center py-10">
              Выберите версию шаблона для preview и валидации.
            </div>
          ) : previewLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-sm font-medium">{activeTemplate?.name}</div>
                  <div className="text-[11px] text-muted-foreground">
                    v{activeVersion.version_number} · {activeVersion.file_name} ·{" "}
                    {((activeVersion.file_size_bytes ?? 0) / 1024).toFixed(1)} KB
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => openMarkup(activeTemplate!, activeVersion)}
                >
                  <Pencil className="h-3.5 w-3.5 mr-1" /> Разметить
                </Button>
              </div>

              {previewValidation && (
                <ValidationSummary
                  validation={previewValidation}
                  onActivate={() => activateVersion(activeTemplate!, activeVersion)}
                  alreadyCurrent={activeVersion.is_current}
                />
              )}

              <div>
                <Label className="text-xs">Найдено плейсхолдеров: {previewTokens.length}</Label>
                {previewTokens.length === 0 ? (
                  <div className="text-xs text-amber-600 mt-1">
                    Шаблон ещё не размечен. Выберите поля и примените разметку.
                  </div>
                ) : (
                  <ScrollArea className="h-32 border rounded mt-1 p-2">
                    <div className="flex flex-wrap gap-1">
                      {previewTokens.map(tk => {
                        const isStrict = STRICT_PLACEHOLDER_RE.test(tk);
                        return (
                          <Badge
                            key={tk}
                            variant={isStrict ? "secondary" : "destructive"}
                            className="font-mono text-[10px]"
                          >
                            {`{{${tk}}}`}
                          </Badge>
                        );
                      })}
                    </div>
                  </ScrollArea>
                )}
              </div>

              <div>
                <Label className="text-xs">Текст документа (первые 3000 символов)</Label>
                <ScrollArea className="h-64 border rounded mt-1 p-2 bg-muted/20">
                  <pre className="text-[11px] whitespace-pre-wrap font-sans">
                    {previewText.slice(0, 3000)}
                    {previewText.length > 3000 && "\n…"}
                  </pre>
                </ScrollArea>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Upload dialog */}
      <AlertDialog open={uploadOpen} onOpenChange={setUploadOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Загрузить шаблон .docx</AlertDialogTitle>
            <AlertDialogDescription>
              Только .docx до 10 MB. Файл сохранится как draft, активация — после strict validation.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-3 py-2">
            <div>
              <Label>Имя шаблона</Label>
              <Input
                value={uploadName}
                onChange={e => setUploadName(e.target.value)}
                placeholder="Акт услуг — основной"
              />
            </div>
            <div>
              <Label>Файл .docx</Label>
              <Input
                type="file"
                accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                onChange={e => handleFilePick(e.target.files?.[0] ?? null)}
              />
              {uploadFile && (
                <div className="text-[11px] text-muted-foreground mt-1">
                  {uploadFile.name} · {(uploadFile.size / 1024).toFixed(1)} KB
                </div>
              )}
            </div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={uploading}>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleUpload} disabled={uploading || !uploadFile || !uploadName.trim()}>
              {uploading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />}
              Загрузить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteId} onOpenChange={o => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить шаблон?</AlertDialogTitle>
            <AlertDialogDescription>
              Все версии и файлы будут удалены безвозвратно.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteId && deleteTemplate(deleteId)}>
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ValidationBadge({ status }: { status: string | null }) {
  if (status === "valid") {
    return <Badge variant="outline" className="text-[10px] border-emerald-400/40 text-emerald-600">valid</Badge>;
  }
  if (status === "invalid") {
    return <Badge variant="outline" className="text-[10px] border-destructive/40 text-destructive">invalid</Badge>;
  }
  return <Badge variant="outline" className="text-[10px] text-muted-foreground">pending</Badge>;
}

function ValidationSummary({
  validation,
  onActivate,
  alreadyCurrent,
}: {
  validation: ValidationResult;
  onActivate: () => void;
  alreadyCurrent: boolean;
}) {
  const isValid = validation.status === "valid";
  return (
    <div className={`border rounded p-3 ${isValid ? "border-emerald-400/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm">
          {isValid
            ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            : <AlertTriangle className="h-4 w-4 text-destructive" />}
          <span className="font-medium">
            {isValid ? "Validation: valid" : `Validation: invalid (${validation.errors.length})`}
          </span>
          <span className="text-xs text-muted-foreground">
            recognized: {validation.recognized.length} · raw: {validation.raw_tokens.length}
          </span>
        </div>
        <Button
          size="sm"
          variant={isValid && !alreadyCurrent ? "default" : "outline"}
          disabled={!isValid || alreadyCurrent}
          onClick={onActivate}
        >
          <Sparkles className="h-3.5 w-3.5 mr-1" />
          {alreadyCurrent ? "Уже текущая" : "Сделать текущей"}
        </Button>
      </div>
      {!isValid && (
        <ul className="mt-2 space-y-1 text-xs">
          {validation.errors.slice(0, 8).map((e, i) => (
            <li key={i} className="text-destructive">
              <Badge variant="outline" className="mr-1 text-[9px] border-destructive/40 text-destructive">
                {e.code}
              </Badge>
              {e.message}
            </li>
          ))}
          {validation.errors.length > 8 && (
            <li className="text-muted-foreground">…ещё {validation.errors.length - 8}</li>
          )}
        </ul>
      )}
    </div>
  );
}
