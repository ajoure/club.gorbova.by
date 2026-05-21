/**
 * FileNameTemplateEditor — UI редактор file_name_template для шаблона документа.
 *
 * PATCH-B (FLD-first canon):
 *  - допустим только синтаксис {{field:FLD-XXXXXX}};
 *  - шаблон обязан содержать FLD-000069 (Номер документа);
 *  - расширение (.pdf/.docx) добавляется системой автоматически;
 *  - production-шаблоны хранят NULL по умолчанию (системный дефолт).
 *
 * UI-фикс:
 *  - переиспользует общий FieldPickerPopover (группы, поиск, человекочитаемые лейблы);
 *  - вставка плейсхолдера в позицию курсора textarea;
 *  - Preview подставляет ui_label вместо магических значений;
 *  - Save → update → re-select → invalidate; ошибки логируются и видны в toast.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import { Braces } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  extractFilenamePlaceholders,
  renderFileName,
  templateHasDocNumberFld,
  validateFilenameTemplateSyntax,
  FLD_PLACEHOLDER_RE,
} from "@/lib/documents/documentFilename";
import { FieldPickerPopover } from "./FieldPickerPopover";
import { loadRegistryRefs, type RegistryFieldRef } from "@/utils/templateAutoSuggest";

interface Props {
  templateId: string;
  templateName: string;
}

const DOC_NUMBER_FLD = "FLD-000069";

export function FileNameTemplateEditor({ templateId, templateName }: Props) {
  const queryClient = useQueryClient();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const pickerBtnRef = useRef<HTMLButtonElement | null>(null);

  const [template, setTemplate] = useState<string>("");
  const [original, setOriginal] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [refs, setRefs] = useState<RegistryFieldRef[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerAnchor, setPickerAnchor] = useState<{ x: number; y: number } | null>(null);

  // initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const [{ data }, regRefs] = await Promise.all([
        supabase
          .from("document_templates")
          .select("file_name_template")
          .eq("id", templateId)
          .maybeSingle(),
        loadRegistryRefs().catch(() => [] as RegistryFieldRef[]),
      ]);
      if (cancelled) return;
      const t = (data?.file_name_template as string) || "";
      setTemplate(t);
      setOriginal(t);
      setRefs(regRefs);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  // ───────────── derived ─────────────
  const refsByFld = useMemo(() => {
    const m = new Map<string, RegistryFieldRef>();
    for (const r of refs) m.set(r.field_public_id, r);
    return m;
  }, [refs]);

  const syntax = useMemo(() => validateFilenameTemplateSyntax(template), [template]);
  const hasDocNumber = useMemo(() => templateHasDocNumberFld(template), [template]);
  const hasExtensionInTemplate = /\.(pdf|docx)\s*$/i.test(template.trim());

  // Preview tokens: human-readable labels for all known FLDs, fixed sample for doc number.
  const previewTokens = useMemo(() => {
    const t: Record<string, string> = { [DOC_NUMBER_FLD]: "PREVIEW-0001" };
    for (const r of refs) {
      if (r.field_public_id === DOC_NUMBER_FLD) continue;
      t[r.field_public_id] = `«${r.ui_label}»`;
    }
    return t;
  }, [refs]);

  const previewResult = useMemo(
    () => renderFileName(template, previewTokens),
    [template, previewTokens],
  );

  // FLDs реально использованные в шаблоне → для легенды
  const usedFlds = useMemo(() => {
    const set = new Set<string>();
    for (const raw of extractFilenamePlaceholders(template)) {
      const m = raw.match(FLD_PLACEHOLDER_RE);
      if (m) set.add(m[1]);
    }
    return Array.from(set);
  }, [template]);

  const reasons = useMemo(() => {
    const list: string[] = [];
    if (!template.trim()) list.push("Шаблон пустой");
    if (template.trim() && !syntax.ok) {
      list.push(
        `Недопустимые плейсхолдеры: ${syntax.invalid.map((s) => `{{${s}}}`).join(", ")} — разрешён только {{field:FLD-XXXXXX}}`,
      );
    }
    if (template.trim() && !hasDocNumber) {
      list.push(`Добавьте {{field:${DOC_NUMBER_FLD}}} (Номер документа) — обязателен для уникальности`);
    }
    if (hasExtensionInTemplate) list.push("Не указывайте .pdf/.docx — расширение добавится автоматически");
    return list;
  }, [template, syntax, hasDocNumber, hasExtensionInTemplate]);

  const isValid =
    template.trim().length > 0 && syntax.ok && hasDocNumber && !hasExtensionInTemplate;
  const dirty = template !== original;
  const canSave = isValid && dirty && !saving;

  // ───────────── insert at cursor ─────────────
  const insertAtCursor = useCallback((snippet: string) => {
    const ta = textareaRef.current;
    if (!ta) {
      setTemplate((prev) => prev + snippet);
      return;
    }
    const start = ta.selectionStart ?? template.length;
    const end = ta.selectionEnd ?? template.length;
    const before = template.slice(0, start);
    const after = template.slice(end);
    const needSpaceBefore = before.length > 0 && !/\s$/.test(before);
    const needSpaceAfter = after.length > 0 && !/^\s/.test(after);
    const inserted = `${needSpaceBefore ? " " : ""}${snippet}${needSpaceAfter ? " " : ""}`;
    const next = before + inserted + after;
    setTemplate(next);
    // restore caret after the inserted snippet
    requestAnimationFrame(() => {
      const pos = before.length + inserted.length;
      ta.focus();
      ta.setSelectionRange(pos, pos);
    });
  }, [template]);

  const openPicker = useCallback(() => {
    const btn = pickerBtnRef.current;
    if (btn) {
      const r = btn.getBoundingClientRect();
      setPickerAnchor({ x: r.left, y: r.bottom });
    } else {
      setPickerAnchor({ x: window.innerWidth / 2, y: window.innerHeight / 2 });
    }
    setPickerOpen(true);
  }, []);

  // ───────────── persistence ─────────────
  const persist = useCallback(
    async (nextValue: string | null) => {
      setSaving(true);
      const { error } = await supabase
        .from("document_templates")
        .update({ file_name_template: nextValue })
        .eq("id", templateId);
      if (error) {
        setSaving(false);
        console.error("[file_name_template] save failed", error);
        toast.error(error.message || "Не удалось сохранить шаблон имени файла");
        return false;
      }
      // re-read to reflect persisted state
      const { data: fresh, error: readErr } = await supabase
        .from("document_templates")
        .select("file_name_template")
        .eq("id", templateId)
        .maybeSingle();
      setSaving(false);
      if (readErr) {
        console.error("[file_name_template] reload failed", readErr);
      }
      const persisted = (fresh?.file_name_template as string) || "";
      setTemplate(persisted);
      setOriginal(persisted);
      // invalidate template-list queries
      queryClient.invalidateQueries({ queryKey: ["document_templates"] });
      queryClient.invalidateQueries({ queryKey: ["strict-document-templates"] });
      return true;
    },
    [templateId, queryClient],
  );

  const save = useCallback(async () => {
    const next = template.trim() ? template.trim() : null;
    const ok = await persist(next);
    if (ok) toast.success("Шаблон имени файла сохранён");
  }, [template, persist]);

  const reset = useCallback(async () => {
    const ok = await persist(null);
    if (ok) toast.success("Сброшено к системному дефолту");
  }, [persist]);

  if (loading) {
    return <div className="text-xs text-muted-foreground">Загрузка…</div>;
  }

  return (
    <div className="space-y-3 border-t pt-3 mt-3">
      <div>
        <Label className="text-xs">Имя файла при скачивании ({templateName})</Label>
        <p className="text-[11px] text-muted-foreground mt-0.5">
          Поддерживается только синтаксис <code>{`{{field:FLD-XXXXXX}}`}</code>.
          Расширение <code>.pdf</code> / <code>.docx</code> добавляется автоматически.
        </p>
      </div>

      <Textarea
        ref={textareaRef}
        rows={2}
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
        placeholder='Введите шаблон или нажмите "+ Вставить плейсхолдер"'
        className="font-mono text-xs"
      />

      <div className="flex items-center gap-2">
        <Button
          ref={pickerBtnRef}
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-[11px]"
          onClick={openPicker}
        >
          <Braces className="h-3 w-3 mr-1" />
          Вставить плейсхолдер
        </Button>
        <span className="text-[11px] text-muted-foreground">
          {refs.length > 0 ? `Доступно полей: ${refs.length}` : "Справочник пуст"}
        </span>
      </div>

      {/* Легенда: только FLD, реально использованные в шаблоне */}
      {usedFlds.length > 0 && (
        <ul className="text-[11px] space-y-0.5 rounded border bg-muted/20 px-2 py-1.5">
          {usedFlds.map((fld) => {
            const ref = refsByFld.get(fld);
            const label = fld === DOC_NUMBER_FLD
              ? "Номер документа (обязателен)"
              : ref?.ui_label;
            return (
              <li key={fld} className="font-mono">
                <span className="text-muted-foreground">{fld}</span>
                {" — "}
                <span className={label ? "text-foreground" : "text-destructive"}>
                  {label ?? "неизвестный плейсхолдер"}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {/* Preview */}
      <div className="rounded border bg-muted/30 px-2 py-1.5 text-[12px]">
        <div className="text-muted-foreground">Preview:</div>
        <div className="font-mono break-all">
          {previewResult.name
            ? `${previewResult.name}.pdf`
            : "(пусто — будет использован системный дефолт)"}
        </div>
        {previewResult.warnings.length > 0 && (
          <ul className="text-[11px] text-amber-600 mt-1 space-y-0.5">
            {previewResult.warnings.map((w, i) => (
              <li key={i}>⚠ {w}</li>
            ))}
          </ul>
        )}
      </div>

      {/* Reasons / validity */}
      {reasons.length > 0 ? (
        <ul className="text-[11px] text-destructive space-y-0.5">
          {reasons.map((r, i) => <li key={i}>✗ {r}</li>)}
        </ul>
      ) : (
        <p className="text-[11px] text-emerald-600">✓ Шаблон валиден</p>
      )}

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={!canSave}>
          {saving ? "Сохранение…" : "Сохранить"}
        </Button>
        <Button size="sm" variant="ghost" onClick={reset} disabled={saving}>
          Сбросить к системному дефолту
        </Button>
        {!isValid && template.trim().length > 0 && (
          <span className="text-[11px] text-muted-foreground">
            Сохранение недоступно — исправьте ошибки выше
          </span>
        )}
      </div>

      <FieldPickerPopover
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        anchor={pickerAnchor}
        contextLabel={`Имя файла: ${templateName}`}
        refs={refs}
        simple
        onPick={(res) => {
          insertAtCursor(`{{field:${res.fld}}}`);
          setPickerOpen(false);
        }}
      />
    </div>
  );
}
