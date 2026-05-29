/**
 * PackageTemplateValidationPanel — Sprint 3F Phase 2b.
 *
 * Read-only controlled validation для DOCX-шаблонов пакета.
 *
 * Что делает:
 *  1. Принимает локальный .docx (drag/upload) либо читает уже загруженную
 *     активную версию шаблона через storage (опц., в будущей итерации).
 *  2. Извлекает текст через mammoth, ищет токены `{{...}}` (read-only).
 *  3. Классифицирует каждый токен:
 *     • valid       — `{{field:FLD-XXXXXX}}`, `{{package.ul|ip|fl.FLD-XXXXXX}}`,
 *                     `{{package.role.PKR-XXXXXX}}`;
 *     • warning     — `{{field:FLD-XXXXXX}}` в template_scope='package'
 *                     (биллинговое поле в package-шаблоне — не блокирует, но требует ревью);
 *                     `{{package.roles.<role_key>.<attr>}}` (deprecated синтаксис);
 *     • error       — legacy {{document|executor|customer|deal|cf.*}} или произвольный мусор.
 *
 * Чего НЕ делает:
 *  • Не запускает canonical-document-generate-strict.
 *  • Не вызывает Gotenberg.
 *  • Не пишет в ai_generated_documents.
 *  • Не модифицирует document_templates / document_template_versions.
 *  • Не трогает billing-резолвер.
 *
 * Все мутирующие действия — отдельной кнопкой в админ-панели шаблонов,
 * через канонические пути (uploaded DOCX → version → markup → activate).
 */
import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { CheckCircle2, AlertTriangle, XCircle, ShieldCheck, Loader2, Upload } from "lucide-react";
import mammoth from "mammoth";
import { isBillingEntityType } from "@/utils/billingFldGroups";

interface Props {
  packageTemplateId: string | null;
}

type Severity = "valid" | "warning" | "error";

interface Finding {
  token: string;
  severity: Severity;
  code: string;
  hint: string;
}

interface TemplateChoice {
  id: string;
  name: string;
  template_scope: string | null;
}

const ANY_PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const RX_SYSTEM_FLD = /^field:FLD-\d{6}(\|[^}]+)?$/;
const RX_PACKAGE_REQ = /^package\.(ul|ip|fl)\.FLD-\d{6}(\|[^}]+)?$/;
const RX_PACKAGE_ROLE = /^package\.role\.PKR-\d{6}(\|[^}]+)?$/;
const RX_PACKAGE_ROLES_LEGACY = /^package\.roles\.[a-z_][a-z0-9_]*\.(full_name|short_name|position)(\|[^}]+)?$/;
const RX_LEGACY_PREFIX = /^(document|executor|customer|deal|cf)\./i;

function classify(
  inside: string,
  isPackageScope: boolean,
  fldEntityTypes: Map<string, string>,
): Finding {
  const token = `{{${inside}}}`;
  if (RX_PACKAGE_REQ.test(inside)) {
    return { token, severity: "valid", code: "package_requisite_ok",
      hint: "Package-aware реквизит, читается из document_package_sessions." };
  }
  if (RX_PACKAGE_ROLE.test(inside)) {
    return { token, severity: "valid", code: "package_role_ok",
      hint: "Канонический формат роли пакета (один токен → output_template)." };
  }
  if (RX_PACKAGE_ROLES_LEGACY.test(inside)) {
    return { token, severity: "warning", code: "deprecated_package_roles_syntax",
      hint: "Устаревший синтаксис {{package.roles.<role>.<attr>}}. Заменить на {{package.role.PKR-XXXXXX}}." };
  }
  if (RX_SYSTEM_FLD.test(inside)) {
    // Извлекаем FLD-ID из токена и проверяем entity_type.
    const m = inside.match(/FLD-\d{6}/);
    const fldId = m ? m[0] : null;
    const entityType = fldId ? fldEntityTypes.get(fldId) : null;
    if (isPackageScope && entityType && isBillingEntityType(entityType)) {
      return { token, severity: "warning", code: "billing_fld_in_package_scope",
        hint: "Этот плейсхолдер относится к биллинговым реквизитам. Для реквизитов пакета используйте {{package.ul|ip|fl.FLD-XXXXXX}}." };
    }
    return { token, severity: "valid", code: "system_field_ok",
      hint: "Системное/документное поле каталога — допустимо в пакетном шаблоне." };
  }
  if (RX_LEGACY_PREFIX.test(inside)) {
    return { token, severity: "error", code: "legacy_placeholder_format_detected",
      hint: "Старый формат {{document|executor|customer|deal|cf.*}} запрещён. Замените на FLD-каталог." };
  }
  return { token, severity: "error", code: "unrecognized_placeholder",
    hint: "Токен не соответствует ни одному допустимому формату. Удалите или замените." };
}

export function PackageTemplateValidationPanel({ packageTemplateId }: Props) {
  const [scanning, setScanning] = useState(false);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [sourceLabel, setSourceLabel] = useState<string>("");
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");

  const boundTemplatesQuery = useQuery({
    queryKey: ["pkg-validation-templates", packageTemplateId],
    queryFn: async () => {
      if (!packageTemplateId) return [] as TemplateChoice[];
      const { data: items } = await supabase
        .from("document_package_template_items")
        .select("template_id")
        .eq("package_template_id", packageTemplateId);
      const ids = (items ?? []).map((r: any) => r.template_id);
      if (ids.length === 0) return [];
      const { data: tpls } = await supabase
        .from("document_templates")
        .select("id, name, template_scope")
        .in("id", ids);
      return (tpls ?? []) as TemplateChoice[];
    },
    enabled: !!packageTemplateId,
  });

  const isPackageScope = true; // validation runs in package context by definition

  const runOnArrayBuffer = useCallback(async (ab: ArrayBuffer, label: string) => {
    setScanning(true);
    try {
      const result = await mammoth.extractRawText({ arrayBuffer: ab });
      const text = result.value ?? "";
      const seen = new Set<string>();
      const out: Finding[] = [];
      for (const m of text.matchAll(ANY_PLACEHOLDER_RE)) {
        const inside = m[1].trim();
        if (seen.has(inside)) continue;
        seen.add(inside);
        out.push(classify(inside, isPackageScope));
      }
      setFindings(out);
      setSourceLabel(label);
    } catch (e: any) {
      setFindings([{
        token: "—", severity: "error", code: "docx_unreadable",
        hint: `Не удалось прочитать DOCX: ${e?.message ?? e}`,
      }]);
      setSourceLabel(label);
    } finally {
      setScanning(false);
    }
  }, [isPackageScope]);

  const handleFile = async (file: File | null) => {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".docx")) {
      setFindings([{ token: "—", severity: "error", code: "wrong_format",
        hint: "Только .docx. .doc/.rtf/.zip не поддерживаются." }]);
      return;
    }
    const ab = await file.arrayBuffer();
    await runOnArrayBuffer(ab, file.name);
  };

  const handleScanBound = async () => {
    if (!selectedTemplateId) return;
    setScanning(true);
    try {
      const { data: ver } = await supabase
        .from("document_template_versions")
        .select("storage_bucket, storage_path, file_name, template_id, is_current")
        .eq("template_id", selectedTemplateId)
        .eq("is_current", true)
        .maybeSingle();
      if (!ver) {
        setFindings([{ token: "—", severity: "error", code: "no_current_version",
          hint: "У шаблона нет активной версии." }]);
        setScanning(false);
        return;
      }
      const { data: dl, error } = await supabase.storage
        .from((ver as any).storage_bucket ?? "documents")
        .download((ver as any).storage_path);
      if (error || !dl) throw error ?? new Error("download_failed");
      const ab = await dl.arrayBuffer();
      const label = (ver as any).file_name ?? "(active version)";
      await runOnArrayBuffer(ab, label);
    } catch (e: any) {
      setFindings([{ token: "—", severity: "error", code: "fetch_failed",
        hint: e?.message ?? String(e) }]);
      setScanning(false);
    }
  };

  const counts = findings.reduce(
    (acc, f) => {
      acc[f.severity] += 1;
      return acc;
    },
    { valid: 0, warning: 0, error: 0 } as Record<Severity, number>,
  );

  if (!packageTemplateId) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">
        Выберите пакет, чтобы запустить контролируемую валидацию шаблонов.
      </Card>
    );
  }

  return (
    <Card className="p-4 space-y-3">
      <div>
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-indigo-500" />
          Контролируемая валидация (read-only)
        </h3>
        <p className="text-xs text-muted-foreground mt-0.5">
          Не запускает генерацию. Не вызывает Gotenberg. Не пишет в
          <code className="mx-1">ai_generated_documents</code>.
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 flex items-center gap-2">
          <Select value={selectedTemplateId} onValueChange={setSelectedTemplateId}>
            <SelectTrigger>
              <SelectValue placeholder="Активная версия привязанного шаблона…" />
            </SelectTrigger>
            <SelectContent>
              {(boundTemplatesQuery.data ?? []).length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  К пакету не привязано ни одного шаблона.
                </div>
              ) : (
                (boundTemplatesQuery.data ?? []).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} <span className="text-muted-foreground">({t.template_scope ?? "—"})</span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="secondary"
            disabled={!selectedTemplateId || scanning}
            onClick={handleScanBound}
          >
            {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Проверить"}
          </Button>
        </div>
        <div className="text-xs text-muted-foreground self-center">или</div>
        <label className="inline-flex items-center gap-2 text-sm cursor-pointer border rounded px-3 py-1.5 hover:bg-accent/30">
          <Upload className="h-3.5 w-3.5" />
          Загрузить локальный .docx
          <input
            type="file"
            accept=".docx"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      {sourceLabel && (
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted-foreground">Источник:</span>
          <code className="bg-muted/40 px-1.5 rounded">{sourceLabel}</code>
          <Badge variant="outline" className="text-[10px] h-4 px-1.5">
            <CheckCircle2 className="h-3 w-3 text-emerald-500 mr-1" /> {counts.valid}
          </Badge>
          <Badge variant="outline" className="text-[10px] h-4 px-1.5">
            <AlertTriangle className="h-3 w-3 text-amber-500 mr-1" /> {counts.warning}
          </Badge>
          <Badge variant="outline" className="text-[10px] h-4 px-1.5">
            <XCircle className="h-3 w-3 text-destructive mr-1" /> {counts.error}
          </Badge>
        </div>
      )}

      {findings.length === 0 ? (
        <div className="text-xs text-muted-foreground py-3 text-center border border-dashed rounded">
          Запустите проверку для отчёта.
        </div>
      ) : (
        <ul className="divide-y border rounded">
          {findings.map((f, i) => (
            <li key={i} className="flex items-start gap-2 px-3 py-2 text-xs">
              {f.severity === "valid" && <CheckCircle2 className="h-4 w-4 text-emerald-500 mt-0.5" />}
              {f.severity === "warning" && <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />}
              {f.severity === "error" && <XCircle className="h-4 w-4 text-destructive mt-0.5" />}
              <div className="flex-1 min-w-0">
                <code className="text-[11px] bg-muted/40 px-1.5 rounded break-all">{f.token}</code>
                <div className="text-muted-foreground mt-0.5">{f.hint}</div>
              </div>
              <Badge variant="secondary" className="text-[10px] h-4 px-1.5 shrink-0">
                {f.code}
              </Badge>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
