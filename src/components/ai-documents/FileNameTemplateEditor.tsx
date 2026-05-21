/**
 * FileNameTemplateEditor — UI редактор file_name_template для шаблона документа.
 *
 * PATCH-B (FLD-first canon):
 * - допустим только синтаксис {{field:FLD-XXXXXX}};
 * - шаблон обязан содержать FLD-000069 (номер документа);
 * - расширение (.pdf/.docx) добавляется системой автоматически;
 * - production-шаблоны хранят NULL по умолчанию (системный дефолт).
 */
import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  extractFilenamePlaceholders,
  renderFileName,
  templateHasDocNumberFld,
  validateFilenameTemplateSyntax,
  FLD_PLACEHOLDER_RE,
} from "@/lib/documents/documentFilename";

interface Props {
  templateId: string;
  templateName: string;
}

const PREVIEW_TOKENS: Record<string, string> = {
  "FLD-000069": "PREVIEW-0001",
  "FLD-000070": "21.05.2026",
  "FLD-000113": "Иванов Иван Иванович",
  "FLD-000114": "Иванов И.И.",
  "FLD-000103": 'ООО "Ажур Инкам"',
  "FLD-000104": 'ООО "Ажур Инкам"',
};

const FIELD_CHIPS: Array<{ fld: string; label: string }> = [
  { fld: "FLD-000069", label: "Номер документа (обязателен)" },
  { fld: "FLD-000070", label: "Дата документа" },
  { fld: "FLD-000114", label: "Заказчик: ФИО / кратко" },
  { fld: "FLD-000113", label: "Заказчик: полное название" },
  { fld: "FLD-000104", label: "Исполнитель: кратко" },
  { fld: "FLD-000103", label: "Исполнитель: полное название" },
];

export function FileNameTemplateEditor({ templateId, templateName }: Props) {
  const [template, setTemplate] = useState<string>("");
  const [original, setOriginal] = useState<string>("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("document_templates")
        .select("file_name_template")
        .eq("id", templateId)
        .maybeSingle();
      if (cancelled) return;
      const t = (data?.file_name_template as string) || "";
      setTemplate(t);
      setOriginal(t);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [templateId]);

  const syntax = useMemo(() => validateFilenameTemplateSyntax(template), [template]);
  const hasDocNumber = useMemo(() => templateHasDocNumberFld(template), [template]);
  const placeholders = useMemo(() => extractFilenamePlaceholders(template), [template]);
  const hasExtensionInTemplate = /\.(pdf|docx)\s*$/i.test(template.trim());

  const previewResult = useMemo(
    () => renderFileName(template, PREVIEW_TOKENS),
    [template],
  );

  const canSave =
    template.trim().length > 0 &&
    syntax.ok &&
    hasDocNumber &&
    !hasExtensionInTemplate;

  const insertChip = (fld: string) => {
    setTemplate((prev) => `${prev}${prev.endsWith(" ") || !prev ? "" : " "}{{field:${fld}}}`);
  };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("document_templates")
      .update({ file_name_template: template.trim() || null })
      .eq("id", templateId);
    setSaving(false);
    if (error) {
      toast.error(error.message || "Не удалось сохранить шаблон имени");
      return;
    }
    setOriginal(template);
    toast.success("Шаблон имени файла сохранён");
  };

  const reset = () => {
    setTemplate("");
  };

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
        rows={2}
        value={template}
        onChange={(e) => setTemplate(e.target.value)}
        placeholder="Счёт-акт {{field:FLD-000069}} — {{field:FLD-000114}} — {{field:FLD-000104}}"
        className="font-mono text-xs"
      />

      <div className="flex flex-wrap gap-1">
        {FIELD_CHIPS.map((c) => (
          <Button
            key={c.fld}
            size="sm"
            variant="outline"
            type="button"
            className="h-6 text-[11px] px-2"
            onClick={() => insertChip(c.fld)}
            title={c.label}
          >
            {c.fld}
          </Button>
        ))}
      </div>

      <div className="rounded border bg-muted/30 px-2 py-1.5 text-[12px]">
        <div className="text-muted-foreground">Preview:</div>
        <div className="font-mono break-all">
          {previewResult.name ? `${previewResult.name}.pdf` : "(пусто — будет использован системный дефолт)"}
        </div>
        {previewResult.warnings.length > 0 && (
          <ul className="text-[11px] text-amber-600 mt-1 space-y-0.5">
            {previewResult.warnings.map((w, i) => (
              <li key={i}>⚠ {w}</li>
            ))}
          </ul>
        )}
      </div>

      <ul className="text-[11px] space-y-0.5">
        {template.trim() && !syntax.ok && (
          <li className="text-destructive">
            ✗ Недопустимые плейсхолдеры: {syntax.invalid.map((s) => `{{${s}}}`).join(", ")}.
            Разрешён только формат <code>{`{{field:FLD-XXXXXX}}`}</code>.
          </li>
        )}
        {template.trim() && !hasDocNumber && (
          <li className="text-destructive">
            ✗ Добавьте плейсхолдер номера документа{" "}
            <code>{`{{field:FLD-000069}}`}</code>, чтобы имя файла было уникальным.
          </li>
        )}
        {hasExtensionInTemplate && (
          <li className="text-destructive">
            ✗ Расширение добавляется автоматически — не указывайте .pdf/.docx в шаблоне.
          </li>
        )}
        {template.trim() && syntax.ok && hasDocNumber && !hasExtensionInTemplate && (
          <li className="text-emerald-600">✓ Шаблон валиден</li>
        )}
      </ul>

      <div className="flex items-center gap-2">
        <Button size="sm" onClick={save} disabled={!canSave || saving || template === original}>
          {saving ? "Сохранение…" : "Сохранить"}
        </Button>
        <Button size="sm" variant="ghost" onClick={reset} disabled={saving}>
          Сбросить к системному дефолту
        </Button>
      </div>
    </div>
  );
}
