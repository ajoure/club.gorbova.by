/**
 * PackageGenerationPanel — Sprint 3I-B (variant 2) + hotfix v3.
 *
 * Hotfix 2026-06-17:
 *   • Источник session/items/roleCatalog — `packageTemplateId` (UUID), не `code`.
 *     Это устраняет рассинхрон с вкладкой «Анкеты документов»: пакет без
 *     заданного `code` (например, «Годовое собрание») раньше давал ложный
 *     blocker «Анкета пакета ещё не сохранена».
 *   • Query keys идентичны ключам `DocumentPackageQuestionnairesView`, что
 *     обеспечивает мгновенную разблокировку кнопки после сохранения анкеты.
 *   • Blocker — предметный: показывает, какой документ требует чего именно.
 *   • STOP-condition: если session есть, но `session.package_template_id`
 *     не совпадает с текущим templateId или items=0, генерация блокируется
 *     с диагностикой, новая сессия не создаётся.
 *
 * STOP:
 *   • НЕ трогает backend pipeline: `UI → ai-generate-document-package →
 *     canonical-document-generate-strict`.
 *   • НЕ материализует `ai_generated_documents` / Gotenberg / storage.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles, FlaskConical, Loader2, FileText, FileDown,
  CheckCircle2, AlertCircle, Info,
} from "lucide-react";
import { HelpTooltip } from "@/components/help/HelpComponents";
import { useRbac } from "@/hooks/useRbac";
import { useDocumentPackageItems } from "@/hooks/useDocumentPackages";
import {
  useAiDocumentPackageGeneration,
  type PackageGenerationResult,
} from "@/hooks/useAiDocumentPackageGeneration";
import { downloadDocumentBlob } from "@/utils/downloadDocumentBlob";
import { toast } from "sonner";
import { PackageGenerationHistory } from "./PackageGenerationHistory";
import { usePackageSessionFields } from "@/hooks/usePackageSessionFields";

interface Props {
  /** UUID шаблона пакета. SOT — `document_package_templates.id`. */
  packageTemplateId: string;
  packageName: string;
}

interface RoleDef {
  id: string;
  role_key: string;
  label: string;
  required: boolean;
}

export function PackageGenerationPanel({ packageTemplateId, packageName }: Props) {
  const { user } = useAuth();
  const rbac = useRbac();
  const isAdmin = rbac.isAdmin || rbac.isSuperAdmin;

  // 1. profile id (тот же key, что и в анкете)
  const profileQuery = useQuery({
    queryKey: ["profile-id", user?.id],
    queryFn: async () => {
      if (!user) return null;
      const { data, error } = await supabase
        .from("profiles").select("id").eq("user_id", user.id).single();
      if (error) throw error;
      return data.id as string;
    },
    enabled: !!user,
  });
  const profileId = profileQuery.data ?? null;

  // 2. session (ИДЕНТИЧНЫЙ ключ и фильтр с DocumentPackageQuestionnairesView)
  const sessionQuery = useQuery({
    queryKey: ["doc-pkg-session-q", profileId, packageTemplateId],
    queryFn: async () => {
      if (!profileId) return null;
      const { data } = await supabase
        .from("document_package_sessions")
        .select("id, selected_legal_entity_id, legal_entity_locked_at, created_at, package_template_id")
        .eq("profile_id", profileId)
        .eq("package_template_id", packageTemplateId)
        .is("entitlement_id", null)
        .is("order_id", null)
        .neq("status", "archived")
        .maybeSingle();
      return data ?? null;
    },
    enabled: !!profileId,
  });
  const session = sessionQuery.data;
  const sessionId = session?.id ?? null;

  // 3. items пакета
  const { items: packageItems } = useDocumentPackageItems(packageTemplateId);

  // 4. role catalog для пакета (тот же ключ, что и usePackageRoleCatalog)
  const roleCatalogQuery = useQuery({
    queryKey: ["pkg-role-catalog", packageTemplateId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_package_role_catalog")
        .select("id, role_key, label, required, is_active")
        .eq("package_template_id", packageTemplateId)
        .eq("is_active", true)
        .order("sort_order");
      if (error) throw error;
      return ((data ?? []) as any[]).map((r) => ({
        id: r.id, role_key: r.role_key, label: r.label, required: !!r.required,
      })) as RoleDef[];
    },
  });
  const roleCatalog = roleCatalogQuery.data ?? [];

  const { generatePackage, isGenerating } = useAiDocumentPackageGeneration();

  const [lastResult, setLastResult] = useState<PackageGenerationResult | null>(null);
  const [lastRunMode, setLastRunMode] = useState<"user_generate" | "admin_test" | null>(null);

  const itemLabelById = useMemo(() => {
    const map = new Map<string, string>();
    for (const it of packageItems ?? []) {
      map.set((it as any).id, (it as any).title_override || (it as any).template_name || "Документ");
    }
    return map;
  }, [packageItems]);

  // PATCH GATE V2: per-item role assignments SOT.
  const itemIds = useMemo(() => (packageItems ?? []).map((it: any) => it.id), [packageItems]);
  const assignmentsQuery = useQuery({
    queryKey: ["pkg-gen-role-assignments", sessionId, itemIds.join(",")],
    queryFn: async () => {
      if (!sessionId || itemIds.length === 0) return [];
      const { data, error } = await supabase
        .from("document_package_item_role_assignments" as any)
        .select("role_catalog_id, package_template_item_id, person_id")
        .eq("package_session_id", sessionId)
        .in("package_template_item_id", itemIds)
        .eq("is_active", true);
      if (error) throw error;
      return ((data ?? []) as any[]).filter((a) => a.person_id) as Array<{
        role_catalog_id: string; package_template_item_id: string;
      }>;
    },
    enabled: !!sessionId && itemIds.length > 0,
  });
  const assignments = assignmentsQuery.data ?? [];

  // Required roles (на уровне пакета): package_company → entity; прочие → ≥1 в любом документе.
  const requiredRolesStatus = useMemo(() => {
    const assignedRoleIds = new Set(assignments.map((a) => a.role_catalog_id));
    return roleCatalog
      .filter((r) => r.required)
      .map((r) => {
        if (r.role_key === "package_company") {
          return { role: r, satisfied: !!session?.selected_legal_entity_id };
        }
        return { role: r, satisfied: assignedRoleIds.has(r.id) };
      });
  }, [roleCatalog, assignments, session]);

  const allRequiredSatisfied = requiredRolesStatus.every((x) => x.satisfied);
  const hasSession = !!sessionId;
  const hasItems = (packageItems?.length ?? 0) > 0;

  // STOP-condition: session есть, но template_id не совпадает.
  const sessionMismatch =
    !!session && session.package_template_id && session.package_template_id !== packageTemplateId;

  // Required pf-fields per-item.
  const fieldsState = usePackageSessionFields(sessionId, packageTemplateId);
  const requiredFieldsGate = useMemo(() => {
    let missing = 0;
    let total = 0;
    const perItemMissing: Array<{ itemId: string; label: string; missing: number }> = [];
    for (const itemId of itemIds) {
      const prog = fieldsState.getItemProgress(itemId);
      total += prog.requiredTotal;
      const miss = prog.requiredTotal - prog.requiredFilled;
      missing += miss;
      if (miss > 0) {
        perItemMissing.push({
          itemId,
          label: itemLabelById.get(itemId) ?? "Документ",
          missing: miss,
        });
      }
    }
    return { missing, total, satisfied: missing === 0, perItemMissing };
  }, [itemIds, fieldsState, itemLabelById]);

  // Per-item missing roles: для каждого item — какие required роли не назначены.
  // Сейчас required роли проверяются на уровне пакета (≥1 назначение где угодно),
  // но для UX покажем item-level подсказку отдельным сообщением.
  const blockers: string[] = [];
  if (sessionMismatch) {
    blockers.push(
      `Шаблон сессии не совпадает с выбранным пакетом (session.template=${session?.package_template_id}, выбран=${packageTemplateId}). Обратитесь к администратору.`,
    );
  } else {
    if (!hasSession) blockers.push("Анкета пакета ещё не сохранена.");
    if (!hasItems && hasSession) blockers.push("В пакете нет шаблонов документов.");
    if (hasSession && !allRequiredSatisfied) {
      const missing = requiredRolesStatus.filter((x) => !x.satisfied).map((x) => x.role.label);
      blockers.push(`Не назначены обязательные роли: ${missing.join(", ")}.`);
    }
    if (hasSession && !requiredFieldsGate.satisfied) {
      for (const p of requiredFieldsGate.perItemMissing) {
        blockers.push(`Документ «${p.label}»: не заполнено ${p.missing} обязательных полей.`);
      }
    }
  }

  const handleGenerate = async (runMode: "user_generate" | "admin_test") => {
    if (!sessionId) return;
    setLastRunMode(runMode);
    try {
      const data = await generatePackage({
        package_session_id: sessionId,
        run_mode: runMode,
      });
      setLastResult(data);
    } catch {
      /* toast handled in hook */
    }
  };

  const canGenerate =
    hasSession && hasItems && !sessionMismatch && allRequiredSatisfied
    && requiredFieldsGate.satisfied && !isGenerating;

  return (
    <div className="space-y-3">
      <GlassCard className="p-4">
        <div className="flex items-start justify-between gap-3 flex-wrap mb-3">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-orange-500" />
              Генерация пакета
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Заполните анкеты документов и роли — затем сформируйте {packageName.toLowerCase()}.
              Готовые документы появятся ниже и в истории запусков.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isAdmin && (
              <HelpTooltip
                helpKey=""
                customShort="Пробный запуск для администратора: документы сформируются, но клиенту ничего не отправляется."
                alwaysShow
              >
                <span tabIndex={0}>
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!canGenerate}
                    onClick={() => handleGenerate("admin_test")}
                  >
                    {isGenerating && lastRunMode === "admin_test"
                      ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      : <FlaskConical className="h-4 w-4 mr-1" />}
                    Тестово сформировать
                  </Button>
                </span>
              </HelpTooltip>
            )}
            <HelpTooltip
              helpKey=""
              customShort={
                canGenerate
                  ? "Сформировать документы пакета по заполненным данным."
                  : blockers[0] ?? "Подождите…"
              }
              alwaysShow
            >
              <span tabIndex={0}>
                <Button
                  size="sm"
                  disabled={!canGenerate}
                  onClick={() => handleGenerate("user_generate")}
                >
                  {isGenerating && lastRunMode !== "admin_test"
                    ? <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                    : <Sparkles className="h-4 w-4 mr-1" />}
                  Сформировать пакет документов
                </Button>
              </span>
            </HelpTooltip>
          </div>
        </div>

        {/* Preflight */}
        <div className="grid md:grid-cols-2 gap-3">
          <div className="border rounded-lg p-3 bg-muted/10">
            <div className="text-xs font-medium mb-2 flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 text-indigo-500" /> Состав запуска
            </div>
            <div className="space-y-1 text-[11px]">
              <div className="flex items-center gap-1.5">
                {hasItems
                  ? <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  : <AlertCircle className="h-3 w-3 text-amber-600" />}
                <span>Шаблонов в пакете: {packageItems?.length ?? 0}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {hasSession
                  ? <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  : <AlertCircle className="h-3 w-3 text-amber-600" />}
                <span>{hasSession ? "Анкета пакета сохранена" : "Анкета не сохранена"}</span>
              </div>
              <div className="flex items-center gap-1.5">
                {session?.selected_legal_entity_id
                  ? <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  : <AlertCircle className="h-3 w-3 text-amber-600" />}
                <span>
                  {session?.selected_legal_entity_id
                    ? "ЮЛ / ИП выбрано"
                    : "ЮЛ / ИП не выбрано"}
                </span>
              </div>
              {requiredFieldsGate.total > 0 && (
                <div className="flex items-center gap-1.5">
                  {requiredFieldsGate.satisfied
                    ? <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                    : <AlertCircle className="h-3 w-3 text-amber-600" />}
                  <span>
                    Обязательные поля документов: {requiredFieldsGate.total - requiredFieldsGate.missing}/{requiredFieldsGate.total}
                  </span>
                </div>
              )}
            </div>
          </div>

          <div className="border rounded-lg p-3 bg-muted/10">
            <div className="text-xs font-medium mb-2 flex items-center gap-1.5">
              <Info className="h-3.5 w-3.5 text-indigo-500" /> Обязательные роли
            </div>
            {requiredRolesStatus.length === 0 ? (
              <div className="text-[11px] text-muted-foreground">
                Обязательных ролей нет.
              </div>
            ) : (
              <ul className="space-y-1">
                {requiredRolesStatus.map(({ role, satisfied }) => (
                  <li key={role.id} className="flex items-center gap-1.5 text-[11px]">
                    {satisfied
                      ? <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                      : <AlertCircle className="h-3 w-3 text-amber-600" />}
                    <span className={satisfied ? "text-foreground" : "text-amber-700"}>
                      {role.label}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {blockers.length > 0 && (
          <div className="mt-3 border rounded-lg p-2.5 bg-amber-50 border-amber-200 text-[11px] text-amber-800 flex items-start gap-2">
            <AlertCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
            <div className="min-w-0">
              <div className="font-medium mb-0.5">Перед запуском нужно:</div>
              <ul className="list-disc list-inside space-y-0.5">
                {blockers.map((b, i) => <li key={i}>{b}</li>)}
              </ul>
            </div>
          </div>
        )}
      </GlassCard>

      {/* Результат последнего запуска */}
      {lastResult && (
        <GlassCard className="p-4">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="text-xs font-medium">Результат последнего запуска:</span>
            <Badge
              variant="outline"
              className={`text-[10px] ${
                lastResult.status === "generated"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                  : lastResult.status === "partial"
                  ? "bg-amber-50 text-amber-700 border-amber-300"
                  : "bg-rose-50 text-rose-700 border-rose-300"
              }`}
            >
              {lastResult.status === "generated" && "успешно"}
              {lastResult.status === "partial" && "частично"}
              {lastResult.status === "failed" && "ошибка"}
              {lastResult.status === "blocked" && "заблокировано"}
              {lastResult.status === "pending" && "в работе"}
            </Badge>
            <span className="text-[11px] text-muted-foreground">
              {lastResult.generated} из {lastResult.total} сформировано
              {lastResult.errors ? ` · ошибок: ${lastResult.errors}` : ""}
              {lastResult.blocked ? ` · блокировок: ${lastResult.blocked}` : ""}
            </span>
            {lastRunMode === "admin_test" && (
              <Badge variant="outline" className="text-[9px] gap-1 bg-amber-50 text-amber-700 border-amber-300">
                <FlaskConical className="h-2.5 w-2.5" /> тестовая
              </Badge>
            )}
          </div>
          <div className="space-y-1.5">
            {lastResult.results.map((r) => {
              const label = itemLabelById.get(r.item_id) || "Документ";
              const statusCls =
                r.status === "generated"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-300"
                  : "bg-rose-50 text-rose-700 border-rose-300";
              return (
                <div key={r.item_id} className="flex items-center gap-2 text-[11px] px-2 py-1.5 rounded border bg-background">
                  <FileText className="h-3.5 w-3.5 text-indigo-500 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{label}</div>
                    {(r.document_number || r.errors?.length) && (
                      <div className="text-[10px] text-muted-foreground truncate">
                        {r.document_number ? `№ ${r.document_number}` : ""}
                        {r.document_date ? ` · ${new Date(r.document_date).toLocaleDateString("ru-RU")}` : ""}
                        {r.errors?.length ? ` · ${r.errors.join("; ")}` : ""}
                      </div>
                    )}
                  </div>
                  <Badge variant="outline" className={`text-[10px] ${statusCls}`}>
                    {r.status === "generated" && "успешно"}
                    {r.status === "blocked" && "блок"}
                    {r.status === "error" && "ошибка"}
                    {r.status === "skipped" && "пропуск"}
                  </Badge>
                  {r.document_id && (
                    <>
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await downloadDocumentBlob(r.document_id!, "pdf");
                          if (!res.ok) toast.error((res as { message: string }).message);
                        }}
                        className="inline-flex items-center gap-1 text-[10px] text-indigo-600 hover:underline"
                      >
                        <FileDown className="h-3 w-3" /> PDF
                      </button>
                      <button
                        type="button"
                        onClick={async () => {
                          const res = await downloadDocumentBlob(r.document_id!, "docx");
                          if (!res.ok) toast.error((res as { message: string }).message);
                        }}
                        className="inline-flex items-center gap-1 text-[10px] text-indigo-600 hover:underline"
                      >
                        <FileDown className="h-3 w-3" /> DOCX
                      </button>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </GlassCard>
      )}

      {/* История запусков */}
      <GlassCard className="p-3">
        <PackageGenerationHistory
          packageSessionId={sessionId}
          isAdmin={isAdmin}
        />
      </GlassCard>
    </div>
  );
}
