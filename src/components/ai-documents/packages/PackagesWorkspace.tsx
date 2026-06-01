/**
 * PackagesWorkspace — Sprint 3R.
 *
 * Единая рабочая область вкладки «Пакеты документов».
 *  • Селектор пакетов сверху (Идеология + grey placeholders).
 *  • Подвкладки зависят от режима:
 *      mode="user"  → Анкеты документов + Генерация
 *      mode="admin" → Шаблоны / Анкеты / Роли / Проверка / Генерация
 *  • Вкладка «Состав» удалена — дублировала «Шаблоны пакета».
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { GlassCard } from "@/components/ui/GlassCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { FileStack, ClipboardList, FileText, Users, ShieldCheck, Sparkles } from "lucide-react";
import { useRbac } from "@/hooks/useRbac";
import { HelpTooltip } from "@/components/help/HelpComponents";
import { DocumentPackageQuestionnairesView } from "./DocumentPackageQuestionnairesView";
import { PackageRolesManager } from "./PackageRolesManager";
import { TemplateBindingControl } from "./TemplateBindingControl";
import { PackageTemplateValidationPanel } from "./PackageTemplateValidationPanel";
import { PackageGenerationPanel } from "./PackageGenerationPanel";

interface PackageOption {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

interface PackagesWorkspaceProps {
  /** "user" — урезанный набор вкладок; "admin" — полный (по умолчанию). */
  mode?: "user" | "admin";
}

export function PackagesWorkspace({ mode = "admin" }: PackagesWorkspaceProps) {
  const rbac = useRbac();
  const isAdminUI = mode === "admin" && (rbac.isAdmin || rbac.isSuperAdmin);

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

  const subtitle = isAdminUI
    ? "Настройте шаблоны пакета, роли, анкеты документов и запустите генерацию."
    : "Заполните анкеты документов и сформируйте готовый пакет.";

  return (
    <div className="space-y-3">
      {/* Заголовок */}
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-md bg-emerald-50 flex items-center justify-center shrink-0">
          <FileStack className="h-5 w-5 text-emerald-500" />
        </div>
        <div className="flex-1 min-w-0">
          <h2 className="text-lg font-semibold">Пакеты документов</h2>
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
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
                <HelpTooltip
                  key={p.id}
                  helpKey=""
                  customShort="Открыть пакет документов. Внутри — анкеты и кнопка формирования."
                  alwaysShow
                >
                  <Button
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
                </HelpTooltip>
              );
            })
          )}
        </div>
      </GlassCard>

      {/* Подвкладки пакета */}
      {selectedPackage ? (
        <Tabs value={tab} onValueChange={setTab} className="space-y-3">
          <TabsList className="flex-wrap h-auto">
            {isAdminUI && (
              <HelpTooltip helpKey="" customShort="Какие шаблоны входят в этот пакет. Здесь же привязка новых." alwaysShow>
                <TabsTrigger value="templates">
                  <FileText className="h-3.5 w-3.5 mr-1.5" /> Шаблоны пакета
                </TabsTrigger>
              </HelpTooltip>
            )}
            <HelpTooltip helpKey="" customShort="Какие данные нужно заполнить для каждого документа пакета." alwaysShow>
              <TabsTrigger value="anketa">
                <ClipboardList className="h-3.5 w-3.5 mr-1.5" /> Анкеты документов
              </TabsTrigger>
            </HelpTooltip>
            {isAdminUI && (
              <HelpTooltip helpKey="" customShort="Список ролей, которые встречаются в шаблонах пакета." alwaysShow>
                <TabsTrigger value="roles">
                  <Users className="h-3.5 w-3.5 mr-1.5" /> Роли пакета
                </TabsTrigger>
              </HelpTooltip>
            )}
            {isAdminUI && (
              <HelpTooltip helpKey="" customShort="Безопасная проверка: ищет плейсхолдеры и нехватку данных. Документы не создаёт." alwaysShow>
                <TabsTrigger value="validation">
                  <ShieldCheck className="h-3.5 w-3.5 mr-1.5" /> Проверка шаблонов
                </TabsTrigger>
              </HelpTooltip>
            )}
            <HelpTooltip helpKey="" customShort="Запуск формирования документов пакета по выбранным данным." alwaysShow>
              <TabsTrigger value="generation">
                <Sparkles className="h-3.5 w-3.5 mr-1.5" /> Генерация
              </TabsTrigger>
            </HelpTooltip>
          </TabsList>

          {isAdminUI && (
            <TabsContent value="templates">
              <TemplateBindingControl packageTemplateId={selectedPackage.id} />
            </TabsContent>
          )}

          <TabsContent value="anketa">
            <DocumentPackageQuestionnairesView
              packageTemplateId={selectedPackage.id}
              packageName={selectedPackage.name}
            />
          </TabsContent>

          {isAdminUI && (
            <TabsContent value="roles">
              <PackageRolesManager packageTemplateId={selectedPackage.id} />
            </TabsContent>
          )}

          {isAdminUI && (
            <TabsContent value="validation">
              <PackageTemplateValidationPanel packageTemplateId={selectedPackage.id} />
            </TabsContent>
          )}

          <TabsContent value="generation">
            <PackageGenerationPanel
              packageCode={selectedPackage.code}
              packageName={selectedPackage.name}
            />
          </TabsContent>
        </Tabs>
      ) : (
        <GlassCard className="p-6 text-center text-sm text-muted-foreground">
          Нет доступных пакетов. Обратитесь к администратору.
        </GlassCard>
      )}
    </div>
  );
}
