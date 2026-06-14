/**
 * PackageGenerationPanel — Sprint 3I-B (variant 2).
 *
 * Отдельная подвкладка «Генерация» внутри `PackagesWorkspace`. Финальное
 * действие после заполнения состава, шаблонов, анкет и проверок.
 *
 * Содержит:
 *   • preflight-сводку (шаблон, состав, обязательные роли, blockers);
 *   • кнопку пользователя «Сформировать пакет документов»;
 *   • кнопку admin «Тестово сформировать» (`run_mode='admin_test'`);
 *   • per-item результат последнего запуска (DOCX/PDF ссылки);
 *   • `PackageGenerationHistory`.
 *
 * STOP:
 *   • НЕ трогает backend pipeline: `UI → ai-generate-document-package →
 *     canonical-document-generate-strict`.
 *   • НЕ материализует `ai_generated_documents` / Gotenberg / storage.
 *   • НЕ дублирует логику анкеты — данные читаются из
 *     `useDocumentPackageSession`.
 */
import { useMemo, useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sparkles, FlaskConical, Loader2, FileText, FileDown,
  CheckCircle2, AlertCircle, Info,
} from "lucide-react";
import { HelpTooltip } from "@/components/help/HelpComponents";
import { useRbac } from "@/hooks/useRbac";
import { useDocumentPackageSession } from "@/hooks/useDocumentPackageSession";
import { useDocumentPackageItems } from "@/hooks/useDocumentPackages";
import {
  useAiDocumentPackageGeneration,
  type PackageGenerationResult,
} from "@/hooks/useAiDocumentPackageGeneration";
import { downloadDocumentBlob } from "@/utils/downloadDocumentBlob";
import { toast } from "sonner";
import { PackageGenerationHistory } from "./PackageGenerationHistory";
import { PackageFieldsClientForm } from "./PackageFieldsClientForm";
import { usePackageSessionFields } from "@/hooks/usePackageSessionFields";

interface Props {
  /** Канонический код пакета (например, "ideology"). SOT — `document_package_templates.code`. */
  packageCode: string;
  packageName: string;
}

export function PackageGenerationPanel({ packageCode, packageName }: Props) {
  const rbac = useRbac();
  const isAdmin = rbac.isAdmin || rbac.isSuperAdmin;

  const pkg = useDocumentPackageSession(packageCode);
  const { items: packageItems } = useDocumentPackageItems(pkg.templateId);
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

  // Preflight — read-only сводка по сессии пакета (анкета, состав, роли).
  const requiredRolesStatus = useMemo(() => {
    return (pkg.roleCatalog ?? [])
      .filter((r) => r.required)
      .map((r) => {
        if (r.role_key === "package_company") {
          return { role: r, satisfied: !!pkg.session?.selected_legal_entity_id };
        }
        const count = (pkg.participants ?? []).filter((p) => p.role_key === r.role_key).length;
        const min = r.min_count ?? 1;
        return { role: r, satisfied: count >= min };
      });
  }, [pkg.roleCatalog, pkg.participants, pkg.session]);

  const allRequiredSatisfied = requiredRolesStatus.every((x) => x.satisfied);
  const hasSession = !!pkg.session?.id;
  const hasItems = (packageItems?.length ?? 0) > 0;

  // PATCH-PACKAGE-CUSTOM-FIELDS-V1 B2: required pf-fields gate.
  const fieldsState = usePackageSessionFields(pkg.session?.id ?? null, pkg.templateId);
  const requiredFieldsSatisfied = fieldsState.progress.allRequiredFilled;

  const blockers: string[] = [];
  if (!hasSession) blockers.push("Анкета пакета ещё не сохранена.");
  if (!hasItems) blockers.push("В пакете нет шаблонов.");
  if (hasSession && !allRequiredSatisfied) blockers.push("Не заполнены обязательные роли.");
  if (hasSession && !requiredFieldsSatisfied) {
    blockers.push(
      `Не заполнены обязательные поля пакета (${fieldsState.progress.requiredFilled}/${fieldsState.progress.requiredTotal}).`,
    );
  }

  const handleGenerate = async (runMode: "user_generate" | "admin_test") => {
    if (!pkg.session?.id) return;
    setLastRunMode(runMode);
    try {
      const data = await generatePackage({
        package_session_id: pkg.session.id,
        run_mode: runMode,
      });
      setLastResult(data);
    } catch {
      /* toast handled in hook */
    }
  };

  const canGenerate =
    hasSession && hasItems && allRequiredSatisfied && requiredFieldsSatisfied && !isGenerating;

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
                {pkg.session?.selected_legal_entity_id
                  ? <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  : <AlertCircle className="h-3 w-3 text-amber-600" />}
                <span>
                  {pkg.session?.selected_legal_entity_id
                    ? "ЮЛ / ИП выбрано"
                    : "ЮЛ / ИП не выбрано"}
                </span>
              </div>
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
            <div>
              <div className="font-medium mb-0.5">Перед запуском нужно:</div>
              <ul className="list-disc list-inside space-y-0.5">
                {blockers.map((b) => <li key={b}>{b}</li>)}
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
          packageSessionId={pkg.session?.id ?? null}
          isAdmin={isAdmin}
        />
      </GlassCard>
    </div>
  );
}
