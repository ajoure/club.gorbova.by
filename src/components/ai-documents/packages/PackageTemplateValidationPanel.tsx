/**
 * PackageTemplateValidationPanel — Sprint 3F Phase 2b + Sprint 3H-fix.
 *
 * Read-only controlled validation для DOCX-шаблонов пакета.
 *
 * Sprint 3H-fix:
 *  • Канон роли — `{{ln-XXXXXX}}` (Word-friendly).
 *  • Legacy `{{package.role.PKR-XXXXXX}}` и `{{package.roles.<role_key>.*}}`
 *    → error `invalid_legacy_role_placeholder`.
 *  • `{{ln-XXXXXX}}` валидируется через `document_package_role_catalog`:
 *      - роль не найдена → error `ln_token_not_found`;
 *      - роль из другого пакета → error `ln_token_outside_bound_package`;
 *  • Если выбрана сессия пакета и сканируем активную версию привязанного
 *    шаблона (известен `package_template_item_id`) — проверяем active
 *    assignments в `document_package_item_role_assignments`:
 *      - 0 → warning `role_assignment_missing`.
 *
 * Чего НЕ делает (canon):
 *  • Не запускает canonical-document-generate-strict.
 *  • Не вызывает Gotenberg.
 *  • Не пишет в ai_generated_documents.
 *  • Не модифицирует document_templates / document_template_versions.
 *  • Не трогает billing-резолвер.
 */
import { useState, useCallback } from "react";
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

interface TemplateItemChoice {
  item_id: string;            // document_package_template_items.id (= package_template_item_id)
  template_id: string;
  name: string;
  template_scope: string | null;
}

interface SessionChoice {
  id: string;
  label: string;
}

interface RoleCatalogRow {
  id: string;
  public_id: string;          // ln-XXXXXX
  role_key: string;
  package_template_id: string;
}

interface ItemAssignmentRow {
  role_catalog_id: string;
}

const ANY_PLACEHOLDER_RE = /\{\{\s*([^{}]+?)\s*\}\}/g;
const RX_SYSTEM_FLD = /^field:FLD-\d{6}(\|[^}]+)?$/;
const RX_PACKAGE_REQ = /^package\.(ul|ip|fl)\.FLD-\d{6}(\|[^}]+)?$/;
const RX_PACKAGE_ROLE_LN = /^(ln-\d{6})(\|[^}]+)?$/;
const RX_LEGACY_PACKAGE_ROLE_PKR = /^package\.role\.PKR-\d{6}(\|[^}]+)?$/;
const RX_LEGACY_PACKAGE_ROLES = /^package\.roles\.[a-z_][a-z0-9_]*\.[a-z_]+(\|[^}]+)?$/;
const RX_LEGACY_PREFIX = /^(document|executor|customer|deal|cf)\./i;

function classify(
  inside: string,
  fldEntityTypes: Map<string, string>,
  /** ln-XXXXXX → catalog row (роли всех пакетов, чтобы отличить "не найдено" от "другой пакет") */
  lnCatalog: Map<string, RoleCatalogRow>,
  /** package_template_id текущего пакета (для проверки принадлежности роли) */
  packageTemplateId: string | null,
  /** role_catalog_id, у которых есть active assignment в текущем (session,item) */
  assignedRoleCatalogIds: Set<string> | null,
): Finding {
  const token = `{{${inside}}}`;

  if (RX_PACKAGE_REQ.test(inside)) {
    return { token, severity: "valid", code: "package_requisite_ok",
      hint: "Package-aware реквизит, читается из document_package_sessions." };
  }

  const lnMatch = inside.match(RX_PACKAGE_ROLE_LN);
  if (lnMatch) {
    const lnId = lnMatch[1];
    const role = lnCatalog.get(lnId);
    if (!role) {
      return { token, severity: "error", code: "ln_token_not_found",
        hint: `Роль ${lnId} не найдена в каталоге ролей пакетов. Проверьте плейсхолдер.` };
    }
    if (packageTemplateId && role.package_template_id !== packageTemplateId) {
      return { token, severity: "error", code: "ln_token_outside_bound_package",
        hint: `Роль ${lnId} принадлежит другому пакету. Используйте только роли текущего пакета.` };
    }
    if (assignedRoleCatalogIds && !assignedRoleCatalogIds.has(role.id)) {
      return { token, severity: "warning", code: "role_assignment_missing",
        hint: "Для этой роли в анкете документа ещё не выбран человек. Заполните анкету документа перед генерацией." };
    }
    return { token, severity: "valid", code: "package_role_ok",
      hint: "Канонический формат роли пакета {{ln-XXXXXX}} (один токен → output_template)." };
  }

  if (RX_LEGACY_PACKAGE_ROLE_PKR.test(inside) || RX_LEGACY_PACKAGE_ROLES.test(inside)) {
    return { token, severity: "error", code: "invalid_legacy_role_placeholder",
      hint: "Устаревший формат плейсхолдера роли. Используйте плейсхолдер вида {{ln-XXXXXX}} из группы «Пакет: Роли»." };
  }
  if (RX_SYSTEM_FLD.test(inside)) {
    const m = inside.match(/FLD-\d{6}/);
    const fldId = m ? m[0] : null;
    const entityType = fldId ? fldEntityTypes.get(fldId) : null;
    if (entityType && isBillingEntityType(entityType)) {
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
  const [selectedItemId, setSelectedItemId] = useState<string>("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");

  // Items пакета (item_id + template).
  const boundItemsQuery = useQuery({
    queryKey: ["pkg-validation-items", packageTemplateId],
    queryFn: async () => {
      if (!packageTemplateId) return [] as TemplateItemChoice[];
      const { data: items } = await supabase
        .from("document_package_template_items")
        .select("id, template_id")
        .eq("package_template_id", packageTemplateId);
      const rows = (items ?? []) as Array<{ id: string; template_id: string }>;
      const ids = rows.map((r) => r.template_id);
      if (ids.length === 0) return [];
      const { data: tpls } = await supabase
        .from("document_templates")
        .select("id, name, template_scope")
        .in("id", ids);
      const tplMap = new Map<string, { name: string; template_scope: string | null }>();
      for (const t of (tpls ?? []) as any[]) {
        tplMap.set(t.id, { name: t.name, template_scope: t.template_scope });
      }
      return rows.map<TemplateItemChoice>((r) => ({
        item_id: r.id,
        template_id: r.template_id,
        name: tplMap.get(r.template_id)?.name ?? "(без названия)",
        template_scope: tplMap.get(r.template_id)?.template_scope ?? null,
      }));
    },
    enabled: !!packageTemplateId,
  });

  // Каталог ролей всех пакетов (для распознавания "из другого пакета").
  const roleCatalogQuery = useQuery({
    queryKey: ["pkg-role-catalog-all"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_package_role_catalog")
        .select("id, public_id, role_key, package_template_id")
        .eq("is_active", true);
      if (error) throw error;
      const map = new Map<string, RoleCatalogRow>();
      for (const r of (data ?? []) as RoleCatalogRow[]) {
        if (r.public_id) map.set(r.public_id, r);
      }
      return map;
    },
    staleTime: 60 * 1000,
  });

  // Сессии пакета (опционально, для проверки role_assignment_missing).
  const sessionsQuery = useQuery({
    queryKey: ["pkg-validation-sessions", packageTemplateId],
    queryFn: async () => {
      if (!packageTemplateId) return [] as SessionChoice[];
      const { data, error } = await supabase
        .from("document_package_sessions")
        .select("id, created_at")
        .eq("package_template_id", packageTemplateId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return ((data ?? []) as any[]).map<SessionChoice>((r) => ({
        id: r.id,
        label: `${r.id.slice(0, 8)}… · ${new Date(r.created_at).toLocaleString("ru-RU")}`,
      }));
    },
    enabled: !!packageTemplateId,
  });

  // FLD → entity_type.
  const fldEntityTypesQuery = useQuery({
    queryKey: ["fields-registry-entity-types"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("fields_registry")
        .select("public_id, entity_type")
        .is("archived_at", null);
      if (error) throw error;
      const map = new Map<string, string>();
      for (const r of (data ?? []) as any[]) {
        if (r.public_id && r.entity_type) map.set(r.public_id, r.entity_type);
      }
      return map;
    },
    staleTime: 5 * 60 * 1000,
  });

  // Active assignments для выбранной пары (session, item).
  const assignmentsQuery = useQuery({
    queryKey: ["pkg-validation-assignments", selectedSessionId, selectedItemId],
    queryFn: async () => {
      if (!selectedSessionId || !selectedItemId) return new Set<string>();
      const { data, error } = await supabase
        .from("document_package_item_role_assignments" as any)
        .select("role_catalog_id")
        .eq("package_session_id", selectedSessionId)
        .eq("package_template_item_id", selectedItemId)
        .eq("is_active", true);
      if (error) throw error;
      const s = new Set<string>();
      const rows = (data ?? []) as unknown as ItemAssignmentRow[];
      for (const r of rows) {
        if (r.role_catalog_id) s.add(r.role_catalog_id);
      }
      return s;
    },
    enabled: !!selectedSessionId && !!selectedItemId,
  });

  const runOnArrayBuffer = useCallback(async (ab: ArrayBuffer, label: string) => {
    setScanning(true);
    try {
      const result = await mammoth.extractRawText({ arrayBuffer: ab });
      const text = result.value ?? "";
      const seen = new Set<string>();
      const out: Finding[] = [];
      const fldMap = fldEntityTypesQuery.data ?? new Map<string, string>();
      const lnMap = roleCatalogQuery.data ?? new Map<string, RoleCatalogRow>();
      // Assignments-check включаем только если выбран и session, и item.
      const assignedSet =
        selectedSessionId && selectedItemId
          ? assignmentsQuery.data ?? new Set<string>()
          : null;
      for (const m of text.matchAll(ANY_PLACEHOLDER_RE)) {
        const inside = m[1].trim();
        if (seen.has(inside)) continue;
        seen.add(inside);
        out.push(classify(inside, fldMap, lnMap, packageTemplateId, assignedSet));
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
  }, [
    fldEntityTypesQuery.data,
    roleCatalogQuery.data,
    assignmentsQuery.data,
    selectedSessionId,
    selectedItemId,
    packageTemplateId,
  ]);

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
    if (!selectedItemId) return;
    const item = (boundItemsQuery.data ?? []).find((x) => x.item_id === selectedItemId);
    if (!item) return;
    setScanning(true);
    try {
      const { data: ver } = await supabase
        .from("document_template_versions")
        .select("storage_bucket, storage_path, file_name, template_id, is_current")
        .eq("template_id", item.template_id)
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
          <Select value={selectedItemId} onValueChange={setSelectedItemId}>
            <SelectTrigger>
              <SelectValue placeholder="Активная версия привязанного шаблона…" />
            </SelectTrigger>
            <SelectContent>
              {(boundItemsQuery.data ?? []).length === 0 ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">
                  К пакету не привязано ни одного шаблона.
                </div>
              ) : (
                (boundItemsQuery.data ?? []).map((t) => (
                  <SelectItem key={t.item_id} value={t.item_id}>
                    {t.name} <span className="text-muted-foreground">({t.template_scope ?? "—"})</span>
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
          <Button
            size="sm"
            variant="secondary"
            disabled={!selectedItemId || scanning}
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

      <div className="flex items-center gap-2 text-xs">
        <span className="text-muted-foreground shrink-0">
          Сессия (опционально, для проверки анкет документа):
        </span>
        <Select value={selectedSessionId} onValueChange={setSelectedSessionId}>
          <SelectTrigger className="h-8">
            <SelectValue placeholder="Без проверки assignments" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="">— без сессии —</SelectItem>
            {(sessionsQuery.data ?? []).map((s) => (
              <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
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
