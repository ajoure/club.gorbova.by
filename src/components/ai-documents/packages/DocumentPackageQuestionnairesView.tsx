/**
 * DocumentPackageQuestionnairesView — Sprint 3G.
 *
 * Document-level questionnaires: для каждого шаблона пакета — отдельная
 * анкета ролей. Один человек = разные роли в разных документах одного пакета;
 * одна роль может быть назначена нескольким физлицам в одном документе.
 *
 * Верх: общее ЮЛ/ИП пакета (session.selected_legal_entity_id), применяется
 * ко всем документам. Снизу: аккордеон по каждому document_package_template_item.
 *
 * SOT назначений: `document_package_item_role_assignments`. В
 * `document_package_session_participants` (legacy) этот UI НЕ пишет.
 *
 * STOP: не вызывает генерацию, не трогает billing resolver, не пишет в
 * ai_generated_documents.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { GlassCard } from "@/components/ui/GlassCard";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Accordion, AccordionContent, AccordionItem, AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Building2, Users, Save, Plus, Trash2, AlertCircle, CheckCircle2, Info, Loader2, FileText,
} from "lucide-react";
import { HelpTooltip } from "@/components/help/HelpComponents";
import { toast } from "sonner";
import { useAiEntities } from "@/hooks/useAiEntities";
import { useAiPersons } from "@/hooks/useAiPersons";
import { useRbac } from "@/hooks/useRbac";
import { usePackageRoleCatalog } from "@/hooks/usePackageRoleCatalog";
import { useDocumentItemRoleAssignments } from "@/hooks/useDocumentItemRoleAssignments";
import { InlineCreateRoleDialog } from "./InlineCreateRoleDialog";
import { PackageFieldsClientForm } from "./PackageFieldsClientForm";
import type { ClientLegalDetails } from "@/hooks/useLegalDetails";

interface Props {
  packageTemplateId: string;
  packageName: string;
}

interface ItemRow {
  id: string;
  sort_order: number;
  template_id: string;
  template_name: string;
}

function entityDisplay(e: ClientLegalDetails): string {
  if (e.client_type === "legal_entity") return e.leg_name ?? "Юрлицо без названия";
  if (e.client_type === "entrepreneur") return e.ent_name ?? "ИП без названия";
  return e.ind_full_name ?? "Физлицо без имени";
}
function entityUnp(e: ClientLegalDetails): string | null {
  if (e.client_type === "legal_entity") return e.leg_unp ?? null;
  if (e.client_type === "entrepreneur") return e.ent_unp ?? null;
  return null;
}

export function DocumentPackageQuestionnairesView({ packageTemplateId, packageName }: Props) {
  const { user } = useAuth();
  const aiEntities = useAiEntities();
  const aiPersons = useAiPersons();
  const rbac = useRbac();
  const isAdmin = rbac.isAdmin || rbac.isSuperAdmin;
  const { roles: catalogRoles } = usePackageRoleCatalog(packageTemplateId);
  const activeRoles = useMemo(
    () => catalogRoles.filter((r) => r.is_active && !r.is_system),
    [catalogRoles],
  );

  // 1. Profile id
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

  // 2. Session (one per profile + package)
  const sessionQuery = useQuery({
    queryKey: ["doc-pkg-session-q", profileId, packageTemplateId],
    queryFn: async () => {
      if (!profileId) return null;
      const { data: existing } = await supabase
        .from("document_package_sessions")
        .select("id, selected_legal_entity_id, legal_entity_locked_at, created_at")
        .eq("profile_id", profileId)
        .eq("package_template_id", packageTemplateId)
        .is("entitlement_id", null)
        .is("order_id", null)
        .neq("status", "archived")
        .maybeSingle();
      if (existing) return existing;
      return null;
    },
    enabled: !!profileId,
  });

  const sessionId = sessionQuery.data?.id ?? null;
  const legalLocked = !!sessionQuery.data?.legal_entity_locked_at;

  // 3. Template items
  const itemsQuery = useQuery({
    queryKey: ["doc-pkg-template-items-q", packageTemplateId],
    queryFn: async () => {
      const { data: items, error } = await supabase
        .from("document_package_template_items")
        .select("id, sort_order, template_id")
        .eq("package_template_id", packageTemplateId)
        .order("sort_order");
      if (error) throw error;
      const ids = (items ?? []).map((r: any) => r.template_id);
      if (ids.length === 0) return [] as ItemRow[];
      const { data: tpls } = await supabase
        .from("document_templates").select("id, name").in("id", ids);
      const map = new Map((tpls ?? []).map((t: any) => [t.id, t.name]));
      return (items ?? []).map((r: any) => ({
        id: r.id,
        sort_order: r.sort_order,
        template_id: r.template_id,
        template_name: (map.get(r.template_id) as string) ?? "—",
      })) as ItemRow[];
    },
  });

  // 4. Local ЮЛ/ИП state
  const [legalEntityId, setLegalEntityId] = useState<string | null>(null);
  const [hydratedLegal, setHydratedLegal] = useState(false);
  useEffect(() => {
    // Bugfix 2026-05: в react-query v5 `isLoading=false` для disabled-запросов,
    // поэтому старая проверка `sessionQuery.isLoading` срабатывала ДО того,
    // как сам запрос успевал стартовать (когда profileId ещё не resolved),
    // и фиксировала legalEntityId=null навсегда. Дожидаемся `isFetched`.
    if (!sessionQuery.isFetched) return;
    if (hydratedLegal) return;
    setLegalEntityId(sessionQuery.data?.selected_legal_entity_id ?? null);
    setHydratedLegal(true);
  }, [sessionQuery.isFetched, sessionQuery.data, hydratedLegal]);

  const legalEntities = useMemo(
    () => aiEntities.allEntities.filter(
      (e) => e.client_type === "legal_entity" || e.client_type === "entrepreneur"
    ),
    [aiEntities.allEntities],
  );

  const [savingLegal, setSavingLegal] = useState(false);
  const saveLegal = async () => {
    if (!profileId || !user) return;
    setSavingLegal(true);
    try {
      if (!sessionId) {
        const { error } = await supabase.from("document_package_sessions").insert({
          profile_id: profileId,
          package_template_id: packageTemplateId,
          user_id: user.id,
          created_by: user.id,
          updated_by: user.id,
          status: "draft",
          selected_legal_entity_id: legalEntityId,
        });
        if (error) throw error;
      } else {
        if (legalLocked && sessionQuery.data?.selected_legal_entity_id &&
            legalEntityId !== sessionQuery.data.selected_legal_entity_id) {
          throw new Error("Юрлицо закреплено и не может быть изменено");
        }
        const { error } = await supabase.from("document_package_sessions").update({
          selected_legal_entity_id: legalEntityId,
          updated_by: user.id,
        }).eq("id", sessionId);
        if (error) throw error;
      }
      toast.success("ЮЛ/ИП пакета сохранены");
      sessionQuery.refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Не удалось сохранить");
    } finally {
      setSavingLegal(false);
    }
  };

  const items = itemsQuery.data ?? [];

  return (
    <div className="space-y-4">
      {/* Общее ЮЛ/ИП пакета */}
      <GlassCard className="p-4">
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <Building2 className="h-4 w-4 text-indigo-500" />
          <h3 className="text-sm font-semibold">ЮЛ / ИП пакета</h3>
          <Badge variant="outline" className="text-[10px] h-4 px-1.5">
            одно на весь пакет
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mb-3 flex items-start gap-1.5">
          <Info className="h-3 w-3 mt-0.5 shrink-0" />
          Выбранное юрлицо/ИП применяется ко всем документам пакета. Назначения
          физлиц на роли делаются отдельно для каждого документа ниже.
        </p>
        {aiEntities.isLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : legalEntities.length === 0 ? (
          <div className="text-xs text-muted-foreground py-2">
            Нет юрлиц/ИП. Добавьте их во вкладке «Реквизиты».
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <Select
              value={legalEntityId ?? ""}
              onValueChange={(v) => !legalLocked && setLegalEntityId(v || null)}
              disabled={legalLocked}
            >
              <SelectTrigger className="h-9 text-xs max-w-md">
                <SelectValue placeholder="Выберите юрлицо или ИП" />
              </SelectTrigger>
              <SelectContent>
                {legalEntities.map((e) => {
                  const unp = entityUnp(e);
                  return (
                    <SelectItem key={e.id} value={e.id} className="text-xs">
                      {entityDisplay(e)}{unp ? ` · УНП ${unp}` : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <HelpTooltip
              helpKey=""
              customShort="Сохранить выбранное юрлицо/ИП для всех документов пакета."
              alwaysShow
            >
              <Button size="sm" onClick={saveLegal} disabled={savingLegal || legalLocked}>
                <Save className="h-3.5 w-3.5 mr-1" />
                {savingLegal ? "Сохранение…" : "Сохранить"}
              </Button>
            </HelpTooltip>
          </div>
        )}
      </GlassCard>

      {/* Аккордеон по документам — каждый шаблон содержит свои поля + роли */}
      {itemsQuery.isLoading ? (
        <GlassCard className="p-6 flex justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </GlassCard>
      ) : items.length === 0 ? (
        <GlassCard className="p-6 text-sm text-center text-muted-foreground space-y-1">
          <div>В пакете «{packageName}» пока нет шаблонов.</div>
          <div className="text-xs">
            Загрузите DOCX во вкладке «Шаблоны документов» и выберите пакет «{packageName}».
          </div>
        </GlassCard>
      ) : !sessionId ? (
        <GlassCard className="p-4 text-xs text-muted-foreground">
          Сначала сохраните ЮЛ/ИП пакета — будет создана анкета пакета,
          после чего станет доступно заполнение полей и ролей по документам.
        </GlassCard>
      ) : (
        <GlassCard className="p-3">
          <Accordion type="multiple" className="w-full">
            {items.map((item) => (
              <ItemQuestionnaire
                key={item.id}
                item={item}
                packageTemplateId={packageTemplateId}
                sessionId={sessionId}
                sessionCreatedAt={(sessionQuery.data as any)?.created_at ?? null}
                activeRoles={activeRoles}
                persons={aiPersons.allPersons}
                personsLoading={aiPersons.isLoading}
                isAdmin={isAdmin}
              />
            ))}
          </Accordion>
        </GlassCard>
      )}
    </div>
  );
}

interface ItemQuestionnaireProps {
  item: ItemRow;
  packageTemplateId: string;
  sessionId: string;
  sessionCreatedAt: string | null;
  activeRoles: { id: string; label: string; role_key: string; public_id: string }[];
  persons: { id: string; full_name: string | null; is_active: boolean }[];
  personsLoading: boolean;
  isAdmin: boolean;
}

interface DraftRow {
  uid: string;
  role_catalog_id: string;
  person_id: string;
  position: string;
}

function newUid() {
  return Math.random().toString(36).slice(2);
}

function ItemQuestionnaire({
  item, packageTemplateId, sessionId, sessionCreatedAt,
  activeRoles, persons, personsLoading, isAdmin,
}: ItemQuestionnaireProps) {
  const { assignments, isLoading, save, isSaving } = useDocumentItemRoleAssignments(sessionId, item.id);
  const fieldsRef = useRef<PackageFieldsSubmitHandle>(null);
  const fieldsState = usePackageSessionFields(sessionId, packageTemplateId);
  const itemQuestions = fieldsState.getItemQuestions(item.id);
  const itemProgress = fieldsState.getItemProgress(item.id);

  const [draft, setDraft] = useState<DraftRow[] | null>(null);

  // hydrate when assignments loaded
  useEffect(() => {
    if (isLoading) return;
    if (draft !== null) return;
    setDraft(
      assignments.map((a) => ({
        uid: a.id,
        role_catalog_id: a.role_catalog_id,
        person_id: a.person_id ?? "",
        position: ((a.metadata as any)?.position as string) ?? "",
      })),
    );
  }, [isLoading, assignments, draft]);

  const filledRolesCount = (draft ?? []).filter((r) => r.role_catalog_id && r.person_id).length;

  const addRow = (preselectRoleKey?: string) => {
    const role = preselectRoleKey
      ? activeRoles.find((r) => r.role_key === preselectRoleKey)
      : undefined;
    setDraft((prev) => [
      ...(prev ?? []),
      { uid: newUid(), role_catalog_id: role?.id ?? "", person_id: "", position: "" },
    ]);
  };

  const updateRow = (uid: string, patch: Partial<DraftRow>) => {
    setDraft((prev) => (prev ?? []).map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
  };
  const removeRow = (uid: string) => {
    setDraft((prev) => (prev ?? []).filter((r) => r.uid !== uid));
  };

  const handleSaveAll = async () => {
    // 1) Сначала сохраняем поля документа (per-item).
    if (fieldsRef.current && fieldsRef.current.isDirty) {
      const ok = await fieldsRef.current.submit();
      if (!ok) {
        toast.error("Не удалось сохранить поля документа");
        return;
      }
    }
    // 2) Затем сохраняем роли документа.
    const payload = (draft ?? [])
      .filter((r) => r.role_catalog_id && r.person_id)
      .map((r) => ({
        role_catalog_id: r.role_catalog_id,
        person_id: r.person_id,
        position: r.position.trim() || null,
      }));
    try {
      await save(payload);
      toast.success("Анкета документа сохранена");
    } catch { /* toast in hook */ }
  };

  const hasFields = itemQuestions.length > 0;
  const fieldsBadge = hasFields
    ? `${itemProgress.filled}/${itemProgress.total} полей`
    : null;
  const rolesBadge = `${filledRolesCount} ролей`;

  return (
    <AccordionItem value={item.id}>
      <AccordionTrigger className="px-2 hover:no-underline">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <Badge variant="outline" className="text-[10px] h-4 px-1.5 shrink-0">
            #{item.sort_order}
          </Badge>
          <FileText className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
          <span className="text-sm font-medium truncate text-left">{item.template_name}</span>
          <div className="flex items-center gap-1 ml-auto shrink-0">
            {fieldsBadge && (
              <Badge variant="outline"
                className={`text-[10px] h-4 px-1.5 ${
                  itemProgress.allRequiredFilled
                    ? "border-emerald-300 text-emerald-700"
                    : "text-muted-foreground"
                }`}>
                {itemProgress.allRequiredFilled
                  ? <CheckCircle2 className="h-2.5 w-2.5 mr-1" />
                  : <AlertCircle className="h-2.5 w-2.5 mr-1" />}
                {fieldsBadge}
              </Badge>
            )}
            <Badge variant="outline"
              className={`text-[10px] h-4 px-1.5 ${
                filledRolesCount === 0 ? "text-muted-foreground" : "border-emerald-300 text-emerald-700"
              }`}>
              {filledRolesCount === 0
                ? <AlertCircle className="h-2.5 w-2.5 mr-1" />
                : <CheckCircle2 className="h-2.5 w-2.5 mr-1" />}
              {rolesBadge}
            </Badge>
          </div>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-3 pb-3 space-y-4">
        {/* Поля этого документа */}
        {hasFields && (
          <div className="space-y-2">
            <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
              <ListChecks className="h-3 w-3" /> Поля документа
            </div>
            <PackageFieldsClientForm
              ref={fieldsRef}
              sessionId={sessionId}
              packageTemplateId={packageTemplateId}
              packageTemplateItemId={item.id}
              sessionCreatedAt={sessionCreatedAt}
              hideSaveButton
            />
          </div>
        )}

        {/* Роли этого документа */}
        <div className="space-y-2">
          <div className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
            <Users className="h-3 w-3" /> Роли документа
          </div>
          {isLoading || draft === null ? (
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          ) : activeRoles.length === 0 ? (
            <div className="text-xs text-muted-foreground border border-dashed rounded p-3 text-center">
              В пакете нет активных ролей. Создайте роль в подвкладке «Роли пакета»
              {isAdmin && (
                <div className="mt-2">
                  <InlineCreateRoleDialog packageTemplateId={packageTemplateId} />
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="space-y-1.5">
                {(draft ?? []).length === 0 && (
                  <div className="text-xs text-muted-foreground text-center py-2">
                    Пока нет назначений. Добавьте первую роль.
                  </div>
                )}
                {(draft ?? []).map((row) => (
                  <div key={row.uid} className="flex items-start gap-1.5 border rounded p-2">
                    <Select value={row.role_catalog_id}
                      onValueChange={(v) => updateRow(row.uid, { role_catalog_id: v })}>
                      <SelectTrigger className="h-8 text-[11px] flex-1">
                        <SelectValue placeholder="Роль…" />
                      </SelectTrigger>
                      <SelectContent>
                        {activeRoles.map((r) => (
                          <SelectItem key={r.id} value={r.id} className="text-[11px]">
                            {r.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={row.person_id}
                      onValueChange={(v) => updateRow(row.uid, { person_id: v })}>
                      <SelectTrigger className="h-8 text-[11px] flex-1">
                        <SelectValue placeholder="Физлицо…" />
                      </SelectTrigger>
                      <SelectContent>
                        {personsLoading ? (
                          <div className="px-2 py-1 text-[11px] text-muted-foreground">Загрузка…</div>
                        ) : persons.filter((p) => p.is_active).length === 0 ? (
                          <div className="px-2 py-1 text-[11px] text-muted-foreground">
                            Нет физлиц. Добавьте их во вкладке «Реквизиты».
                          </div>
                        ) : (
                          persons.filter((p) => p.is_active).map((p) => (
                            <SelectItem key={p.id} value={p.id} className="text-[11px]">
                              {p.full_name ?? "—"}
                            </SelectItem>
                          ))
                        )}
                      </SelectContent>
                    </Select>
                    <Input value={row.position}
                      onChange={(e) => updateRow(row.uid, { position: e.target.value })}
                      placeholder="Должность (опц.)" className="h-8 text-[11px] flex-1" />
                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                      onClick={() => removeRow(row.uid)}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>
              <Button size="sm" variant="outline" onClick={() => addRow()}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Добавить роль
              </Button>
            </>
          )}
        </div>

        {/* Единая кнопка сохранения по документу (поля + роли) */}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border/40">
          <p className="text-[10px] text-muted-foreground flex items-start gap-1">
            <Info className="h-2.5 w-2.5 mt-0.5 shrink-0" />
            Значения полей сохраняются для этого документа. Если поле не заполнено
            здесь — используется общее значение пакета.
          </p>
          <HelpTooltip
            helpKey=""
            customShort="Сохранить поля и роли этого документа."
            alwaysShow
          >
            <Button size="sm" onClick={handleSaveAll} disabled={isSaving}>
              <Save className="h-3.5 w-3.5 mr-1" />
              {isSaving ? "Сохранение…" : "Сохранить анкету документа"}
            </Button>
          </HelpTooltip>
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
