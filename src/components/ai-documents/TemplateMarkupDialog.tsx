/**
 * TemplateMarkupDialog — Sprint 11 C5-D
 *
 * DOCX-разметчик. НЕ редактор. DOCX-файл = source of truth.
 *  - LEFT: Word-like preview через mammoth.convertToHtml (таблицы/жирный/списки сохраняются).
 *  - RIGHT: единый список replacements (auto + manual), picker FLD, format/case, occurrence picker.
 *  - Manual replacement = выделить текст в preview → «Разметить выделенное».
 *  - Состояние единое (markupState), не сбрасывается при действиях.
 *  - Autosave в document_template_versions.markup_draft (debounced 1.5s).
 *  - Apply создаёт новую версию НЕ активной по умолчанию. Кнопка «Применить и активировать»
 *    активирует только при validation=valid.
 *
 * Strict rule: единственный допустимый плейсхолдер — `{{field:FLD-XXXXXX}}` с опциональными
 * `|format=...|case=...`.
 */
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { ChevronsUpDown, Check, Loader2, CheckCircle2, X, Pencil, Sparkles, Plus, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";
import mammoth from "mammoth";
import {
  buildAutoSuggestions,
  loadRegistryRefs,
  type MarkupSuggestion,
  type RegistryFieldRef,
} from "@/utils/templateAutoSuggest";
import { FieldFormatPicker } from "./FieldFormatPicker";
import { buildFieldPlaceholder, type FieldCase, type FieldFormat } from "./extensions/FieldChipNode";

// ───────────────────────── types ─────────────────────────

interface Replacement {
  id: string;
  source: "auto" | "manual";
  original_text: string;
  field_public_id: string | null;
  format: FieldFormat | null;
  case_modifier: FieldCase | null;
  data_type: string | null;
  placeholder: string | null;
  status: "suggested" | "accepted" | "changed" | "skipped" | "manually_added";
  occurrence_index: number | null;
  /** total occurrences in document (computed locally from preview text) */
  occurrences_total: number;
  reason?: string;
  confidence?: "high" | "medium" | "low";
}

interface MarkupDraft {
  version: 1;
  updated_at: string;
  replacements: Replacement[];
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  templateName: string;
  templateVersion: {
    id: string;
    template_id: string;
    storage_bucket: string;
    storage_path: string;
    file_name: string | null;
    version_number: number;
  } | null;
  onApplied?: () => void;
}

const CATEGORY_LABELS_RU: Record<string, string> = {
  executor: "Исполнитель", customer: "Заказчик", client: "Клиент",
  product: "Продукт", tariff: "Тариф", offer: "Оффер",
  legal_details: "Реквизиты", order: "Заказ", subscription: "Подписка",
  payment: "Платёж", company: "Компания", telegram_member: "Telegram-участник",
  custom: "Пользовательские", deal: "Сделка",
};

// ───────────────────── utilities ─────────────────────

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function countOccurrences(haystack: string, needle: string): number {
  if (!needle) return 0;
  let count = 0; let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) break;
    count++;
    from = idx + needle.length;
  }
  return count;
}

/** Sanitize HTML produced by mammoth: drop scripts, inline styles preserved by mammoth. */
function sanitizeMammothHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "");
}

// ───────────────────── component ─────────────────────

export function TemplateMarkupDialog({
  open, onOpenChange, templateName, templateVersion, onApplied,
}: Props) {
  const [loading, setLoading] = useState(false);
  const [plainText, setPlainText] = useState("");
  const [previewHtml, setPreviewHtml] = useState("");
  const [refs, setRefs] = useState<RegistryFieldRef[]>([]);
  const [replacements, setReplacements] = useState<Replacement[]>([]);
  const [applying, setApplying] = useState(false);
  const [activating, setActivating] = useState(false);
  const [draftLoaded, setDraftLoaded] = useState(false);
  const [hasDraftSaved, setHasDraftSaved] = useState(false);
  const [autoSuggesting, setAutoSuggesting] = useState(false);
  const previewRef = useRef<HTMLDivElement | null>(null);

  // ── load DOCX, build preview HTML, load draft or build auto-suggestions ──
  useEffect(() => {
    if (!open || !templateVersion) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setReplacements([]);
      setPlainText("");
      setPreviewHtml("");
      setDraftLoaded(false);
      try {
        const { data: blob, error } = await supabase.storage
          .from(templateVersion.storage_bucket)
          .download(templateVersion.storage_path);
        if (error) throw error;
        const ab = await blob.arrayBuffer();
        const [rawTxt, htmlRes, registry, draftRow] = await Promise.all([
          mammoth.extractRawText({ arrayBuffer: ab }),
          mammoth.convertToHtml({ arrayBuffer: ab }),
          loadRegistryRefs(),
          supabase.from("document_template_versions")
            .select("markup_draft").eq("id", templateVersion.id).maybeSingle(),
        ]);
        if (cancelled) return;
        const txt = rawTxt.value;
        setPlainText(txt);
        setPreviewHtml(sanitizeMammothHtml(htmlRes.value));
        setRefs(registry);

        const draft = (draftRow.data?.markup_draft ?? null) as unknown as MarkupDraft | null;
        if (draft && Array.isArray(draft.replacements) && draft.replacements.length > 0) {
          setReplacements(draft.replacements.map((r) => ({
            ...r,
            occurrences_total: countOccurrences(txt, r.original_text),
          })));
          toast.message("Восстановлен черновик разметки", {
            description: `Replacements: ${draft.replacements.length}. Сохранён ${new Date(draft.updated_at).toLocaleString("ru-RU")}`,
          });
        } else {
          // По умолчанию правая панель пустая. Auto-suggest запускается явной кнопкой.
          setReplacements([]);
        }
        setDraftLoaded(true);
        await supabase.functions.invoke("canonical-template-audit", {
          body: {
            event: "document_template.markup_started",
            template_id: templateVersion.template_id,
            template_version_id: templateVersion.id,
            meta: { has_draft: !!draft },
          },
        }).catch(() => undefined);
      } catch (e: any) {
        toast.error(`Ошибка открытия шаблона: ${e?.message ?? e}`);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, templateVersion]);

  // ── derived: refs by category ──
  const refsByCategory = useMemo(() => {
    const m = new Map<string, RegistryFieldRef[]>();
    for (const r of refs) {
      if (!m.has(r.category)) m.set(r.category, []);
      m.get(r.category)!.push(r);
    }
    return m;
  }, [refs]);

  // ── autosave draft (debounced) ──
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!draftLoaded || !templateVersion) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const draft: MarkupDraft = {
        version: 1,
        updated_at: new Date().toISOString(),
        replacements: replacements.map((r) => ({ ...r, occurrences_total: 0 })), // recompute on load
      };
      const { error } = await supabase.from("document_template_versions")
        .update({ markup_draft: draft as any })
        .eq("id", templateVersion.id);
      if (!error) setHasDraftSaved(true);
    }, 1500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [replacements, draftLoaded, templateVersion]);

  // ── ops ──
  const patch = (id: string, p: Partial<Replacement>) =>
    setReplacements((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)));

  const onAccept = (r: Replacement) => {
    if (!r.field_public_id) { toast.error("Сначала выберите поле"); return; }
    patch(r.id, {
      status: r.source === "manual" ? "manually_added" : "accepted",
      placeholder: buildFieldPlaceholder(r.field_public_id, r.format, r.case_modifier),
    });
  };
  const onSkip = (r: Replacement) => patch(r.id, { status: "skipped" });
  const onRemove = (r: Replacement) =>
    setReplacements((prev) => prev.filter((x) => x.id !== r.id));

  const onChangeField = (
    r: Replacement, fld: string,
    opts: { format: FieldFormat | null; caseModifier: FieldCase | null; data_type?: string | null },
  ) => {
    patch(r.id, {
      field_public_id: fld,
      format: opts.format,
      case_modifier: opts.caseModifier,
      data_type: opts.data_type ?? null,
      placeholder: buildFieldPlaceholder(fld, opts.format, opts.caseModifier),
      status: r.status === "suggested" ? "changed" : (r.source === "manual" ? "manually_added" : r.status),
    });
  };

  // ── manual replacement from preview selection ──
  const onAddFromSelection = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text) {
      toast.error("Выделите текст в preview, который нужно заменить на поле");
      return;
    }
    if (text.length > 200) {
      toast.error("Слишком длинное выделение (>200 симв.)");
      return;
    }
    const occ = countOccurrences(plainText, text);
    if (occ === 0) {
      toast.error("Текст не найден в plain-text DOCX. Возможно вы выделили часть таблицы — попробуйте короче.");
      return;
    }
    const newR: Replacement = {
      id: uid(),
      source: "manual",
      original_text: text,
      field_public_id: null,
      format: null,
      case_modifier: null,
      data_type: null,
      placeholder: null,
      status: "suggested",
      occurrence_index: occ === 1 ? 0 : null,
      occurrences_total: occ,
    };
    setReplacements((prev) => [newR, ...prev]);
    toast.success(`Добавлено: «${text.slice(0, 40)}${text.length > 40 ? "…" : ""}»${occ > 1 ? ` (${occ} вхождений — выберите конкретное)` : ""}`);
    sel?.removeAllRanges();
  };

  // ── auto-suggest (явный запуск по кнопке) ──
  const runAutoSuggest = async () => {
    if (!plainText) return;
    setAutoSuggesting(true);
    try {
      const sug = await buildAutoSuggestions(plainText);
      const existingTexts = new Set(replacements.map((r) => `${r.original_text}::${r.field_public_id ?? ""}`));
      const fresh: Replacement[] = sug
        .filter((s) => !existingTexts.has(`${s.original_text}::${s.field_public_id ?? ""}`))
        .map((s) => ({
          id: s.id,
          source: "auto",
          original_text: s.original_text,
          field_public_id: s.field_public_id,
          format: (s.format ?? null) as FieldFormat | null,
          case_modifier: (s.case_modifier ?? null) as FieldCase | null,
          data_type: s.data_type ?? null,
          placeholder: s.placeholder,
          status: s.status as Replacement["status"],
          occurrence_index: null,
          occurrences_total: countOccurrences(plainText, s.original_text),
          reason: s.reason,
          confidence: s.confidence,
        }));
      setReplacements((prev) => [...prev, ...fresh]);
      toast.success(`Авторазметка: добавлено ${fresh.length} предложений`);
    } catch (e: any) {
      toast.error(`Ошибка авторазметки: ${e?.message ?? e}`);
    } finally {
      setAutoSuggesting(false);
    }
  };

  const clearReplacements = () => {
    if (replacements.length === 0) return;
    if (!confirm("Очистить все разметки? Черновик будет очищен.")) return;
    setReplacements([]);
  };

  const acceptedCount = replacements.filter((r) =>
    r.status === "accepted" || r.status === "changed" || r.status === "manually_added"
  ).length;
  const ambiguousCount = replacements.filter((r) =>
    (r.status === "accepted" || r.status === "changed" || r.status === "manually_added") &&
    r.occurrences_total > 1 && r.occurrence_index == null
  ).length;
  const canApply = acceptedCount > 0 && ambiguousCount === 0;

  const buildPayload = () => replacements
    .filter((r) => (r.status === "accepted" || r.status === "changed" || r.status === "manually_added") && r.field_public_id)
    .map((r) => ({
      original_text: r.original_text,
      field_public_id: r.field_public_id!,
      format: r.format,
      case_modifier: r.case_modifier,
      placeholder: buildFieldPlaceholder(r.field_public_id!, r.format, r.case_modifier),
      status: r.status,
      occurrence_index: r.occurrence_index,
    }));

  const apply = async (activate: boolean) => {
    if (!templateVersion) return;
    if (!canApply) {
      if (ambiguousCount > 0) toast.error(`Есть ${ambiguousCount} неоднозначных совпадений — выберите occurrence`);
      else toast.error("Нет принятых разметок");
      return;
    }
    activate ? setActivating(true) : setApplying(true);
    try {
      const { data, error } = await supabase.functions.invoke("canonical-template-apply-markup", {
        body: { template_version_id: templateVersion.id, replacements: buildPayload(), activate },
      });
      if (error) throw error;
      const r = data as any;
      const valid = r?.validation?.status === "valid";
      const ambiguous = r?.ambiguous?.length ?? 0;
      const missed = r?.missed?.length ?? 0;
      toast.success(
        `Создана v${r?.new_version_number}: применено ${r?.applied_count}` +
        (missed ? `, не найдено: ${missed}` : "") +
        (ambiguous ? `, неоднозначных: ${ambiguous}` : "") +
        (r?.activated ? " · АКТИВНА" : valid ? " · valid (не активна)" : ` · ${r?.validation?.status}`),
        { duration: 8000 },
      );
      onApplied?.();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(`Ошибка применения: ${e?.message ?? e}`);
    } finally {
      setApplying(false); setActivating(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-7xl w-[calc(100vw-2rem)] max-h-[calc(100dvh-2rem)] flex flex-col">
        <DialogHeader className="flex-shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Pencil className="h-4 w-4" /> Разметка шаблона: {templateName}
          </DialogTitle>
          <DialogDescription>
            DOCX = source of truth. Размечайте исходный документ, не пересобирайте его.
            Strict ID-first: только <code className="font-mono">{`{{field:FLD-XXXXXX}}`}</code>.
            Формат/падеж — внутри placeholder.
            {hasDraftSaved && <span className="ml-2 text-emerald-600">· draft autosaved</span>}
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-16 flex-1">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid lg:grid-cols-2 gap-4 flex-1 min-h-0">
            {/* LEFT: Word-like preview */}
            <div className="flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-medium">DOCX preview (Word-like)</span>
                <span className="text-[11px] text-muted-foreground">
                  v{templateVersion?.version_number} · {templateVersion?.file_name}
                </span>
              </div>
              <ScrollArea className="flex-1 border rounded bg-card">
                <div
                  ref={previewRef}
                  className="docx-preview p-4 text-sm select-text"
                  dangerouslySetInnerHTML={{ __html: previewHtml || "<p class='text-muted-foreground'>Пусто</p>" }}
                />
              </ScrollArea>
              <div className="mt-2 flex items-center gap-2">
                <Button size="sm" variant="outline" onClick={onAddFromSelection}>
                  <Plus className="h-3.5 w-3.5 mr-1" /> Разметить выделенное
                </Button>
                <span className="text-[11px] text-muted-foreground">
                  Выделите текст в preview → нажмите кнопку → выберите FLD-поле справа.
                </span>
              </div>
            </div>

            {/* RIGHT: replacements panel */}
            <div className="flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-2 gap-2">
                <div className="flex items-center gap-2 text-xs">
                  <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                  Всего: <b>{replacements.length}</b> · принято: <b>{acceptedCount}</b>
                  {ambiguousCount > 0 && (
                    <Badge variant="outline" className="border-amber-400/60 text-amber-700 text-[10px]">
                      ambig: {ambiguousCount}
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="outline" className="h-7 text-[11px]"
                    onClick={runAutoSuggest} disabled={autoSuggesting || !plainText}>
                    {autoSuggesting ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Sparkles className="h-3 w-3 mr-1" />}
                    Найти автоматически
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-[11px] text-muted-foreground"
                    onClick={clearReplacements} disabled={replacements.length === 0}>
                    <Trash2 className="h-3 w-3 mr-1" /> Очистить
                  </Button>
                </div>
              </div>
              <ScrollArea className="flex-1 border rounded">
                <div className="divide-y">
                  {replacements.length === 0 ? (
                    <div className="text-center text-xs text-muted-foreground py-10 px-4 space-y-2">
                      <p className="font-medium text-foreground">Разметка пустая</p>
                      <p>
                        Выделите текст в preview слева → нажмите <b>«Разметить выделенное»</b> →
                        выберите FLD-поле.
                      </p>
                      <p className="opacity-70">
                        Или нажмите <b>«Найти автоматически»</b> для предварительных предложений.
                      </p>
                    </div>
                  ) : replacements.map((r) => (
                    <ReplacementRow
                      key={r.id}
                      r={r}
                      refs={refs}
                      refsByCategory={refsByCategory}
                      onAccept={() => onAccept(r)}
                      onSkip={() => onSkip(r)}
                      onRemove={() => onRemove(r)}
                      onChangeField={(fld, opts) => onChangeField(r, fld, opts)}
                      onChangeOccurrence={(idx) => patch(r.id, { occurrence_index: idx })}
                    />
                  ))}
                </div>
              </ScrollArea>
            </div>
          </div>
        )}

        <DialogFooter className="flex-shrink-0">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={applying || activating}>
            Закрыть
          </Button>
          <Button variant="outline" onClick={() => apply(false)} disabled={!canApply || applying || activating}>
            {applying ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
            Применить (создать версию)
          </Button>
          <Button onClick={() => apply(true)} disabled={!canApply || applying || activating}>
            {activating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
            Применить и активировать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────── ReplacementRow ───────────────────

function ReplacementRow({
  r, refs, refsByCategory,
  onAccept, onSkip, onRemove, onChangeField, onChangeOccurrence,
}: {
  r: Replacement;
  refs: RegistryFieldRef[];
  refsByCategory: Map<string, RegistryFieldRef[]>;
  onAccept: () => void;
  onSkip: () => void;
  onRemove: () => void;
  onChangeField: (fld: string, opts: { format: FieldFormat | null; caseModifier: FieldCase | null; data_type?: string | null }) => void;
  onChangeOccurrence: (idx: number | null) => void;
}) {
  const ambiguous = r.occurrences_total > 1 && r.occurrence_index == null &&
    (r.status === "accepted" || r.status === "changed" || r.status === "manually_added");
  return (
    <div className="p-2.5 text-xs space-y-1.5 hover:bg-muted/30">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-mono text-[11px] line-clamp-2">{r.original_text}</div>
          <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[9px] py-0">
              {r.source === "manual" ? "manual" : "auto"}
            </Badge>
            {r.reason && <span>{r.reason}</span>}
            {r.confidence && <span className="opacity-70">· {r.confidence}</span>}
            <span className="opacity-70">· вхождений: {r.occurrences_total}</span>
          </div>
        </div>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onRemove} title="Удалить">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <FieldPicker
        refs={refs}
        refsByCategory={refsByCategory}
        value={r.field_public_id}
        onChange={onChangeField}
      />

      {(r.format || r.case_modifier || r.placeholder) && (
        <div className="flex flex-wrap items-center gap-1 text-[10px]">
          {r.format && <span className="px-1.5 rounded bg-sky-100 text-sky-700">{r.format === "words" ? "прописью" : "текстом"}</span>}
          {r.case_modifier && <span className="px-1.5 rounded bg-amber-100 text-amber-700 font-mono">{r.case_modifier}</span>}
          {r.placeholder && <span className="font-mono text-muted-foreground truncate">{r.placeholder}</span>}
        </div>
      )}

      {r.occurrences_total > 1 && (
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] text-muted-foreground">Вхождение:</span>
          {Array.from({ length: r.occurrences_total }, (_, i) => (
            <Button
              key={i}
              size="sm"
              variant={r.occurrence_index === i ? "default" : "outline"}
              className="h-5 px-1.5 text-[10px] min-w-[28px]"
              onClick={() => onChangeOccurrence(r.occurrence_index === i ? null : i)}
            >
              {i + 1}
            </Button>
          ))}
          {ambiguous && (
            <span className="text-[10px] text-amber-600 inline-flex items-center gap-0.5">
              <AlertTriangle className="h-3 w-3" /> выберите вхождение
            </span>
          )}
        </div>
      )}

      <div className="flex items-center gap-1">
        {(r.status === "accepted" || r.status === "changed" || r.status === "manually_added") ? (
          <Badge variant="outline" className="text-[10px] border-emerald-400/50 text-emerald-600">
            <CheckCircle2 className="h-3 w-3 mr-0.5" /> {r.status}
          </Badge>
        ) : r.status === "skipped" ? (
          <Badge variant="outline" className="text-[10px] border-muted-foreground/30 text-muted-foreground">skipped</Badge>
        ) : (
          <>
            <Button size="sm" variant="default" className="h-6 px-2 text-[10px]" onClick={onAccept}>
              Принять
            </Button>
            <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={onSkip}>
              <X className="h-3 w-3" />
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

// ─────────────────── FieldPicker (reused) ───────────────────

function FieldPicker({
  refs, refsByCategory, value, onChange,
}: {
  refs: RegistryFieldRef[];
  refsByCategory: Map<string, RegistryFieldRef[]>;
  value: string | null;
  onChange: (v: string, opts: { format: FieldFormat | null; caseModifier: FieldCase | null; data_type?: string | null }) => void;
}) {
  const [open, setOpen] = useState(false);
  const [pickedField, setPickedField] = useState<RegistryFieldRef | null>(null);
  const selected = useMemo(
    () => refs.find((r) => r.field_public_id === value) ?? null,
    [refs, value],
  );
  useEffect(() => { if (!open) setPickedField(null); }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" role="combobox" aria-expanded={open}
          className="h-8 w-full justify-between text-xs font-normal px-2">
          {selected ? (
            <span className="flex items-center gap-2 min-w-0 truncate">
              <span className="font-mono text-[10px] text-muted-foreground shrink-0">{selected.field_public_id}</span>
              <span className="truncate">{selected.ui_label}</span>
            </span>
          ) : (
            <span className="text-muted-foreground">Выбрать поле…</span>
          )}
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="w-[var(--radix-popover-trigger-width)] min-w-[420px] p-0 bg-popover border shadow-lg z-[60] overflow-hidden"
        style={{ maxHeight: "min(520px, var(--radix-popover-content-available-height))" }}
      >
        {pickedField ? (
          <FieldFormatPicker
            dataType={pickedField.data_type}
            fieldPublicId={pickedField.field_public_id}
            fieldLabel={pickedField.ui_label}
            onCancel={() => setPickedField(null)}
            onConfirm={(sel) => {
              onChange(pickedField.field_public_id, {
                format: sel.format, caseModifier: sel.caseModifier,
                data_type: pickedField.data_type,
              });
              setPickedField(null); setOpen(false);
            }}
          />
        ) : (
          <Command
            className="flex flex-col h-full max-h-full overflow-hidden"
            filter={(itemValue, search) =>
              !search ? 1 : itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
            }
          >
            <CommandInput placeholder="Поиск по FLD, key, label…" className="h-9 text-xs" />
            <CommandList className="overflow-y-auto overscroll-contain flex-1" style={{ maxHeight: "440px" }}>
              <CommandEmpty className="py-6 text-center text-xs text-muted-foreground">Ничего не найдено</CommandEmpty>
              {Array.from(refsByCategory.entries()).map(([cat, items]) => (
                <CommandGroup key={cat} heading={CATEGORY_LABELS_RU[cat] ?? cat}>
                  {items.map((r) => {
                    const searchKey = `${r.field_public_id} ${r.token_key} ${r.ui_label}`;
                    const isSelected = value === r.field_public_id;
                    return (
                      <CommandItem key={r.field_public_id} value={searchKey}
                        onSelect={() => setPickedField(r)} className="text-xs py-1.5 gap-2">
                        <Check className={cn("h-3.5 w-3.5 shrink-0", isSelected ? "opacity-100" : "opacity-0")} />
                        <span className="font-mono text-[10px] text-muted-foreground shrink-0 w-[88px]">{r.field_public_id}</span>
                        <span className="flex-1 truncate">{r.ui_label}</span>
                        <span className="text-[10px] text-muted-foreground shrink-0">{r.data_type}</span>
                      </CommandItem>
                    );
                  })}
                </CommandGroup>
              ))}
            </CommandList>
          </Command>
        )}
      </PopoverContent>
    </Popover>
  );
}
