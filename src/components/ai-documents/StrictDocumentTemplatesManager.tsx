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
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Upload, FileText, Trash2, CheckCircle2, AlertTriangle, Sparkles, Pencil, ChevronDown } from "lucide-react";
import { toast } from "sonner";
import mammoth from "mammoth";
import { extractDocxPlaceholders } from "@/utils/extractDocxPlaceholders";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { TemplateMarkupDialog } from "./TemplateMarkupDialog";
import { FileNameTemplateEditor } from "./FileNameTemplateEditor";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";

// C5-I: понятные сообщения для ошибок activation backend
function mapActivationError(raw: string | undefined | null, data?: any): string {
  const code = (data?.error || raw || "").toString();
  const s = code.toLowerCase();
  if (s.includes("cannot_activate_invalid_version")) {
    return "Шаблон содержит ошибки в плейсхолдерах. Откройте «Проверка и исправление плейсхолдеров» и исправьте их.";
  }
  if (s.includes("cannot_activate_unmarked_version")) {
    return "Шаблон не размечен. Откройте «Проверка и исправление плейсхолдеров».";
  }
  if (s.includes("forbidden")) {
    return "Недостаточно прав для активации шаблона.";
  }
  if (s.includes("unauthorized")) {
    return "Сессия истекла. Войдите заново.";
  }
  if (s.includes("version_not_found")) {
    return "Версия шаблона не найдена. Обновите список.";
  }
  return normalizeEdgeFunctionError(raw, data);
}

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
//
// Канонический контракт (синхронно с backend `canonical-template-apply-markup`
// и `canonical-document-generate-strict`):
//   {{field:FLD-XXXXXX}}
//   {{field:FLD-XXXXXX|format=words}}
//   {{field:FLD-XXXXXX|format=text}}
//   {{field:FLD-XXXXXX|case=<allowed>}}
//   {{field:FLD-XXXXXX|format=words|case=<allowed>}}

const ALLOWED_CASES = new Set([
  "nominative", "genitive", "dative", "accusative", "instrumental", "prepositional",
]);
const ALLOWED_FORMATS = new Set(["words", "text"]);
const STRICT_FIELD_RE = /^field:(FLD-\d+)((?:\|[a-z_]+=[a-z_]+)*)$/;
const FIELD_PREFIX_RE = /^field:FLD-\d+(\||$)/;
export const STRICT_PLACEHOLDER_RE = STRICT_FIELD_RE;
const ANY_PLACEHOLDER_RE = /\{\{([^}]+)\}\}/g;

interface ValidationError {
  code:
    | "legacy_placeholder_format_detected"
    | "unknown_modifier"
    | "unknown_field_public_id"
    | "no_placeholders_in_template"
    | "docx_unreadable";
  placeholder?: string;
  message: string;
}

interface RecognizedToken {
  placeholder: string;
  field_public_id: string;
  format: "words" | "text" | null;
  case_modifier:
    | "nominative" | "genitive" | "dative" | "accusative"
    | "instrumental" | "prepositional" | null;
}

interface ValidationResult {
  status: "valid" | "invalid";
  errors: ValidationError[];
  recognized: RecognizedToken[];
  raw_tokens: string[];
}

function parseStrictInside(inside: string):
  | { ok: true; field_public_id: string; format: RecognizedToken["format"]; case_modifier: RecognizedToken["case_modifier"] }
  | { ok: false; error: "legacy_or_invalid" | "unknown_modifier" } {
  const m = inside.match(STRICT_FIELD_RE);
  if (!m) {
    if (FIELD_PREFIX_RE.test(inside)) return { ok: false, error: "unknown_modifier" };
    return { ok: false, error: "legacy_or_invalid" };
  }
  const fld = m[1];
  let format: RecognizedToken["format"] = null;
  let cs: RecognizedToken["case_modifier"] = null;
  for (const part of (m[2] || "").split("|").filter(Boolean)) {
    const [k, v] = part.split("=");
    if (k === "format") {
      if (!ALLOWED_FORMATS.has(v)) return { ok: false, error: "unknown_modifier" };
      format = v as "words" | "text";
    } else if (k === "case") {
      if (!ALLOWED_CASES.has(v)) return { ok: false, error: "unknown_modifier" };
      cs = v as RecognizedToken["case_modifier"];
    } else {
      return { ok: false, error: "unknown_modifier" };
    }
  }
  return { ok: true, field_public_id: fld, format, case_modifier: cs };
}

async function strictValidate(rawText: string, knownPublicIds: Set<string>): Promise<ValidationResult> {
  const errors: ValidationError[] = [];
  const recognized: RecognizedToken[] = [];
  const raw_tokens: string[] = [];

  const seen = new Set<string>();
  for (const m of rawText.matchAll(ANY_PLACEHOLDER_RE)) {
    const inside = m[1].trim();
    if (seen.has(inside)) continue;
    seen.add(inside);
    raw_tokens.push(inside);

    // Явный legacy-префикс — отдельная ошибка.
    if (/^(document|executor|customer|deal|cf)\./i.test(inside)) {
      errors.push({
        code: "legacy_placeholder_format_detected",
        placeholder: `{{${inside}}}`,
        message:
          `В шаблоне найден старый формат плейсхолдера «{{${inside}}}». ` +
          `Используйте только {{field:FLD-XXXXXX}}.`,
      });
      continue;
    }

    const parsed = parseStrictInside(inside);
    if (parsed.ok === false) {
      if (parsed.error === "unknown_modifier") {
        errors.push({
          code: "unknown_modifier",
          placeholder: `{{${inside}}}`,
          message:
            `Неподдерживаемый модификатор в «{{${inside}}}». ` +
            `Допустимы format=words, format=text и case=nominative|genitive|dative|accusative|instrumental|prepositional.`,
        });
      } else {
        errors.push({
          code: "legacy_placeholder_format_detected",
          placeholder: `{{${inside}}}`,
          message:
            `Невалидный плейсхолдер «{{${inside}}}». Допустим только {{field:FLD-XXXXXX}} ` +
            `с опциональными |format=...|case=...`,
        });
      }
      continue;
    }

    if (!knownPublicIds.has(parsed.field_public_id)) {
      errors.push({
        code: "unknown_field_public_id",
        placeholder: `{{${inside}}}`,
        message: `Field ID ${parsed.field_public_id} не найден в каталоге полей.`,
      });
      continue;
    }

    recognized.push({
      placeholder: `{{${inside}}}`,
      field_public_id: parsed.field_public_id,
      format: parsed.format,
      case_modifier: parsed.case_modifier,
    });
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
  category: string | null;
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
  markup_status: string | null;
  detected_tokens: any[];
  token_manifest: any[];
  created_at: string;
}

// ───────────── component ─────────────

/**
 * Канонические категории-пакеты для шаблонов документов.
 * Используется как `categoryFilter` в обёртке /document-generation → Документы.
 */
export const DOCUMENT_PACKAGE_CATEGORIES = {
  ideology: "ideology",
} as const;

export interface StrictDocumentTemplatesManagerProps {
  embedded?: boolean;
  /** Фильтр по document_templates.category. Если задан — список и upload скоупятся к этой категории. */
  categoryFilter?: string | null;
  /** Заголовок панели. По умолчанию — «Шаблоны документов». */
  title?: string;
  /** Подзаголовок панели. По умолчанию — strict-описание. */
  subtitle?: React.ReactNode;
  /** Текст empty-state. По умолчанию — «Нет шаблонов. Загрузите первый .docx.». */
  emptyText?: string;
}

export function StrictDocumentTemplatesManager({
  embedded = false,
  categoryFilter = null,
  title,
  subtitle,
  emptyText,
}: StrictDocumentTemplatesManagerProps = {}) {

  const [templates, setTemplates] = useState<TemplateRow[]>([]);
  const [versions, setVersions] = useState<VersionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [knownPublicIds, setKnownPublicIds] = useState<Set<string>>(new Set());

  const [activeTemplateId, setActiveTemplateId] = useState<string | null>(null);
  const [activeVersionId, setActiveVersionId] = useState<string | null>(null);
  const [openTemplates, setOpenTemplates] = useState<Set<string>>(new Set());
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
    let tplQuery = supabase
      .from("document_templates")
      .select("id, name, description, template_status, current_version_id, created_at, category")
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (categoryFilter) {
      tplQuery = tplQuery.eq("category", categoryFilter);
    }
    const [{ data: t }, { data: v }, { data: f }] = await Promise.all([
      tplQuery,
      supabase
        .from("document_template_versions")
        .select("id, template_id, version_number, storage_bucket, storage_path, file_name, file_size_bytes, is_current, validation_status, validation_errors, validation_checked_at, markup_status, detected_tokens, token_manifest, created_at")
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

  useEffect(() => { fetchAll(); }, [categoryFilter]);

        .select("id, template_id, version_number, storage_bucket, storage_path, file_name, file_size_bytes, is_current, validation_status, validation_errors, validation_checked_at, markup_status, detected_tokens, token_manifest, created_at")
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

  // Live-подсказка в форме: совпало ли имя с существующим шаблоном (case-insensitive)
  const matchedExistingTemplate = useMemo(() => {
    const name = uploadName.trim().toLowerCase();
    if (!name) return null;
    return templates.find(t => (t.name ?? "").trim().toLowerCase() === name) ?? null;
  }, [uploadName, templates]);

  const nextVersionNumberFor = (templateId: string): number => {
    const vers = versionsByTemplate.get(templateId) ?? [];
    const maxN = vers.reduce((acc, v) => Math.max(acc, v.version_number ?? 0), 0);
    return maxN + 1;
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

      // 3. Найти существующий шаблон по имени (case-insensitive, trim)
      //    Если найден — добавляем НОВУЮ ВЕРСИЮ к существующему template_id.
      //    Если нет — создаём новый template + версию 1.
      const trimmedName = uploadName.trim();
      const { data: existingRows } = await supabase
        .from("document_templates")
        .select("id, name, template_status, current_version_id, created_at, description")
        .is("deleted_at", null)
        .ilike("name", trimmedName);
      const existing = (existingRows ?? []).find(
        (r: any) => (r.name ?? "").trim().toLowerCase() === trimmedName.toLowerCase(),
      ) as any | undefined;

      let templateId: string;
      let templateName: string;
      let templateStatus: string;
      let templateCurrentVersionId: string | null;
      let templateCreatedAt: string;
      let templateDescription: string | null;
      let nextVersionNumber: number;
      let reusedTemplate = false;

      if (existing) {
        reusedTemplate = true;
        templateId = existing.id;
        templateName = existing.name;
        templateStatus = existing.template_status;
        templateCurrentVersionId = existing.current_version_id ?? null;
        templateCreatedAt = existing.created_at;
        templateDescription = existing.description ?? null;
        nextVersionNumber = nextVersionNumberFor(templateId);
      } else {
        const { data: tmplIns, error: tmplErr } = await supabase
          .from("document_templates")
          .insert({
            name: trimmedName,
            code: `tmpl_${ts}`,
            document_type: "act",
            template_path: storagePath,
            template_status: "draft",
            template_scope: "act",
            editor_mvp_enabled: false,
            is_active: false,
          })
          .select("id, created_at")
          .single();
        if (tmplErr) throw tmplErr;
        templateId = tmplIns.id;
        templateName = trimmedName;
        templateStatus = "draft";
        templateCurrentVersionId = null;
        templateCreatedAt = (tmplIns as any).created_at ?? new Date().toISOString();
        templateDescription = null;
        nextVersionNumber = 1;
      }

      // 4. Создаём версию (всегда — новая запись с инкрементированным номером)
      const { data: verIns, error: verErr } = await supabase
        .from("document_template_versions")
        .insert({
          template_id: templateId,
          version_number: nextVersionNumber,
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
        })
        .select("id")
        .single();
      if (verErr) throw verErr;

      if (reusedTemplate) {
        toast.success(`Добавлена версия v${nextVersionNumber} к шаблону «${templateName}»`);
      } else {
        toast.success(`Создан шаблон «${templateName}» (v1, ${detected.length} плейсхолдеров)`);
      }

      auditEvent(
        reusedTemplate ? "document_template.version_uploaded" : "document_template.uploaded",
        {
          template_id: templateId,
          template_version_id: verIns?.id ?? null,
          meta: {
            file_name: uploadFile.name,
            file_size_bytes: uploadFile.size,
            detected_tokens_count: detected.length,
            storage_path: storagePath,
            version_number: nextVersionNumber,
            reused_template: reusedTemplate,
          },
        },
      );

      setUploadOpen(false);
      setUploadFile(null);
      setUploadName("");
      await fetchAll();

      // C5-I: автопроверка сразу после загрузки + авто-активация при validation=valid
      try {
        const { data: freshVer } = await supabase
          .from("document_template_versions")
          .select("id, template_id, version_number, storage_bucket, storage_path, file_name, file_size_bytes, is_current, validation_status, validation_errors, validation_checked_at, markup_status, detected_tokens, token_manifest, created_at")
          .eq("template_id", templateId)
          .eq("storage_path", storagePath)
          .maybeSingle();
        if (freshVer) {
          const verRow: VersionRow = {
            ...(freshVer as any),
            validation_errors: (freshVer as any).validation_errors ?? [],
            detected_tokens: (freshVer as any).detected_tokens ?? [],
            token_manifest: (freshVer as any).token_manifest ?? [],
          };
          const tplRow: TemplateRow = {
            id: templateId,
            name: templateName,
            description: templateDescription,
            template_status: templateStatus,
            current_version_id: templateCurrentVersionId,
            created_at: templateCreatedAt,
            category: categoryFilter ?? (existing as any)?.category ?? null,
          };

          await openPreview(tplRow, verRow);

          // Авто-активация: если после валидации статус valid И разметка ок (или не требуется) —
          // молча активируем. Если разметка нужна — оставляем как draft и НЕ трогаем current.
          // Это безопасно: payment-кнопки ссылаются на template_id, версия меняется прозрачно.
          try {
            const { data: refreshed } = await supabase
              .from("document_template_versions")
              .select("id, validation_status, markup_status, is_current")
              .eq("id", verRow.id)
              .maybeSingle();
            const r = refreshed as any;
            const markupOk = !r?.markup_status || r.markup_status === "marked";
            if (r?.validation_status === "valid" && markupOk && !r?.is_current) {
              const { data: actData, error: actErr } = await supabase.functions.invoke(
                "canonical-template-activate-version",
                { body: { template_version_id: verRow.id } },
              );
              if (!actErr && !(actData as any)?.error) {
                toast.success(`v${nextVersionNumber} автоматически активирована`);
                await fetchAll();
              } else {
                // Не валим UI — пользователь увидит preview и сможет активировать вручную
                console.warn("[auto-activate] skipped", actErr, actData);
              }
            }
          } catch (e) {
            console.warn("[auto-activate] non-blocking", e);
          }
        }
      } catch (e) {
        console.warn("[c5i] auto-validate after upload failed (non-blocking)", e);
      }
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
    setOpenTemplates(prev => {
      if (prev.has(tpl.id)) return prev;
      const next = new Set(prev);
      next.add(tpl.id);
      return next;
    });
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

      // Build token_manifest (canonical shape, used by DealDocumentsPanel + strict generator).
      // Дедупликация по (field_public_id|format|case) — каждое уникальное сочетание = одна запись.
      const fieldMetaMap = new Map<string, { label: string; data_type: string | null }>();
      if (validation.recognized.length > 0) {
        const ids = Array.from(new Set(validation.recognized.map((r) => r.field_public_id)));
        const { data: regs } = await supabase
          .from("fields_registry")
          .select("public_id, label, data_type, is_required")
          .in("public_id", ids)
          .is("archived_at", null);
        for (const r of (regs ?? []) as any[]) {
          fieldMetaMap.set(r.public_id, { label: r.label ?? "", data_type: r.data_type ?? null });
        }
      }
      const manifestKey = (t: { field_public_id: string; format: string | null; case_modifier: string | null }) =>
        `${t.field_public_id}|${t.format ?? ""}|${t.case_modifier ?? ""}`;
      const manifestMap = new Map<string, any>();
      for (const t of validation.recognized) {
        const k = manifestKey(t);
        if (manifestMap.has(k)) continue;
        const meta = fieldMetaMap.get(t.field_public_id);
        manifestMap.set(k, {
          field_public_id: t.field_public_id,
          placeholder: t.placeholder,
          format: t.format,
          case_modifier: t.case_modifier,
          label: meta?.label ?? null,
          data_type: meta?.data_type ?? null,
          required: false,
        });
      }
      const tokenManifest = Array.from(manifestMap.values());

      // Persist validation snapshot + manifest (best-effort)
      await supabase
        .from("document_template_versions")
        .update({
          validation_status: validation.status,
          validation_errors: validation.errors as any,
          validation_checked_at: new Date().toISOString(),
          detected_tokens: tokens as any,
          token_manifest: tokenManifest as any,
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
      toast.error("Шаблон содержит ошибки. Откройте «Проверка и исправление плейсхолдеров».");
      return;
    }
    if (ver.markup_status && ver.markup_status !== "marked") {
      toast.message("Сначала примените разметку плейсхолдеров.", {
        description: "Открываю «Проверка и исправление плейсхолдеров».",
      });
      openMarkup(tpl, ver);
      return;
    }
    try {
      const { data, error } = await supabase.functions.invoke(
        "canonical-template-activate-version",
        { body: { template_version_id: ver.id } },
      );
      if (error) {
        toast.error(mapActivationError(error?.message, (error as any)?.context?.body ?? data));
        return;
      }
      if ((data as any)?.error) {
        toast.error(mapActivationError((data as any).error, data));
        return;
      }
      toast.success("Шаблон активирован");
      await fetchAll();
    } catch (e: any) {
      toast.error(mapActivationError(e?.message, e));
    }
  };

  const openMarkup = (tpl: TemplateRow, ver: VersionRow) => {
    setMarkupTemplateName(tpl.name);
    setMarkupVersion(ver);
  };

  const deleteTemplate = async (id: string) => {
    try {
      // Soft-delete: keep storage files and version rows for audit / возможный
      // восстанавливаемый rollback. Hard-delete production-шаблонов запрещён
      // STOP-guard PLACEHOLDERS-NORMALIZATION-v3.
      const { error } = await supabase
        .from("document_templates")
        .update({ deleted_at: new Date().toISOString() } as any)
        .eq("id", id);
      if (error) throw error;
      toast.success("Шаблон удалён (soft-delete)");
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
        {/* Templates list — accordion style (canonical, matches ContactDealsTab) */}
        <div className="min-w-0 space-y-2">
          {loading ? (
            <div className="flex justify-center py-10 border rounded-lg">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : templates.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground border rounded-lg">
              Нет шаблонов. Загрузите первый .docx.
            </div>
          ) : (
            templates.map(t => {
              const tplVers = versionsByTemplate.get(t.id) ?? [];
              const cur = tplVers.find(v => v.is_current);
              const isOpen = openTemplates.has(t.id);
              const isActiveTpl = activeTemplateId === t.id;
              return (
                <Collapsible
                  key={t.id}
                  open={isOpen}
                  onOpenChange={(open) => {
                    setOpenTemplates(prev => {
                      const next = new Set(prev);
                      if (open) next.add(t.id); else next.delete(t.id);
                      return next;
                    });
                  }}
                >
                  <div className={`bg-card border border-border/60 border-l-4 border-l-indigo-300 rounded-lg shadow-sm overflow-hidden ${isActiveTpl ? "ring-1 ring-indigo-300" : ""}`}>
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 hover:bg-accent/30 transition-colors text-left group min-w-0"
                      >
                        <div className="w-7 h-7 rounded-md bg-indigo-50 flex items-center justify-center shrink-0">
                          <FileText className="w-3.5 h-3.5 text-indigo-500" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium truncate">{t.name}</div>
                          {t.description && (
                            <div className="text-[11px] text-muted-foreground truncate">{t.description}</div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 flex-shrink-0 flex-wrap justify-end">
                          <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4">
                            {tplVers.length} верс.
                          </Badge>
                          {cur && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 bg-green-50 text-green-700 border-green-200">
                              current v{cur.version_number}
                            </Badge>
                          )}
                          <Badge
                            variant={t.template_status === "active" ? "default" : "secondary"}
                            className="text-[10px] px-1.5 py-0 h-4"
                          >
                            {t.template_status}
                          </Badge>
                          <span
                            role="button"
                            tabIndex={0}
                            aria-label="Удалить шаблон"
                            className="inline-flex h-7 w-7 items-center justify-center rounded-md hover:bg-destructive/10 cursor-pointer"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setDeleteId(t.id);
                            }}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                e.stopPropagation();
                                setDeleteId(t.id);
                              }
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5 text-destructive" />
                          </span>
                          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${isOpen ? "" : "-rotate-90"}`} />
                        </div>
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent>
                      <div className="space-y-1 px-2 pb-2">
                        {tplVers.length === 0 ? (
                          <div className="text-xs text-muted-foreground px-2.5 py-2">
                            Нет версий
                          </div>
                        ) : tplVers.map(v => {
                          const isActiveVer = activeVersionId === v.id;
                          const canActivate = !v.is_current
                            && v.validation_status === "valid"
                            && (!v.markup_status || v.markup_status === "marked");
                          return (
                            <div
                              key={v.id}
                              className={`flex flex-col sm:flex-row sm:items-center gap-1.5 sm:gap-2.5 px-2.5 py-2 rounded-md cursor-pointer hover:bg-accent/40 transition-colors ${isActiveVer ? "bg-muted/60" : ""}`}
                              onClick={() => openPreview(t, v)}
                            >
                              <div className="flex items-start sm:items-center gap-2.5 min-w-0 sm:flex-1">
                                <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center shrink-0">
                                  <FileText className="w-3 h-3 text-muted-foreground" />
                                </div>
                                <div className="min-w-0 flex-1">
                                  <div className="text-xs truncate">
                                    <span className="font-medium">v{v.version_number}</span>
                                    <span className="text-muted-foreground"> · {v.file_name}</span>
                                  </div>
                                  <div className="text-[10px] text-muted-foreground">
                                    {format(new Date(v.created_at), "dd.MM.yyyy HH:mm", { locale: ru })}
                                    {" · "}
                                    токенов: {v.detected_tokens?.length ?? 0}
                                  </div>
                                </div>
                              </div>
                              <div className="flex items-center gap-1.5 flex-wrap sm:flex-nowrap sm:justify-end">
                                <ValidationBadge status={v.validation_status} />
                                {v.is_current && (
                                  <Badge variant="default" className="text-[9px] px-1.5 py-0 h-4">current</Badge>
                                )}
                                {canActivate && (
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    className="h-6 px-2 text-[10px]"
                                    onClick={(e) => {
                                      e.preventDefault();
                                      e.stopPropagation();
                                      activateVersion(t, v);
                                    }}
                                  >
                                    Сделать активной
                                  </Button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </CollapsibleContent>
                  </div>
                </Collapsible>
              );
            })
          )}
        </div>


        {/* Preview pane */}
        <div className="border rounded-lg p-3 min-w-0 max-w-full overflow-hidden">
          {!activeVersion ? (
            <div className="text-sm text-muted-foreground text-center py-10">
              Выберите версию шаблона для preview и валидации.
            </div>
          ) : previewLoading ? (
            <div className="flex justify-center py-10">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3 min-w-0">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium break-words">{activeTemplate?.name}</div>
                  <div className="text-[11px] text-muted-foreground break-all">
                    v{activeVersion.version_number} · {activeVersion.file_name} ·{" "}
                    {((activeVersion.file_size_bytes ?? 0) / 1024).toFixed(1)} KB
                  </div>
                </div>
                <div className="flex flex-col sm:items-end gap-0.5 sm:shrink-0">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs w-full sm:w-auto whitespace-normal sm:whitespace-nowrap text-left sm:text-center"
                    onClick={() => openMarkup(activeTemplate!, activeVersion)}
                  >
                    <Pencil className="h-3 w-3 mr-1 shrink-0" /> Проверка и исправление плейсхолдеров
                  </Button>
                  <span className="text-[10px] text-muted-foreground">
                    Открывайте, только если в шаблоне есть ошибки
                  </span>
                </div>
              </div>

              {previewValidation && (
                <ValidationSummary
                  validation={previewValidation}
                  onActivate={() => activateVersion(activeTemplate!, activeVersion)}
                  onCopyPlaceholders={() => {
                    const list = (previewValidation.recognized || [])
                      .map((r) => r.placeholder)
                      .join("\n");
                    if (!list) {
                      toast.error("В шаблоне нет валидных FLD-плейсхолдеров");
                      return;
                    }
                    navigator.clipboard.writeText(list).then(
                      () => toast.success(`Скопировано плейсхолдеров: ${previewValidation.recognized.length}`),
                      () => toast.error("Не удалось скопировать"),
                    );
                  }}
                  alreadyCurrent={activeVersion.is_current}
                />
              )}

              {/* C5-I: блоки «Найдено плейсхолдеров» и «Текст документа»
                  убраны с основного экрана. При невалидной версии ошибки
                  уже видны в ValidationSummary; полный документ открывается
                  через «Проверка и исправление плейсхолдеров». */}

              {/* PATCH-B: шаблон имени файла при скачивании (FLD-first canon). */}
              {activeTemplate && (
                <FileNameTemplateEditor
                  templateId={activeTemplate.id}
                  templateName={activeTemplate.name}
                />
              )}
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
              {matchedExistingTemplate ? (
                <div className="text-[11px] text-emerald-600 mt-1">
                  Имя совпадает с существующим шаблоном — будет добавлена версия v{nextVersionNumberFor(matchedExistingTemplate.id)}. Настройки кнопок оплаты не изменятся.
                </div>
              ) : uploadName.trim() ? (
                <div className="text-[11px] text-muted-foreground mt-1">
                  Будет создан новый шаблон (v1).
                </div>
              ) : null}
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

      {/* Markup dialog */}
      <TemplateMarkupDialog
        open={!!markupVersion}
        onOpenChange={(o) => !o && setMarkupVersion(null)}
        templateName={markupTemplateName}
        templateVersion={markupVersion}
        onApplied={async () => {
          setMarkupVersion(null);
          await fetchAll();
        }}
      />
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
  onCopyPlaceholders,
  alreadyCurrent,
}: {
  validation: ValidationResult;
  onActivate: () => void;
  onCopyPlaceholders?: () => void;
  alreadyCurrent: boolean;
}) {
  const isValid = validation.status === "valid";
  return (
    <div className={`border rounded p-3 min-w-0 ${isValid ? "border-emerald-400/40 bg-emerald-500/5" : "border-destructive/40 bg-destructive/5"}`}>
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-3 min-w-0">
        <div className="flex items-start gap-2 text-sm min-w-0 flex-1">
          {isValid
            ? <CheckCircle2 className="h-4 w-4 text-emerald-600 mt-0.5 shrink-0" />
            : <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />}
          <div className="flex flex-col min-w-0">
            <span className="font-medium break-words">
              {isValid
                ? "Шаблон проверен — можно активировать"
                : `Найдено ошибок: ${validation.errors.length}`}
            </span>
            <span className="text-xs text-muted-foreground break-words">
              FLD-полей: {validation.recognized.length}
              {validation.raw_tokens.length !== validation.recognized.length
                ? ` · всего плейсхолдеров: ${validation.raw_tokens.length}`
                : ""}
            </span>
          </div>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-center gap-1.5 sm:shrink-0 w-full sm:w-auto">
          {isValid && onCopyPlaceholders && (
            <Button size="sm" variant="outline" className="h-8 w-full sm:w-auto" onClick={onCopyPlaceholders}>
              Скопировать плейсхолдеры
            </Button>
          )}
          <Button
            size="sm"
            variant={isValid && !alreadyCurrent ? "default" : "outline"}
            disabled={!isValid || alreadyCurrent}
            onClick={onActivate}
            className="w-full sm:w-auto"
          >
            <Sparkles className="h-3.5 w-3.5 mr-1 shrink-0" />
            {alreadyCurrent ? "Уже активен" : "Активировать шаблон"}
          </Button>
        </div>
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
