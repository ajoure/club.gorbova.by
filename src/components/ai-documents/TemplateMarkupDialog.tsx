/**
 * TemplateMarkupDialog — Sprint 11 C5-D-UX
 *
 * Визуальный редактор разметки DOCX. DOCX-файл = исходный шаблон.
 *  - Основная область: Word-like preview через mammoth.convertToHtml (на всю ширину).
 *  - Inline chips: вставленные поля показываются прямо в тексте как
 *      [Название поля · FLD-XXXXXX]. Сырой `{{field:FLD-…}}` пользователю не показывается.
 *  - Старые legacy-плейсхолдеры (`{{ld-…}}`, `{{document.…}}`, `{{cf:…}}` и т.п.)
 *      подсвечиваются жёлтым и кликабельны → открывают picker.
 *  - Выделение текста + кнопка «Вставить поле» → picker → chip.
 *  - Правая панель «Замены» и Sheet «Авторазметка» скрыты по умолчанию.
 *  - Autosave черновика в `document_template_versions.markup_draft` (debounced 1.5s).
 *  - Apply отдаёт backend контракт без изменений: original_text + occurrence_index +
 *      field_public_id + format + case_modifier. Backend сам строит {{field:FLD-…}}.
 *
 * Backend (canonical-template-apply-markup) НЕ менялся.
 */
import { useEffect, useMemo, useRef, useState, useCallback, type MouseEvent as ReactMouseEvent } from "react";
import { supabase } from "@/integrations/supabase/client";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  ChevronsUpDown, Check, Loader2, CheckCircle2, X, Pencil, Sparkles, Plus, Trash2,
  AlertTriangle, ListChecks, Wand2, Download,
} from "lucide-react";
import { toast } from "sonner";
import mammoth from "mammoth";
import {
  buildAutoSuggestions,
  loadRegistryRefs,
  type RegistryFieldRef,
} from "@/utils/templateAutoSuggest";
import { FieldFormatPicker } from "./FieldFormatPicker";
import { buildFieldPlaceholder, type FieldCase, type FieldFormat } from "./extensions/FieldChipNode";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";
import { FieldPickerPopover } from "./FieldPickerPopover";

// ───────────────────────── types ─────────────────────────

type ReplacementStatus = "suggested" | "accepted" | "changed" | "skipped" | "manually_added";

interface Replacement {
  id: string;
  source: "auto" | "manual";
  original_text: string;
  field_public_id: string | null;
  /** Русское название поля для отображения внутри chip. */
  visual_label: string | null;
  format: FieldFormat | null;
  case_modifier: FieldCase | null;
  data_type: string | null;
  status: ReplacementStatus;
  /** N-е вхождение original_text в plainText (0-based). null = ещё не выбрано или одно. */
  occurrence_index: number | null;
  /** Всего вхождений в plainText. */
  occurrences_total: number;
  /** Позиция найденного фрагмента в plainText для auto-suggest/draft recovery. */
  match_start?: number | null;
  match_end?: number | null;
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
  custom: "Пользовательские", deal: "Сделка", document: "Документ", system: "Системные поля",
};

const STATUS_LABEL_RU: Record<ReplacementStatus, string> = {
  suggested: "Предложено",
  accepted: "Принято",
  changed: "Изменено",
  skipped: "Пропущено",
  manually_added: "Вручную",
};

const SOURCE_LABEL_RU: Record<Replacement["source"], string> = {
  auto: "Авто",
  manual: "Вручную",
};

const ACCEPTED: ReplacementStatus[] = ["accepted", "changed", "manually_added"];
const isAccepted = (s: ReplacementStatus) => ACCEPTED.includes(s);

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

function occurrenceIndexFromMatchStart(haystack: string, needle: string, matchStart: number | null | undefined): number | null {
  if (!needle || typeof matchStart !== "number" || matchStart < 0) return null;
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) return null;
    if (idx === matchStart) return count;
    if (idx > matchStart) return null;
    count++;
    from = idx + needle.length;
  }
}

function nthIndexOf(haystack: string, needle: string, occurrenceIndex: number): number {
  if (!needle || occurrenceIndex < 0) return -1;
  let count = 0;
  let from = 0;
  while (true) {
    const idx = haystack.indexOf(needle, from);
    if (idx < 0) return -1;
    if (count === occurrenceIndex) return idx;
    count++;
    from = idx + needle.length;
  }
}

function resolveMissingOccurrenceIndexes(items: Replacement[], fullText: string): { next: Replacement[]; changed: number } {
  const used = new Map<string, Set<number>>();
  for (const r of items) {
    if (r.occurrence_index == null) continue;
    if (!used.has(r.original_text)) used.set(r.original_text, new Set());
    used.get(r.original_text)!.add(r.occurrence_index);
  }

  let changed = 0;
  const next = items.map((r) => {
    const total = countOccurrences(fullText, r.original_text);
    if (!isAccepted(r.status) || !r.field_public_id || total <= 1 || r.occurrence_index != null) {
      return { ...r, occurrences_total: total };
    }

    const occupied = used.get(r.original_text) ?? new Set<number>();
    let idx = occurrenceIndexFromMatchStart(fullText, r.original_text, r.match_start);
    if (idx == null || occupied.has(idx)) {
      idx = Array.from({ length: total }, (_, i) => i).find((i) => !occupied.has(i)) ?? null;
    }
    if (idx == null) return { ...r, occurrences_total: total };

    if (!used.has(r.original_text)) used.set(r.original_text, occupied);
    occupied.add(idx);
    changed++;
    return { ...r, occurrences_total: total, occurrence_index: idx };
  });

  return { next, changed };
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]!));
}

function sanitizeMammothHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "");
}

/** Все известные шаблоны legacy-плейсхолдеров, которые нужно подсветить как кликабельные. */
const LEGACY_PLACEHOLDER_RE = /\{\{(?!field:)[^{}]+\}\}/g;

/** Короткое русское название формата/падежа для подписи под chip. */
function formatSuffix(format: FieldFormat | null, caseModifier: FieldCase | null): string {
  const parts: string[] = [];
  if (format === "words") parts.push("прописью");
  else if (format === "text") parts.push("текстом");
  if (caseModifier) {
    const map: Record<FieldCase, string> = {
      nominative: "И.п.", genitive: "Р.п.", dative: "Д.п.",
      accusative: "В.п.", instrumental: "Т.п.", prepositional: "П.п.",
    };
    parts.push(map[caseModifier]);
  }
  return parts.join(" · ");
}

/**
 * Строит итоговый HTML для отображения:
 *  - все принятые replacements заменяются на chip <span data-chip-id>;
 *  - все необработанные legacy-плейсхолдеры → <mark data-legacy-text>.
 *
 * Идёт по text-нодам, не ломая теги таблиц/абзацев.
 */
function renderInteractiveHtml(
  baseHtml: string,
  replacements: Replacement[],
): string {
  if (!baseHtml) return "";
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div id="root">${baseHtml}</div>`, "text/html");
  const root = doc.getElementById("root");
  if (!root) return baseHtml;

  // 1) Replace accepted replacements (Nth occurrence) with chips.
  //    Counter per original_text across the whole document text content.
  const acceptedByText = new Map<string, Replacement[]>();
  for (const r of replacements) {
    if (!isAccepted(r.status) || !r.original_text) continue;
    if (!acceptedByText.has(r.original_text)) acceptedByText.set(r.original_text, []);
    acceptedByText.get(r.original_text)!.push(r);
  }

  for (const [text, list] of acceptedByText.entries()) {
    // Walker collects fresh each pass since DOM mutates.
    let occurrenceCounter = 0;
    const walker = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const textNodes: Text[] = [];
    let n: Node | null;
    while ((n = walker.nextNode())) textNodes.push(n as Text);

    for (const node of textNodes) {
      if (!node.parentNode) continue;
      // Skip if inside an existing chip
      if ((node.parentNode as Element).closest?.("[data-chip-id]")) continue;
      let s = node.nodeValue ?? "";
      if (!s.includes(text)) continue;
      const frag = doc.createDocumentFragment();
      let from = 0;
      while (true) {
        const idx = s.indexOf(text, from);
        if (idx < 0) break;
        const thisOccurrence = occurrenceCounter++;
        // Match strictly by occurrence_index. Без fallback'а на «единственный с null»,
        // иначе одна замена «съедала» все вхождения слова в документе.
        const target = list.find((r) => r.occurrence_index === thisOccurrence);
        if (idx > from) frag.appendChild(doc.createTextNode(s.slice(from, idx)));
        if (target) {
          const chip = doc.createElement("span");
          chip.className = "docx-chip";
          chip.setAttribute("data-chip-id", target.id);
          chip.setAttribute("data-fld", target.field_public_id ?? "");
          chip.setAttribute("data-status", target.status);
          chip.setAttribute("contenteditable", "false");
          chip.setAttribute("title", "Клик — изменить поле, ✕ — отменить замену");
          const labelEl = doc.createElement("span");
          labelEl.className = "docx-chip-label";
          labelEl.textContent = target.visual_label ?? target.field_public_id ?? "поле";
          chip.appendChild(labelEl);
          const fldEl = doc.createElement("span");
          fldEl.className = "docx-chip-fld";
          fldEl.textContent = target.field_public_id ?? "";
          chip.appendChild(fldEl);
          const suf = formatSuffix(target.format, target.case_modifier);
          if (suf) {
            const sufEl = doc.createElement("span");
            sufEl.className = "docx-chip-suffix";
            sufEl.textContent = suf;
            chip.appendChild(sufEl);
          }
          const rm = doc.createElement("button");
          rm.className = "docx-chip-remove";
          rm.setAttribute("type", "button");
          rm.setAttribute("data-chip-action", "remove");
          rm.setAttribute("aria-label", "Отменить замену");
          rm.setAttribute("title", "Отменить замену");
          rm.textContent = "×";
          chip.appendChild(rm);
          frag.appendChild(chip);
        } else {
          // Не наша occurrence — оставляем текст как есть
          frag.appendChild(doc.createTextNode(text));
        }
        from = idx + text.length;
      }
      if (from < s.length) frag.appendChild(doc.createTextNode(s.slice(from)));
      node.parentNode.replaceChild(frag, node);
    }
  }

  // 2) Highlight legacy placeholders not yet handled.
  const walker2 = doc.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
  const legacyNodes: Text[] = [];
  let m: Node | null;
  while ((m = walker2.nextNode())) {
    if ((m.parentNode as Element)?.closest?.("[data-chip-id]")) continue;
    if ((m.nodeValue ?? "").match(LEGACY_PLACEHOLDER_RE)) legacyNodes.push(m as Text);
  }
  for (const node of legacyNodes) {
    if (!node.parentNode) continue;
    const s = node.nodeValue ?? "";
    LEGACY_PLACEHOLDER_RE.lastIndex = 0;
    const frag = doc.createDocumentFragment();
    let last = 0;
    let match: RegExpExecArray | null;
    while ((match = LEGACY_PLACEHOLDER_RE.exec(s))) {
      if (match.index > last) frag.appendChild(doc.createTextNode(s.slice(last, match.index)));
      const mark = doc.createElement("mark");
      mark.className = "docx-legacy";
      mark.setAttribute("data-legacy-text", match[0]);
      mark.textContent = match[0];
      frag.appendChild(mark);
      last = match.index + match[0].length;
    }
    if (last < s.length) frag.appendChild(doc.createTextNode(s.slice(last)));
    node.parentNode.replaceChild(frag, node);
  }

  return root.innerHTML;
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
  const [showReplacements, setShowReplacements] = useState(false);
  const [showAutoSuggest, setShowAutoSuggest] = useState(false);
  const [hasSelection, setHasSelection] = useState(false);
  const previewRef = useRef<HTMLDivElement | null>(null);

  // Picker state — single FieldPickerPopover used for: header button, legacy click, chip click
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<{ x: number; y: number } | null>(null);
  /** Контекст того, для чего открыт picker. */
  const [pickerContext, setPickerContext] = useState<
    | { kind: "selection"; text: string; occurrenceIndex: number }
    | { kind: "legacy"; text: string; occurrenceIndex: number }
    | { kind: "chip"; replacementId: string }
    | null
  >(null);

  // ── load DOCX, build preview HTML, load draft ──
  useEffect(() => {
    if (!open || !templateVersion) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setReplacements([]);
      setPlainText("");
      setPreviewHtml("");
      setDraftLoaded(false);
      setShowReplacements(false);
      setShowAutoSuggest(false);
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
          const restored = draft.replacements.map((r) => ({
            ...r,
            visual_label: r.visual_label ?? r.field_public_id ?? null,
            occurrences_total: countOccurrences(txt, r.original_text),
          }));
          const resolved = resolveMissingOccurrenceIndexes(restored, txt);
          setReplacements(resolved.next);
          if (resolved.changed > 0) {
            toast.message("Уточнены повторяющиеся вхождения", {
              description: `Автоматически привязано замен: ${resolved.changed}. Проверьте список замен перед применением.`,
            });
          }
          toast.message("Восстановлен черновик разметки", {
            description: `Замен: ${draft.replacements.length}. Сохранён ${new Date(draft.updated_at).toLocaleString("ru-RU")}`,
          });
        } else {
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

  // ── derived: refs by category, label by FLD ──
  const refsByCategory = useMemo(() => {
    const m = new Map<string, RegistryFieldRef[]>();
    for (const r of refs) {
      if (!m.has(r.category)) m.set(r.category, []);
      m.get(r.category)!.push(r);
    }
    return m;
  }, [refs]);
  const refByFld = useMemo(() => {
    const m = new Map<string, RegistryFieldRef>();
    for (const r of refs) m.set(r.field_public_id, r);
    return m;
  }, [refs]);

  // ── render interactive HTML with chips + legacy marks ──
  const interactiveHtml = useMemo(
    () => renderInteractiveHtml(previewHtml, replacements),
    [previewHtml, replacements],
  );

  // ── autosave draft (debounced) ──
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!draftLoaded || !templateVersion) return;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      const draft: MarkupDraft = {
        version: 1,
        updated_at: new Date().toISOString(),
        replacements: replacements.map((r) => ({ ...r, occurrences_total: 0 })),
      };
      const { error } = await supabase.from("document_template_versions")
        .update({ markup_draft: draft as any })
        .eq("id", templateVersion.id);
      if (!error) setHasDraftSaved(true);
    }, 1500);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [replacements, draftLoaded, templateVersion]);

  // ── selection tracking ──
  useEffect(() => {
    const handler = () => {
      const sel = window.getSelection();
      const txt = sel?.toString().trim() ?? "";
      const inside = sel?.rangeCount
        ? previewRef.current?.contains(sel.getRangeAt(0).commonAncestorContainer) ?? false
        : false;
      setHasSelection(!!txt && inside && txt.length <= 200);
    };
    document.addEventListener("selectionchange", handler);
    return () => document.removeEventListener("selectionchange", handler);
  }, []);

  // ── ops ──
  const upsertReplacement = useCallback((r: Replacement) => {
    setReplacements((prev) => {
      const idx = prev.findIndex((x) => x.id === r.id);
      if (idx < 0) return [r, ...prev];
      const next = prev.slice();
      next[idx] = r;
      return next;
    });
  }, []);

  const patch = useCallback((id: string, p: Partial<Replacement>) => {
    setReplacements((prev) => prev.map((r) => (r.id === id ? { ...r, ...p } : r)));
  }, []);

  const removeReplacement = useCallback((id: string) => {
    setReplacements((prev) => prev.filter((x) => x.id !== id));
  }, []);

  /**
   * Определяет 0-based индекс вхождения `needle` в исходном тексте документа,
   * соответствующий позиции `range.startContainer/startOffset` в живом DOM.
   *
   * Учитывает уже вставленные chips: каждый chip считается за свой `original_text`,
   * а не за визуальный label. Это даёт ту же нумерацию, что и `renderInteractiveHtml`,
   * который работает по исходному `previewHtml` (без chips).
   */
  const computeOccurrenceIndexAtRange = useCallback((needle: string, range: Range): number => {
    const root = previewRef.current;
    if (!root || !needle) return 0;
    let buffer = "";
    let stop = false;
    const walk = (node: Node) => {
      if (stop) return;
      if (node.nodeType === Node.TEXT_NODE) {
        const text = node.nodeValue ?? "";
        if (node === range.startContainer) {
          buffer += text.slice(0, range.startOffset);
          stop = true;
          return;
        }
        buffer += text;
        return;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const el = node as HTMLElement;
        const chipId = el.getAttribute?.("data-chip-id");
        if (chipId) {
          const r = replacements.find((x) => x.id === chipId);
          if (r) buffer += r.original_text;
          return;
        }
        // Если выделение начинается на границе элемента (startContainer === элемент,
        // startOffset = индекс ребёнка), берём только первые startOffset детей.
        const children = Array.from(el.childNodes);
        const limit = node === range.startContainer ? range.startOffset : children.length;
        for (let i = 0; i < limit; i++) {
          if (stop) return;
          walk(children[i]);
        }
        if (node === range.startContainer) stop = true;
      }
    };
    walk(root);
    let count = 0; let from = 0;
    while (true) {
      const idx = buffer.indexOf(needle, from);
      if (idx < 0) break;
      count++;
      from = idx + needle.length;
    }
    return count;
  }, [replacements]);

  /** Применяет результат picker'а к контексту. */
  const applyPickerResult = useCallback((
    fld: string,
    opts: { format: FieldFormat | null; caseModifier: FieldCase | null; data_type?: string | null },
  ) => {
    const fieldRef = refByFld.get(fld);
    const visual = fieldRef?.ui_label ?? fld;
    if (!pickerContext) return;
    if (pickerContext.kind === "selection" || pickerContext.kind === "legacy") {
      const text = pickerContext.text;
      const occ = countOccurrences(plainText, text);
      const occurrenceIndex = Math.min(pickerContext.occurrenceIndex, Math.max(0, occ - 1));
      const matchStart = occurrenceIndex >= 0 ? nthIndexOf(plainText, text, occurrenceIndex) : -1;
      const newR: Replacement = {
        id: uid(),
        source: "manual",
        original_text: text,
        field_public_id: fld,
        visual_label: visual,
        format: opts.format,
        case_modifier: opts.caseModifier,
        data_type: opts.data_type ?? fieldRef?.data_type ?? null,
        status: "manually_added",
        // Жёстко привязываемся к конкретной позиции выделения,
        // чтобы chip встал ИМЕННО там, а не на все вхождения слова.
        occurrence_index: occurrenceIndex,
        occurrences_total: occ,
        match_start: matchStart >= 0 ? matchStart : null,
        match_end: matchStart >= 0 ? matchStart + text.length : null,
      };
      upsertReplacement(newR);
      toast.success("Поле вставлено в выбранную позицию");
      window.getSelection()?.removeAllRanges();
    } else if (pickerContext.kind === "chip") {
      patch(pickerContext.replacementId, {
        field_public_id: fld,
        visual_label: visual,
        format: opts.format,
        case_modifier: opts.caseModifier,
        data_type: opts.data_type ?? fieldRef?.data_type ?? null,
        status: "changed",
      });
      toast.success("Поле обновлено");
    }
    setPickerOpen(false);
    setPickerContext(null);
    setPickerAnchor(null);
  }, [pickerContext, plainText, refByFld, upsertReplacement, patch]);

  /** Открыть picker для выделения. */
  const openPickerForSelection = () => {
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    if (!text) {
      toast.error("Сначала выделите текст в документе");
      return;
    }
    if (text.length > 200) {
      toast.error("Слишком длинное выделение (>200 символов)");
      return;
    }
    if (countOccurrences(plainText, text) === 0) {
      toast.error("Текст не найден в документе. Попробуйте короче (без переносов строк).");
      return;
    }
    let anchor: { x: number; y: number } | null = null;
    let occurrenceIndex = 0;
    if (sel?.rangeCount) {
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      anchor = { x: rect.left + rect.width / 2, y: rect.bottom };
      occurrenceIndex = computeOccurrenceIndexAtRange(text, range);
    }
    setPickerContext({ kind: "selection", text, occurrenceIndex });
    setPickerAnchor(anchor);
    setPickerOpen(true);
  };

  /** Делегированный обработчик кликов внутри preview. */
  const handlePreviewClick = (e: ReactMouseEvent<HTMLDivElement>) => {
    const t = e.target as HTMLElement;
    // Крестик удаления внутри chip
    const removeBtn = t.closest<HTMLElement>('[data-chip-action="remove"]');
    if (removeBtn) {
      const ownerChip = removeBtn.closest<HTMLElement>("[data-chip-id]");
      if (ownerChip) {
        e.preventDefault();
        e.stopPropagation();
        removeReplacement(ownerChip.getAttribute("data-chip-id")!);
        toast.success("Замена отменена");
      }
      return;
    }
    const chip = t.closest<HTMLElement>("[data-chip-id]");
    if (chip) {
      const id = chip.getAttribute("data-chip-id")!;
      const rect = chip.getBoundingClientRect();
      setPickerContext({ kind: "chip", replacementId: id });
      setPickerAnchor({ x: rect.left + rect.width / 2, y: rect.bottom });
      setPickerOpen(true);
      return;
    }
    const legacy = t.closest<HTMLElement>("mark.docx-legacy");
    if (legacy) {
      const text = legacy.getAttribute("data-legacy-text") ?? legacy.textContent ?? "";
      const rect = legacy.getBoundingClientRect();
      // Range, начинающийся перед элементом legacy → даст индекс этого вхождения.
      const range = document.createRange();
      range.setStartBefore(legacy);
      range.collapse(true);
      const occurrenceIndex = computeOccurrenceIndexAtRange(text, range);
      setPickerContext({ kind: "legacy", text, occurrenceIndex });
      setPickerAnchor({ x: rect.left + rect.width / 2, y: rect.bottom });
      setPickerOpen(true);
    }
  };

  /** Скачать исходный DOCX из storage (без правок разметки). */
  const downloadOriginalDocx = async () => {
    if (!templateVersion) return;
    try {
      const { data: blob, error } = await supabase.storage
        .from(templateVersion.storage_bucket)
        .download(templateVersion.storage_path);
      if (error) throw error;
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = templateVersion.file_name ?? `template-v${templateVersion.version_number}.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e: any) {
      toast.error(`Не удалось скачать DOCX: ${e?.message ?? e}`);
    }
  };

  const [downloadingMarked, setDownloadingMarked] = useState(false);
  const [lastAppliedPayloadHash, setLastAppliedPayloadHash] = useState<string | null>(null);
  const [lastCreatedVersion, setLastCreatedVersion] = useState<{ id: string; n: number } | null>(null);

  // Стабильный хэш payload (порядок ключей не важен) — для защиты от дублей в текущей сессии
  const hashPayload = (payload: any[]): string => {
    try {
      const norm = payload
        .map((p) => JSON.stringify(p, Object.keys(p).sort()))
        .sort()
        .join("|");
      let h = 5381;
      for (let i = 0; i < norm.length; i++) h = ((h << 5) + h + norm.charCodeAt(i)) | 0;
      return String(h);
    } catch {
      return String(Date.now());
    }
  };

  /**
   * Скачать DOCX с применённой разметкой: вызывает apply (без активации),
   * получает новую версию и скачивает её файл из storage.
   * ВАЖНО: каждый клик создаёт новую версию шаблона в БД.
   */
  const downloadMarkedDocx = async () => {
    if (!templateVersion) return;
    if (downloadingMarked) return; // защита от двойного клика
    if (!canApply) {
      toast.error(disabledReason ?? "Нечего применять");
      if (ambiguousCount > 0 || withoutFldCount > 0) setShowReplacements(true);
      return;
    }
    // Confirm: пользователь должен понимать, что создаётся новая версия
    const ok = window.confirm("Будет создана новая версия шаблона без активации. Продолжить?");
    if (!ok) return;

    setDownloadingMarked(true);
    try {
      const payload = buildPayload();
      if (payload.length === 0) {
        toast.error("Нет принятых замен с FLD-полем");
        return;
      }

      // Защита от дублей в текущей сессии
      const payloadHash = hashPayload(payload);
      if (lastAppliedPayloadHash === payloadHash) {
        const okDup = window.confirm(
          "Версия с такой же разметкой уже была создана в этой сессии. Создать ещё одну?"
        );
        if (!okDup) return;
      }

      const { data, error } = await supabase.functions.invoke("canonical-template-apply-markup", {
        body: { template_version_id: templateVersion.id, replacements: payload, activate: false },
      });
      if (error) throw error;
      const r = data as any;
      const newVersionId: string | undefined = r?.new_version_id;
      if (!newVersionId) throw new Error("Backend не вернул new_version_id");
      const validationStatus: string | undefined = r?.validation_status ?? r?.validation?.status;

      const { data: row, error: rowErr } = await supabase
        .from("document_template_versions")
        .select("storage_bucket, storage_path, file_name, version_number")
        .eq("id", newVersionId)
        .maybeSingle();
      if (rowErr || !row) throw rowErr ?? new Error("Не удалось получить новую версию");

      const { data: blob, error: dlErr } = await supabase.storage
        .from(row.storage_bucket)
        .download(row.storage_path);
      if (dlErr || !blob) throw dlErr ?? new Error("Не удалось скачать файл новой версии");

      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = row.file_name ?? `template-v${row.version_number}-marked.docx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      setLastAppliedPayloadHash(payloadHash);
      setLastCreatedVersion({ id: newVersionId, n: row.version_number });

      const msg =
        validationStatus === "invalid"
          ? `Создана версия v${row.version_number}, но она невалидна: остались незаменённые старые плейсхолдеры. Версия не активирована.`
          : `Создана версия v${row.version_number} и скачана. Версия не активирована.`;
      const toastFn = validationStatus === "invalid" ? toast.warning : toast.success;
      toastFn(msg, {
        duration: 8000,
        action: {
          label: "Обновить список версий",
          onClick: () => onApplied?.(),
        },
      });
      // Обновляем список версий снаружи, но НЕ сбрасываем текущий draft/replacements/chips
      onApplied?.();
      // ВАЖНО: диалог НЕ закрываем — пользователь продолжает работу с шаблоном
    } catch (e: any) {
      toast.error(`Не удалось скачать DOCX с разметкой: ${normalizeEdgeFunctionError(e)}`);
    } finally {
      setDownloadingMarked(false);
    }
  };

  // ── auto-suggest ──
  const runAutoSuggest = async () => {
    if (!plainText) return;
    setAutoSuggesting(true);
    try {
      const sug = await buildAutoSuggestions(plainText);
      const existing = new Set(replacements.map((r) => `${r.original_text}::${r.field_public_id ?? ""}`));
      const fresh: Replacement[] = sug
        .filter((s) => !existing.has(`${s.original_text}::${s.field_public_id ?? ""}`))
        .map((s) => {
          const fr = s.field_public_id ? refByFld.get(s.field_public_id) : undefined;
          const total = countOccurrences(plainText, s.original_text);
          return {
            id: s.id,
            source: "auto",
            original_text: s.original_text,
            field_public_id: s.field_public_id,
            visual_label: fr?.ui_label ?? s.field_public_id ?? null,
            format: (s.format ?? null) as FieldFormat | null,
            case_modifier: (s.case_modifier ?? null) as FieldCase | null,
            data_type: s.data_type ?? null,
            status: s.status as ReplacementStatus,
            occurrence_index: occurrenceIndexFromMatchStart(plainText, s.original_text, s.match_start) ?? (total === 1 ? 0 : null),
            occurrences_total: total,
            match_start: s.match_start ?? null,
            match_end: s.match_end ?? null,
            reason: s.reason,
            confidence: s.confidence,
          };
        });
      setReplacements((prev) => [...prev, ...fresh]);
      toast.success(`Авторазметка: добавлено предложений — ${fresh.length}`);
      setShowAutoSuggest(true);
    } catch (e: any) {
      toast.error(`Ошибка авторазметки: ${e?.message ?? e}`);
    } finally {
      setAutoSuggesting(false);
    }
  };

  const clearAll = () => {
    if (replacements.length === 0) return;
    if (!confirm("Очистить весь черновик разметки? Действие нельзя отменить.")) return;
    setReplacements([]);
    toast.success("Черновик очищен");
  };

  const acceptedCount = replacements.filter((r) => isAccepted(r.status) && !!r.field_public_id).length;
  const ambiguousCount = replacements.filter((r) =>
    isAccepted(r.status) && r.occurrences_total > 1 && r.occurrence_index == null
  ).length;
  const withoutFldCount = replacements.filter((r) => isAccepted(r.status) && !r.field_public_id).length;
  const suggestedCount = replacements.filter((r) => r.status === "suggested").length;
  const canApply = acceptedCount > 0 && ambiguousCount === 0 && withoutFldCount === 0;

  /** Причина, по которой кнопка «Применить» недоступна. */
  const disabledReason = (() => {
    if (canApply) return null;
    if (acceptedCount === 0) return "Нет принятых замен с выбранным полем. Кликните по жёлтому плейсхолдеру или выделите текст и выберите поле.";
    if (ambiguousCount > 0) return `Есть неоднозначные вхождения — укажите номер вхождения для ${ambiguousCount} замен.`;
    if (withoutFldCount > 0) return `Есть замены без FLD-поля: ${withoutFldCount}. Откройте «Замены» и выберите поле.`;
    return null;
  })();

  const buildPayload = () => replacements
    .filter((r) => isAccepted(r.status) && r.field_public_id)
    .map((r) => ({
      original_text: r.original_text,
      field_public_id: r.field_public_id!,
      format: r.format,
      case_modifier: r.case_modifier,
      placeholder: buildFieldPlaceholder(r.field_public_id!, r.format, r.case_modifier),
      // Runtime compatibility: deployed apply-markup may only accept accepted/changed.
      // UI-only `manually_added` is normalized before crossing the backend boundary.
      status: r.status === "manually_added" ? "accepted" : r.status,
      occurrence_index: r.occurrence_index,
    }));

  const apply = async (activate: boolean) => {
    if (!templateVersion) return;
    if (!canApply) {
      toast.error(disabledReason ?? "Замены не готовы к применению");
      if (ambiguousCount > 0 || withoutFldCount > 0) setShowReplacements(true);
      return;
    }
    activate ? setActivating(true) : setApplying(true);
    try {
      const payload = buildPayload();
      if (payload.length === 0) {
        toast.error("Нет принятых замен с выбранным полем FLD. Выберите поле для каждой замены.");
        return;
      }
      console.debug("[markup-apply]", {
        template_version_id: templateVersion.id,
        total: replacements.length,
        accepted: acceptedCount,
        ambiguous: ambiguousCount,
        without_fld: withoutFldCount,
        activate,
        payload_preview: payload.slice(0, 3),
      });
      const { data, error } = await supabase.functions.invoke("canonical-template-apply-markup", {
        body: { template_version_id: templateVersion.id, replacements: payload, activate },
      });
      if (error) throw error;
      const r = data as any;
      const valid = r?.validation?.status === "valid";
      const ambiguous = r?.ambiguous?.length ?? 0;
      const missed = r?.missed?.length ?? 0;
      toast.success(
        `Создана версия v${r?.new_version_number}: применено ${r?.applied_count}` +
        (missed ? `, не найдено: ${missed}` : "") +
        (ambiguous ? `, неоднозначных: ${ambiguous}` : "") +
        (r?.activated ? " · активирована" : valid ? " · валидна (не активирована)" : ` · ${r?.validation?.status}`),
        { duration: 8000 },
      );
      onApplied?.();
      onOpenChange(false);
    } catch (e: any) {
      const msg = normalizeEdgeFunctionError(e);
      toast.error(`Ошибка применения: ${msg}`);
    } finally {
      setApplying(false); setActivating(false);
    }
  };

  // ── picker virtual trigger position ──
  const pickerAnchorStyle: React.CSSProperties = pickerAnchor
    ? { position: "fixed", left: pickerAnchor.x, top: pickerAnchor.y, width: 1, height: 1 }
    : { position: "fixed", left: -9999, top: -9999, width: 1, height: 1 };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[1400px] w-[calc(100vw-1.5rem)] h-[92vh] flex flex-col p-0 gap-0 overflow-hidden"
      >
        <DialogHeader className="flex-shrink-0 px-5 pt-4 pb-3 border-b">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Pencil className="h-4 w-4" /> Разметка шаблона: {templateName}
          </DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">
            Это <b>режим разметки шаблона</b>: здесь вы заменяете старые плейсхолдеры на FLD-поля.
            Чтобы изменить текст, таблицы, отступы или форматирование — отредактируйте DOCX в Word
            и загрузите новую версию шаблона.
            {hasDraftSaved && <span className="ml-2 text-emerald-600">· Черновик сохранён</span>}
          </DialogDescription>
        </DialogHeader>

        {/* Toolbar */}
        <div className="flex-shrink-0 px-5 py-2 border-b bg-muted/30 flex items-center gap-2 flex-wrap">
          <Button
            size="sm"
            variant={hasSelection ? "default" : "outline"}
            onClick={openPickerForSelection}
            disabled={!hasSelection}
            title={hasSelection ? "Заменить выделенный текст на FLD-поле" : "Сначала выделите текст в документе"}
          >
            <Plus className="h-3.5 w-3.5 mr-1" /> Вставить поле
          </Button>
          <Button size="sm" variant="outline" onClick={runAutoSuggest} disabled={autoSuggesting || !plainText}>
            {autoSuggesting
              ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
              : <Wand2 className="h-3.5 w-3.5 mr-1" />}
            Авторазметка
          </Button>
          <Button size="sm" variant="outline" onClick={() => setShowReplacements(true)}>
            <ListChecks className="h-3.5 w-3.5 mr-1" /> Показать замены
            <Badge variant="secondary" className="ml-1.5 h-4 text-[10px] px-1">
              {acceptedCount}/{replacements.length}
            </Badge>
          </Button>
          {suggestedCount > 0 && (
            <Button size="sm" variant="outline" onClick={() => setShowAutoSuggest(true)}>
              <Sparkles className="h-3.5 w-3.5 mr-1 text-amber-500" /> Предложений: {suggestedCount}
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {ambiguousCount > 0 && (
              <Badge variant="outline" className="border-amber-400/60 text-amber-700 text-[10px]">
                <AlertTriangle className="h-3 w-3 mr-0.5" /> Неоднозначных: {ambiguousCount}
              </Badge>
            )}
            <span className="text-[11px] text-muted-foreground">
              v{templateVersion?.version_number} · {templateVersion?.file_name}
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={downloadOriginalDocx}
              disabled={!templateVersion}
              title="Скачать исходный DOCX без вставленных placeholder'ов (как был загружен)"
            >
              <Download className="h-3.5 w-3.5 mr-1" /> Оригинал (без правок)
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={downloadMarkedDocx}
              disabled={!templateVersion || !canApply || downloadingMarked || applying || activating}
              title={
                !canApply
                  ? (disabledReason ?? "Нет применимых замен")
                  : "Создаёт новую версию DOCX с применённой разметкой, не активирует её и сразу скачивает файл"
              }
            >
              {downloadingMarked
                ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                : <Download className="h-3.5 w-3.5 mr-1" />}
              Создать версию и скачать
            </Button>
            <Button size="sm" variant="ghost" onClick={clearAll} disabled={replacements.length === 0}>
              <Trash2 className="h-3.5 w-3.5 mr-1" /> Очистить черновик
            </Button>
          </div>
        </div>

        {/* Document area */}
        <div className="flex-1 min-h-0 overflow-hidden bg-muted/20">
          {loading ? (
            <div className="flex items-center justify-center py-16 h-full">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="h-full">
              <div className="mx-auto max-w-[920px] p-6">
                <div
                  ref={previewRef}
                  className="docx-preview bg-card rounded shadow-sm border p-8 select-text min-h-[60vh]"
                  onClick={handlePreviewClick}
                  dangerouslySetInnerHTML={{ __html: interactiveHtml || "<p class='text-muted-foreground'>Документ пуст</p>" }}
                />
              </div>
            </ScrollArea>
          )}
        </div>

        <DialogFooter className="flex-shrink-0 px-5 py-3 border-t bg-background sm:justify-between">
          <div className="text-[11px] text-muted-foreground space-y-0.5 max-w-[60%]">
            <div>
              Используются только поля FLD. Принято: <b>{acceptedCount}</b> · всего: <b>{replacements.length}</b>
            </div>
            {disabledReason && (
              <div className="text-amber-700 inline-flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                <span>{disabledReason}</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={applying || activating}>
              Закрыть
            </Button>
            <Button
              variant="outline"
              onClick={() => apply(false)}
              disabled={!canApply || applying || activating}
              title={disabledReason ?? "Создать новую версию шаблона с применёнными заменами"}
            >
              {applying ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Sparkles className="h-4 w-4 mr-1" />}
              Применить (создать версию)
            </Button>
            <Button
              onClick={() => apply(true)}
              disabled={!canApply || applying || activating}
              title={disabledReason ?? "Создать версию и сделать её активной (если валидна)"}
            >
              {activating ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <CheckCircle2 className="h-4 w-4 mr-1" />}
              Применить и активировать
            </Button>
          </div>
        </DialogFooter>

        {/* Picker полей — стабильный, без cmdk */}
        {(() => {
          const currentChip = pickerContext?.kind === "chip"
            ? replacements.find((r) => r.id === pickerContext.replacementId) ?? null
            : null;
          const contextLabel =
            pickerContext?.kind === "selection"
              ? `Заменяем выделенное: «${pickerContext.text.slice(0, 80)}${pickerContext.text.length > 80 ? "…" : ""}»`
              : pickerContext?.kind === "legacy"
                ? `Заменяем плейсхолдер: ${pickerContext.text}`
                : pickerContext?.kind === "chip"
                  ? `Изменить поле: ${currentChip?.visual_label ?? currentChip?.field_public_id ?? ""}`
                  : "Выбор FLD-поля";
          return (
            <FieldPickerPopover
              open={pickerOpen}
              onOpenChange={(o) => {
                setPickerOpen(o);
                if (!o) setPickerContext(null);
              }}
              anchor={pickerAnchor}
              contextLabel={contextLabel}
              currentFld={currentChip?.field_public_id ?? null}
              refs={refs}
              onPick={(res) => applyPickerResult(res.fld, {
                format: res.format,
                caseModifier: res.caseModifier,
                data_type: res.data_type,
              })}
            />
          );
        })()}

        {/* Sheet: Замены */}
        <Sheet open={showReplacements} onOpenChange={setShowReplacements}>
          <SheetContent side="right" className="w-[460px] sm:max-w-none flex flex-col p-0">
            <SheetHeader className="px-5 py-3 border-b">
              <SheetTitle className="text-sm">Замены ({replacements.length})</SheetTitle>
              <SheetDescription className="text-xs">
                Принято: {acceptedCount} · предложено: {suggestedCount}
                {ambiguousCount > 0 && <span className="text-amber-600"> · неоднозначных: {ambiguousCount}</span>}
              </SheetDescription>
            </SheetHeader>
            <ScrollArea className="flex-1">
              <div className="divide-y">
                {replacements.length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground py-10 px-4">
                    Замен пока нет. Выделите текст в документе → «Вставить поле».
                  </div>
                ) : replacements.map((r) => (
                  <ReplacementRow
                    key={r.id}
                    r={r}
                    onRemove={() => removeReplacement(r.id)}
                    onSkip={() => patch(r.id, { status: "skipped" })}
                    onAccept={() => patch(r.id, {
                      status: r.source === "manual" ? "manually_added" : "accepted",
                    })}
                    onChangeOccurrence={(idx) => patch(r.id, { occurrence_index: idx })}
                    onEditField={() => {
                      setPickerContext({ kind: "chip", replacementId: r.id });
                      setPickerAnchor({ x: window.innerWidth - 460, y: 200 });
                      setPickerOpen(true);
                    }}
                  />
                ))}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>

        {/* Sheet: Авторазметка */}
        <Sheet open={showAutoSuggest} onOpenChange={setShowAutoSuggest}>
          <SheetContent side="right" className="w-[460px] sm:max-w-none flex flex-col p-0">
            <SheetHeader className="px-5 py-3 border-b">
              <SheetTitle className="text-sm">Предложения авторазметки</SheetTitle>
              <SheetDescription className="text-xs">
                Принимайте по одному. После принятия фрагмент превращается в chip в документе.
              </SheetDescription>
            </SheetHeader>
            <ScrollArea className="flex-1">
              <div className="divide-y">
                {replacements.filter((r) => r.status === "suggested").length === 0 ? (
                  <div className="text-center text-xs text-muted-foreground py-10 px-4">
                    Предложений нет. Нажмите «Авторазметка» в шапке.
                  </div>
                ) : replacements.filter((r) => r.status === "suggested").map((r) => (
                  <SuggestionRow
                    key={r.id}
                    r={r}
                    onAccept={() => patch(r.id, { status: "accepted" })}
                    onSkip={() => patch(r.id, { status: "skipped" })}
                    onPick={() => {
                      setPickerContext({ kind: "chip", replacementId: r.id });
                      setPickerAnchor({ x: window.innerWidth - 460, y: 200 });
                      setPickerOpen(true);
                    }}
                  />
                ))}
              </div>
            </ScrollArea>
          </SheetContent>
        </Sheet>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────── PickerBody ───────────────────

function PickerBody({
  context, refs, refsByCategory, currentReplacement, onConfirm, onCancel,
}: {
  context:
    | { kind: "selection"; text: string }
    | { kind: "legacy"; text: string }
    | { kind: "chip"; replacementId: string }
    | null;
  refs: RegistryFieldRef[];
  refsByCategory: Map<string, RegistryFieldRef[]>;
  currentReplacement: Replacement | null;
  onConfirm: (fld: string, opts: { format: FieldFormat | null; caseModifier: FieldCase | null; data_type?: string | null }) => void;
  onCancel: () => void;
}) {
  const [pickedField, setPickedField] = useState<RegistryFieldRef | null>(null);

  useEffect(() => { setPickedField(null); }, [context]);

  const headerText =
    context?.kind === "selection" ? `Выделено: «${context.text.slice(0, 60)}${context.text.length > 60 ? "…" : ""}»` :
    context?.kind === "legacy" ? `Старый плейсхолдер: ${context.text}` :
    context?.kind === "chip" ? `Изменить поле: ${currentReplacement?.visual_label ?? currentReplacement?.field_public_id ?? ""}` :
    "";

  if (pickedField) {
    return (
      <div className="flex flex-col">
        <div className="px-3 py-2 border-b text-[11px] text-muted-foreground truncate">
          {headerText}
        </div>
        <FieldFormatPicker
          dataType={pickedField.data_type}
          fieldPublicId={pickedField.field_public_id}
          fieldLabel={pickedField.ui_label}
          onCancel={() => setPickedField(null)}
          onConfirm={(sel) => {
            onConfirm(pickedField.field_public_id, {
              format: sel.format, caseModifier: sel.caseModifier,
              data_type: pickedField.data_type,
            });
          }}
        />
      </div>
    );
  }

  return (
    <Command
      className="flex flex-col h-full overflow-hidden"
      filter={(itemValue, search) =>
        !search ? 1 : itemValue.toLowerCase().includes(search.toLowerCase()) ? 1 : 0
      }
    >
      <div className="px-3 py-2 border-b text-[11px] text-muted-foreground truncate">
        {headerText}
      </div>
      <CommandInput placeholder="Поиск по названию, FLD или ключу…" className="h-9 text-xs" />
      <CommandList
        className="overflow-y-auto overscroll-contain flex-1"
        style={{ maxHeight: 420 }}
      >
        <CommandEmpty className="py-6 text-center text-xs text-muted-foreground">
          Ничего не найдено
        </CommandEmpty>
        {Array.from(refsByCategory.entries()).map(([cat, items]) => (
          <CommandGroup key={cat} heading={CATEGORY_LABELS_RU[cat] ?? cat}>
            {items.map((r) => {
              const searchKey = `${r.field_public_id} ${r.token_key} ${r.ui_label}`;
              const isSelected = currentReplacement?.field_public_id === r.field_public_id;
              return (
                <CommandItem
                  key={r.field_public_id}
                  value={searchKey}
                  onSelect={() => setPickedField(r)}
                  className="text-xs py-1.5 gap-2"
                >
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
      <div className="px-3 py-2 border-t flex justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel}>Отмена</Button>
      </div>
    </Command>
  );
}

// ─────────────────── ReplacementRow ───────────────────

function ReplacementRow({
  r, onAccept, onSkip, onRemove, onChangeOccurrence, onEditField,
}: {
  r: Replacement;
  onAccept: () => void;
  onSkip: () => void;
  onRemove: () => void;
  onChangeOccurrence: (idx: number | null) => void;
  onEditField: () => void;
}) {
  const ambiguous = r.occurrences_total > 1 && r.occurrence_index == null && isAccepted(r.status);
  const statusColor =
    isAccepted(r.status) ? "border-emerald-400/50 text-emerald-700 bg-emerald-50" :
    r.status === "skipped" ? "border-muted-foreground/30 text-muted-foreground" :
    "border-amber-300 text-amber-700 bg-amber-50";

  return (
    <div className="p-3 text-xs space-y-1.5 hover:bg-muted/30">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-medium line-clamp-2">«{r.original_text}»</div>
          <div className="text-[10px] text-muted-foreground mt-0.5 flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[9px] py-0">{SOURCE_LABEL_RU[r.source]}</Badge>
            <Badge variant="outline" className={cn("text-[9px] py-0", statusColor)}>{STATUS_LABEL_RU[r.status]}</Badge>
            <span className="opacity-70">Вхождений: {r.occurrences_total}</span>
          </div>
        </div>
        <Button size="sm" variant="ghost" className="h-6 w-6 p-0" onClick={onRemove} title="Удалить">
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>

      <Button size="sm" variant="outline" className="h-7 w-full justify-between text-[11px]" onClick={onEditField}>
        {r.field_public_id ? (
          <span className="flex items-center gap-2 min-w-0 truncate">
            <span className="font-mono text-[10px] text-muted-foreground shrink-0">{r.field_public_id}</span>
            <span className="truncate">{r.visual_label ?? ""}</span>
          </span>
        ) : (
          <span className="text-muted-foreground">Выбрать поле…</span>
        )}
        <ChevronsUpDown className="h-3 w-3 opacity-50" />
      </Button>

      {(r.format || r.case_modifier) && (
        <div className="text-[10px] text-muted-foreground">{formatSuffix(r.format, r.case_modifier)}</div>
      )}

      {r.occurrences_total > 1 && (
        <div className="flex items-center gap-1.5 flex-wrap">
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
            <span className="text-[10px] text-amber-700 inline-flex items-center gap-0.5">
              <AlertTriangle className="h-3 w-3" /> Выберите вхождение
            </span>
          )}
        </div>
      )}

      {r.status === "suggested" && (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="default" className="h-6 px-2 text-[10px]" onClick={onAccept}>
            Принять
          </Button>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={onSkip}>
            <X className="h-3 w-3 mr-0.5" /> Пропустить
          </Button>
        </div>
      )}
    </div>
  );
}

// ─────────────────── SuggestionRow (Auto-suggest sheet) ───────────────────

function SuggestionRow({
  r, onAccept, onSkip, onPick,
}: {
  r: Replacement;
  onAccept: () => void;
  onSkip: () => void;
  onPick: () => void;
}) {
  return (
    <div className="p-3 text-xs space-y-1.5">
      <div className="font-medium line-clamp-2">«{r.original_text}»</div>
      <div className="text-[11px] text-muted-foreground">
        → {r.visual_label ?? r.field_public_id}
        {r.field_public_id && <span className="ml-1 font-mono text-[10px]">({r.field_public_id})</span>}
      </div>
      {r.reason && <div className="text-[10px] text-muted-foreground italic">{r.reason}</div>}
      <div className="flex items-center gap-1 pt-1">
        <Button size="sm" variant="default" className="h-6 px-2 text-[10px]" onClick={onAccept}>
          Принять
        </Button>
        <Button size="sm" variant="outline" className="h-6 px-2 text-[10px]" onClick={onPick}>
          Выбрать другое
        </Button>
        <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px]" onClick={onSkip}>
          Пропустить
        </Button>
      </div>
    </div>
  );
}
