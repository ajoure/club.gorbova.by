/**
 * DocumentPackageIdeologyView — Sprint 1: persisted package session.
 *
 * Replaces localStorage with backend `document_package_sessions` +
 * `document_package_session_participants`. Single legal entity per session,
 * physical persons get explicit package roles from
 * `document_package_role_catalog`.
 *
 * STOP:
 *   • не меняем fields_registry / billing resolver /
 *     canonical-document-generate-strict.
 *   • не подключаем генерацию пакета (Sprint 2).
 */
import { useEffect, useMemo, useState } from "react";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { FileText, Building2, Users, Save, Sparkles, Info, Lock, AlertCircle, CheckCircle2 } from "lucide-react";
import { StrictDocumentTemplatesManager } from "./StrictDocumentTemplatesManager";
import { PackageTokensDryRunPanel } from "./PackageTokensDryRunPanel";
import { useAiEntities } from "@/hooks/useAiEntities";
import { useAiPersons } from "@/hooks/useAiPersons";
import type { ClientLegalDetails } from "@/hooks/useLegalDetails";
import {
  useDocumentPackageSession,
  type PersonAssignment,
  type PackageSessionDisplayStatus,
} from "@/hooks/useDocumentPackageSession";

/**
 * Sprint 3C: для каких ролей UI показывает поле «Должность» и пишет его
 * в `participants.metadata.position`. Whitelist hardcoded только на этот спринт;
 * перенос в `document_package_role_catalog.metadata.requires_position` — backlog.
 */
const ROLES_WITH_POSITION = new Set<string>([
  "company_head",
  "ideology_responsible",
]);

const LEGACY_LS_KEY = "document_package_questionnaire_ideology_v1";

function entityDisplayName(e: ClientLegalDetails): string {
  if (e.client_type === "legal_entity") return e.leg_name ?? "Юрлицо без названия";
  if (e.client_type === "entrepreneur") return e.ent_name ?? "ИП без названия";
  return e.ind_full_name ?? "Физлицо без имени";
}
function entityUnp(e: ClientLegalDetails): string | null {
  if (e.client_type === "legal_entity") return e.leg_unp ?? null;
  if (e.client_type === "entrepreneur") return e.ent_unp ?? null;
  return null;
}

interface LegacyDraft {
  selectedEntityIds: string[];
  selectedPersonIds: string[];
}

function readLegacyDraft(): LegacyDraft | null {
  try {
    const raw = localStorage.getItem(LEGACY_LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return {
      selectedEntityIds: Array.isArray(parsed?.selectedEntityIds)
        ? parsed.selectedEntityIds.filter((x: unknown) => typeof x === "string") : [],
      selectedPersonIds: Array.isArray(parsed?.selectedPersonIds)
        ? parsed.selectedPersonIds.filter((x: unknown) => typeof x === "string") : [],
    };
  } catch {
    return null;
  }
}

const STATUS_META: Record<PackageSessionDisplayStatus, { label: string; className: string; icon: React.ComponentType<{ className?: string }>; }> = {
  not_saved:     { label: "Не сохранено",      className: "text-muted-foreground border-muted",                            icon: Info },
  requires_fill: { label: "Требует заполнения", className: "text-amber-700 border-amber-300 bg-amber-50 dark:bg-amber-950/30", icon: AlertCircle },
  saved:         { label: "Сохранено",          className: "text-emerald-700 border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30", icon: CheckCircle2 },
  locked:        { label: "Закреплено",         className: "text-indigo-700 border-indigo-300 bg-indigo-50 dark:bg-indigo-950/30",     icon: Lock },
};

export function DocumentPackageIdeologyView() {
  const aiEntities = useAiEntities();
  const aiPersons = useAiPersons();
  const pkg = useDocumentPackageSession("ideology");

  // Local UI state (mirrors backend on hydration)
  const [legalEntityId, setLegalEntityId] = useState<string | null>(null);
  // person_id -> role_key
  const [personRoles, setPersonRoles] = useState<Record<string, string | undefined>>({});
  // Sprint 3C: person_id -> position (только для ролей из ROLES_WITH_POSITION)
  const [personPositions, setPersonPositions] = useState<Record<string, string>>({});
  const [hydrated, setHydrated] = useState(false);

  // Hydrate from session/participants (or legacy LS draft if no session yet)
  useEffect(() => {
    if (pkg.isLoading) return;
    if (hydrated) return;

    if (pkg.session) {
      setLegalEntityId(pkg.session.selected_legal_entity_id ?? null);
      const roleMap: Record<string, string> = {};
      const posMap: Record<string, string> = {};
      for (const p of pkg.participants) {
        if (p.entity_type === "person" && p.person_id) {
          roleMap[p.person_id] = p.role_key;
          const meta = (p.metadata ?? {}) as Record<string, unknown>;
          const pos = meta.position;
          if (typeof pos === "string" && pos.length > 0) {
            posMap[p.person_id] = pos;
          }
        }
      }
      setPersonRoles(roleMap);
      setPersonPositions(posMap);
    } else {
      // Legacy LS draft as one-time read fallback (will be wiped on first save).
      const legacy = readLegacyDraft();
      if (legacy) {
        if (legacy.selectedEntityIds.length > 0) {
          setLegalEntityId(legacy.selectedEntityIds[0]); // single-select migration
        }
      }
    }
    setHydrated(true);
  }, [pkg.isLoading, pkg.session, pkg.participants, hydrated]);

  const legalEntities = useMemo(
    () => aiEntities.allEntities.filter((e) => e.client_type === "legal_entity" || e.client_type === "entrepreneur"),
    [aiEntities.allEntities],
  );
  const persons = aiPersons.allPersons;

  // Available roles for persons (exclude package_company — это юрлицо)
  const personRoleOptions = useMemo(
    () => pkg.roleCatalog.filter((r) =>
      r.allowed_entity_types.includes("person") && r.role_key !== "package_company"
    ),
    [pkg.roleCatalog],
  );

  const requiredRolesStatus = useMemo(() => {
    return pkg.roleCatalog
      .filter((r) => r.required)
      .map((r) => {
        if (r.role_key === "package_company") {
          return { role: r, satisfied: !!legalEntityId };
        }
        const count = Object.values(personRoles).filter((rk) => rk === r.role_key).length;
        const min = r.min_count ?? 1;
        return { role: r, satisfied: count >= min };
      });
  }, [pkg.roleCatalog, legalEntityId, personRoles]);

  const allRequiredSatisfied = requiredRolesStatus.every((x) => x.satisfied);
  const isLocked = pkg.isLocked;

  const handleSave = async () => {
    const assignments: PersonAssignment[] = Object.entries(personRoles)
      .filter(([, role]) => !!role)
      .map(([person_id, role_key]) => {
        const def = pkg.roleCatalog.find((r) => r.role_key === role_key);
        const needsPos = ROLES_WITH_POSITION.has(role_key!);
        const pos = needsPos ? (personPositions[person_id] ?? "").trim() : "";
        return {
          person_id,
          role_key: role_key!,
          role_catalog_id: def?.id ?? null,
          position: pos.length > 0 ? pos : null,
        };
      });
    try {
      await pkg.save({
        selectedLegalEntityId: legalEntityId,
        personAssignments: assignments,
      });
    } catch { /* toast handled in hook */ }
  };

  const statusMeta = STATUS_META[pkg.displayStatus];
  const StatusIcon = statusMeta.icon;

  return (
    <div className="space-y-4">
      {/* Блок A. Состав пакета (read-only) */}
      <GlassCard className="p-4">
        <StrictDocumentTemplatesManager
          embedded
          readOnly
          categoryFilter="ideology"
          title="Состав пакета «Идеология»"
          subtitle={<>Шаблоны документов, входящие в пакет. Список наполняется администратором.</>}
          emptyText="В пакете «Идеология» пока нет готовых шаблонов. Администратор добавит их позже."
        />
      </GlassCard>

      {/* Блок B. Анкета */}
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <FileText className="h-5 w-5 text-indigo-500" />
          <h2 className="text-lg font-semibold">Анкета пакета</h2>
          <Badge variant="outline" className={`text-[10px] gap-1 ${statusMeta.className}`}>
            <StatusIcon className="h-3 w-3" />
            {statusMeta.label}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Выберите одно юрлицо/ИП пакета и назначьте физлицам роли. Данные сохраняются в вашем кабинете.
          {isLocked && " Юрлицо закреплено и не может быть изменено."}
        </p>

        <div className="grid md:grid-cols-2 gap-4">
          {/* Юрлицо — single-select */}
          <div className="border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <Building2 className="h-4 w-4 text-indigo-500" />
              <span className="text-sm font-medium">Юрлицо / ИП пакета</span>
              <Badge variant="secondary" className="text-[10px]">одно</Badge>
            </div>
            {aiEntities.isLoading ? (
              <div className="text-xs text-muted-foreground py-4 text-center">Загрузка…</div>
            ) : legalEntities.length === 0 ? (
              <div className="text-xs text-muted-foreground py-4 text-center">
                Нет юрлиц/ИП. Добавьте их во вкладке «Реквизиты».
              </div>
            ) : (
              <Select
                value={legalEntityId ?? ""}
                onValueChange={(v) => !isLocked && setLegalEntityId(v || null)}
                disabled={isLocked}
              >
                <SelectTrigger className="h-9 text-xs">
                  <SelectValue placeholder="Выберите юрлицо или ИП" />
                </SelectTrigger>
                <SelectContent>
                  {legalEntities.map((e) => {
                    const unp = entityUnp(e);
                    return (
                      <SelectItem key={e.id} value={e.id} className="text-xs">
                        {entityDisplayName(e)}{unp ? ` · УНП ${unp}` : ""}
                      </SelectItem>
                    );
                  })}
                </SelectContent>
              </Select>
            )}
            {isLocked && (
              <div className="mt-2 flex items-center gap-1 text-[11px] text-indigo-700">
                <Lock className="h-3 w-3" /> Закреплено для этого пакета.
              </div>
            )}
          </div>

          {/* Физлица + роли */}
          <div className="border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-2">
              <Users className="h-4 w-4 text-teal-500" />
              <span className="text-sm font-medium">Физлица и их роли</span>
              <Badge variant="secondary" className="text-[10px]">
                назначено: {Object.values(personRoles).filter(Boolean).length}
              </Badge>
            </div>
            {aiPersons.isLoading ? (
              <div className="text-xs text-muted-foreground py-4 text-center">Загрузка…</div>
            ) : persons.length === 0 ? (
              <div className="text-xs text-muted-foreground py-4 text-center">
                Нет физлиц. Добавьте их во вкладке «Реквизиты».
              </div>
            ) : (
              <ScrollArea className="h-56 pr-2">
                <div className="space-y-1.5">
                  {persons.map((p) => {
                    const currentRole = personRoles[p.id] ?? "";
                    const needsPos = ROLES_WITH_POSITION.has(currentRole);
                    const currentPos = personPositions[p.id] ?? "";
                    const posMissing = needsPos && currentPos.trim().length === 0;
                    return (
                      <div key={p.id} className="px-2 py-1 rounded hover:bg-accent/30">
                        <div className="flex items-center gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium truncate">{p.full_name ?? "—"}</div>
                            <div className="text-[10px] text-muted-foreground truncate">
                              {p.is_active ? "активен" : "архив"}
                            </div>
                          </div>
                          <Select
                            value={currentRole}
                            onValueChange={(v) => {
                              const next = !v || v === "__none__" ? "" : v;
                              setPersonRoles((prev) => {
                                const out = { ...prev };
                                if (!next) delete out[p.id];
                                else out[p.id] = next;
                                return out;
                              });
                              // Если новая роль не требует position — чистим стейт.
                              if (!ROLES_WITH_POSITION.has(next)) {
                                setPersonPositions((prev) => {
                                  if (!(p.id in prev)) return prev;
                                  const out = { ...prev };
                                  delete out[p.id];
                                  return out;
                                });
                              }
                            }}
                          >
                            <SelectTrigger className="h-7 text-[11px] w-[180px]">
                              <SelectValue placeholder="Без роли" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__" className="text-[11px]">— без роли —</SelectItem>
                              {personRoleOptions.map((r) => (
                                <SelectItem key={r.id} value={r.role_key} className="text-[11px]">
                                  {r.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        {needsPos && (
                          <div className="mt-1 ml-1 flex items-center gap-1.5">
                            <Input
                              value={currentPos}
                              onChange={(e) =>
                                setPersonPositions((prev) => ({ ...prev, [p.id]: e.target.value }))
                              }
                              placeholder="Должность (например, Директор)"
                              className="h-7 text-[11px] flex-1"
                            />
                            {posMissing && (
                              <span className="flex items-center gap-1 text-[10px] text-amber-700">
                                <AlertCircle className="h-3 w-3" /> заполните должность
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </ScrollArea>
            )}
          </div>
        </div>

        {/* Required roles checklist */}
        {requiredRolesStatus.length > 0 && (
          <div className="mt-4 border rounded-lg p-3 bg-muted/30">
            <Label className="text-xs font-medium">Обязательные роли</Label>
            <ul className="mt-2 space-y-1">
              {requiredRolesStatus.map(({ role, satisfied }) => (
                <li key={role.id} className="flex items-center gap-2 text-[11px]">
                  {satisfied ? (
                    <CheckCircle2 className="h-3 w-3 text-emerald-600" />
                  ) : (
                    <AlertCircle className="h-3 w-3 text-amber-600" />
                  )}
                  <span className={satisfied ? "text-foreground" : "text-amber-700"}>{role.label}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="mt-4 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-[11px] text-muted-foreground flex items-center gap-1">
            <Info className="h-3 w-3" />
            {pkg.session
              ? `Сохранено: ${new Date(pkg.session.updated_at).toLocaleString("ru-RU")}`
              : "Анкета ещё не сохранялась"}
          </div>
          <Button
            size="sm"
            onClick={handleSave}
            disabled={!hydrated || pkg.isSaving || pkg.isLoading}
          >
            <Save className="h-4 w-4 mr-1" /> {pkg.isSaving ? "Сохранение…" : "Сохранить анкету"}
          </Button>
        </div>

        {/* Sprint 3C: dev-only dry-run панель, видна только super_admin. */}
        <PackageTokensDryRunPanel packageSessionId={pkg.session?.id ?? null} />
      </GlassCard>

      {/* Блок C. Сформировать пакет (всегда disabled — Sprint 2) */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-orange-500" />
              Сформировать пакет
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              {allRequiredSatisfied
                ? "Анкета заполнена. Генерация пакета будет подключена в Sprint 2."
                : "Сначала заполните обязательные роли. Генерация подключается в Sprint 2."}
            </p>
          </div>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span tabIndex={0}>
                  <Button size="sm" disabled>
                    <Sparkles className="h-4 w-4 mr-1" /> Сформировать пакет
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>
                Генерация пакета подключается в Sprint 2.
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </GlassCard>
    </div>
  );
}
