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
  Building2, Users, Save, Plus, Trash2, AlertCircle, CheckCircle2, Info, Loader2, FileText, ListChecks,
} from "lucide-react";
import { HelpTooltip } from "@/components/help/HelpComponents";
import { toast } from "sonner";
import { useAiEntities } from "@/hooks/useAiEntities";
import { useAiPersons } from "@/hooks/useAiPersons";
import { useRbac } from "@/hooks/useRbac";
import { usePackageRoleCatalog } from "@/hooks/usePackageRoleCatalog";
import { useDocumentItemRoleAssignments } from "@/hooks/useDocumentItemRoleAssignments";
import { usePackageSessionFields } from "@/hooks/usePackageSessionFields";
import { InlineCreateRoleDialog } from "./InlineCreateRoleDialog";
import { PackageFieldsClientForm } from "./PackageFieldsClientForm";
import { PackageDocumentCard } from "./PackageDocumentCard";
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
  active_version_id: string | null;
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
  // Orphan pf уровня пакета — диагностический блок, не часть анкеты документа.
  const packageFields = usePackageSessionFields(null, packageTemplateId);
  const orphanCount = packageFields.orphanQuestions.length;

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
      // Stage 5.0.2 fix: schema uses `current_version_id`, not `active_version_id`.
      // Старый код падал на PostgREST с "column does not exist", из-за чего
      // tpls был пуст: имя шаблона = "—" и active_version_id = null
      // (отсюда же постоянный бейдж «нет активной версии» в карточке).
      const { data: tpls, error: tErr } = await supabase
        .from("document_templates").select("id, name, current_version_id").in("id", ids);
      if (tErr) throw tErr;
      const map = new Map((tpls ?? []).map((t: any) => [t.id, t]));
      return (items ?? []).map((r: any) => {
        const tpl: any = map.get(r.template_id);
        return {
          id: r.id,
          sort_order: r.sort_order,
          template_id: r.template_id,
          template_name: (tpl?.name as string) ?? "",
          active_version_id: (tpl?.current_version_id as string | null) ?? null,
        };
      }) as ItemRow[];
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

      {/* Общие orphan-поля пакета (диагностика): pf каталога, не вставленные ни в один шаблон. */}
      {sessionId && orphanCount > 0 && (
        <GlassCard className="p-4 border-amber-200/60 dark:border-amber-900/40">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <ListChecks className="h-4 w-4 text-amber-500" />
            <h3 className="text-sm font-semibold">Общие поля пакета</h3>
            <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-amber-300 text-amber-700">
              не используются в документах
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground mb-3 flex items-start gap-1.5">
            <Info className="h-3 w-3 mt-0.5 shrink-0" />
            Эти поля созданы в каталоге пакета, но пока не вставлены ни в один
            шаблон документа. Сохранённые значения не используются при генерации
            и не блокируют формирование пакета. Как только токен поля появится
            в активной версии шаблона, поле автоматически перейдёт в анкету
            нужного документа, а сохранённое здесь значение станет общим
            значением пакета.
          </p>
          <PackageFieldsClientForm
            sessionId={sessionId}
            packageTemplateId={packageTemplateId}
            sessionCreatedAt={(sessionQuery.data as any)?.created_at ?? null}
            orphanOnly
          />
        </GlassCard>
      )}

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
              <PackageDocumentCard
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

