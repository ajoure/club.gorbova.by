/**
 * PackagesWorkspace — Sprint 3F Phase 2c.
 *
 * Единая рабочая область вкладки «Пакеты документов».
 *  • Переключатель пакетов сверху (Идеология + grey placeholders на будущее).
 *  • Внутренние подвкладки конкретного пакета:
 *      Состав / Шаблоны пакета / Анкета пакета / Роли пакета / Проверка шаблонов.
 *  • Админские подвкладки (Шаблоны, Роли, Проверка) видны только super_admin/admin.
 *
 * Жёсткие ограничения (см. .lovable/plan.md Phase 2c):
 *  • НЕ трогаем canonical-document-generate-strict, Gotenberg, ai_generated_documents,
 *    billing resolver, биллинговые группы плейсхолдеров, реквизитные таблицы.
 *  • НЕ материализуем package-template-link «вручную» — только через RPC
 *    package_template_bind_template / package_template_unbind_template,
 *    которые уже выставляют template_scope='package' и пишут audit.
 *  • Загрузка DOCX живёт во вкладке «Шаблоны документов» — здесь только
 *    список привязанных шаблонов и точечные действия.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileStack, ClipboardList, FileText, Users, ShieldCheck, Boxes, Sparkles } from "lucide-react";
import { useRbac } from "@/hooks/useRbac";
import { DocumentPackageIdeologyView } from "@/components/ai-documents/DocumentPackageIdeologyView";
import { DocumentPackageQuestionnairesView } from "./DocumentPackageQuestionnairesView";
import { PackageRolesManager } from "./PackageRolesManager";
import { TemplateBindingControl } from "./TemplateBindingControl";
import { PackageTemplateValidationPanel } from "./PackageTemplateValidationPanel";
import { PackageContentsList } from "./PackageContentsList";
import { PackageGenerationPanel } from "./PackageGenerationPanel";

interface PackageOption {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

/**
 * SOT пакетов — `document_package_templates`. Сейчас активен только «Идеология»;
 * остальные карточки в селекторе показываются как заглушки «появится позже»,
 * но не блокируют UI.
 */
export function PackagesWorkspace() {
  const rbac = useRbac();
  const isAdmin = rbac.isAdmin || rbac.isSuperAdmin;

  const packagesQuery = useQuery({
    queryKey: ["workspace-package-templates"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("document_package_templates")
        .select("id, code, name, is_active")
        .order("name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as PackageOption[];
    },
  });

  const packages = packagesQuery.data ?? [];
  const ideology = useMemo(
    () => packages.find((p) => p.code === "ideology") ?? packages[0] ?? null,
    [packages],
  );

  const [selectedId, setSelectedId] = useState<string | null>(null);
  useEffect(() => {
    if (!selectedId && ideology) setSelectedId(ideology.id);
  }, [selectedId, ideology]);

  const selectedPackage = packages.find((p) => p.id === selectedId) ?? null;
  const [tab, setTab] = useState<string>("anketa");

  return (
    <div className="space-y-3">
      {/* Заголовок */}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-md bg-emerald-50 flex items-center justify-center shrink-0">
          <FileStack className="h-5 w-5 text-emerald-500" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold">Пакеты документов</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Все настройки пакета — внутри самого пакета. Загрузка шаблонов
            и привязка к пакету выполняются во вкладке «Шаблоны документов».
          </p>
        </div>
      </div>

      {/* Селектор пакетов */}
      <GlassCard className="p-3">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-xs text-muted-foreground mr-1">Пакет:</span>
          {packages.length === 0 ? (
            <span className="text-xs text-muted-foreground">Загрузка…</span>
          ) : (
            packages.map((p) => {
              const active = p.id === selectedId;
              const disabled = !p.is_active;
              return (
                <Button
                  key={p.id}
                  size="sm"
                  variant={active ? "default" : "outline"}
                  disabled={disabled}
                  onClick={() => setSelectedId(p.id)}
                  className="h-8"
                >
                  {p.name}
                  {disabled && (
                    <Badge variant="secondary" className="ml-2 text-[10px] h-4 px-1.5">
                      появится позже
                    </Badge>
                  )}
                </Button>
              );
            })
          )}
        </div>
      </GlassCard>

      {/* Подвкладки пакета */}
      {selectedPackage ? (
        <Tabs value={tab} onValueChange={setTab} className="space-y-3">
          <TabsList className="flex-wrap h-auto">
            <TabsTrigger value="contents">
              <Boxes className="h-3.5 w-3.5 mr-1.5" /> Состав
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="templates">
                <FileText className="h-3.5 w-3.5 mr-1.5" /> Шаблоны пакета
              </TabsTrigger>
            )}
            <TabsTrigger value="anketa">
              <ClipboardList className="h-3.5 w-3.5 mr-1.5" /> Анкеты документов
            </TabsTrigger>
            {isAdmin && (
              <TabsTrigger value="roles">
                <Users className="h-3.5 w-3.5 mr-1.5" /> Роли пакета
              </TabsTrigger>
            )}
            {isAdmin && (
              <TabsTrigger value="validation">
                <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Проверка шаблонов
              </TabsTrigger>
            )}
            <TabsTrigger value="generation">
              <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Генерация
            </TabsTrigger>
          </TabsList>

          <TabsContent value="contents">
            <PackageContentsList
              packageTemplateId={selectedPackage.id}
              packageName={selectedPackage.name}
            />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="templates">
              <TemplateBindingControl packageTemplateId={selectedPackage.id} />
            </TabsContent>
          )}

          <TabsContent value="anketa">
            {/* Sprint 3G: document-level questionnaires — каждый шаблон
                имеет собственный набор ролей и физлиц. */}
            <DocumentPackageQuestionnairesView
              packageTemplateId={selectedPackage.id}
              packageName={selectedPackage.name}
            />
          </TabsContent>

          {isAdmin && (
            <TabsContent value="roles">
              <PackageRolesManager packageTemplateId={selectedPackage.id} />
            </TabsContent>
          )}

          {isAdmin && (
            <TabsContent value="validation">
              <PackageTemplateValidationPanel packageTemplateId={selectedPackage.id} />
            </TabsContent>
          )}
        </Tabs>
      ) : (
        <GlassCard className="p-6 text-center text-sm text-muted-foreground">
          Нет доступных пакетов. Обратитесь к администратору.
        </GlassCard>
      )}
    </div>
  );
}
