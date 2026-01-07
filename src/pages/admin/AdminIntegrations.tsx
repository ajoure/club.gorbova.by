import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Link2, CreditCard, Mail, Send, Users, Download } from "lucide-react";
import {
  useIntegrations,
  PROVIDERS,
  CATEGORIES,
  IntegrationCategory,
  IntegrationInstance,
} from "@/hooks/useIntegrations";
import { IntegrationProviderCard } from "@/components/integrations/IntegrationProviderCard";
import { IntegrationInstanceList } from "@/components/integrations/IntegrationInstanceList";
import { AddIntegrationDialog } from "@/components/integrations/AddIntegrationDialog";
import { EditIntegrationDialog } from "@/components/integrations/EditIntegrationDialog";
import { IntegrationLogsSheet } from "@/components/integrations/IntegrationLogsSheet";
import { IntegrationSyncSettingsDialog } from "@/components/integrations/IntegrationSyncSettingsDialog";
import { SmartImportWizard } from "@/components/integrations/SmartImportWizard";
import { TelegramBotsTab } from "@/components/telegram/TelegramBotsTab";
import { TelegramClubsTab } from "@/components/telegram/TelegramClubsTab";
import { TelegramLogsTab } from "@/components/telegram/TelegramLogsTab";
import { MassBroadcastDialog } from "@/components/telegram/MassBroadcastDialog";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  crm: Link2,
  payments: CreditCard,
  email: Mail,
  telegram: Send,
};

export default function AdminIntegrations() {
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();

  // State
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialogCategory, setAddDialogCategory] = useState<IntegrationCategory | undefined>();
  const [addDialogProvider, setAddDialogProvider] = useState<string | undefined>();
  const [editInstance, setEditInstance] = useState<IntegrationInstance | null>(null);
  const [logsInstance, setLogsInstance] = useState<IntegrationInstance | null>(null);
  const [syncSettingsInstance, setSyncSettingsInstance] = useState<IntegrationInstance | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);
  const [massBroadcastOpen, setMassBroadcastOpen] = useState(false);
  const [getcourseImportOpen, setGetcourseImportOpen] = useState(false);

  // Determine active tab from URL
  const getActiveTab = (): IntegrationCategory => {
    if (location.pathname.includes("/integrations/payments")) return "payments";
    if (location.pathname.includes("/integrations/email")) return "email";
    if (location.pathname.includes("/integrations/telegram")) return "telegram";
    return "crm";
  };

  const activeTab = getActiveTab();

  // Fetch integrations
  const { data: instances, isLoading } = useIntegrations(activeTab);

  const handleTabChange = (value: string) => {
    setSelectedProvider(null);
    navigate(`/admin/integrations/${value}`);
  };

  const handleProviderClick = (providerId: string) => {
    setSelectedProvider(selectedProvider === providerId ? null : providerId);
  };

  const handleAddNew = (category?: IntegrationCategory, provider?: string) => {
    setAddDialogCategory(category);
    setAddDialogProvider(provider);
    setAddDialogOpen(true);
  };

  const handleHealthCheck = async (instance: IntegrationInstance) => {
    toast.info(`Проверка подключения ${instance.alias}...`);

    try {
      const { data, error } = await supabase.functions.invoke("integration-healthcheck", {
        body: {
          provider: instance.provider,
          instance_id: instance.id,
          config: instance.config,
        },
      });

      queryClient.invalidateQueries({ queryKey: ["integration-instances"] });
      queryClient.invalidateQueries({ queryKey: ["integration-logs", instance.id] });

      if (error) {
        toast.error(`Ошибка проверки: ${error.message}`);
        return;
      }

      if (data?.success) {
        toast.success(`Подключение ${instance.alias} работает`);
      } else {
        toast.error(`Ошибка подключения: ${data?.error || "Неизвестная ошибка"}`);
      }
    } catch (err) {
      toast.error("Ошибка при проверке");
    }
  };

  // Get providers for current category
  const categoryProviders = PROVIDERS.filter((p) => p.category === activeTab);

  // Group instances by provider
  const instancesByProvider = (instances || []).reduce(
    (acc, inst) => {
      if (!acc[inst.provider]) acc[inst.provider] = [];
      acc[inst.provider].push(inst);
      return acc;
    },
    {} as Record<string, IntegrationInstance[]>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h1 className="text-2xl font-bold">Интеграции</h1>
        <div className="flex gap-2">
          {activeTab === "crm" && (
            <Button variant="outline" onClick={() => setGetcourseImportOpen(true)}>
              <Download className="h-4 w-4 mr-2" />
              Импорт из GetCourse
            </Button>
          )}
          <Button onClick={() => handleAddNew(activeTab)}>
            <Plus className="h-4 w-4 mr-2" />
            Добавить подключение
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <div className="overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
          <TabsList className="inline-flex w-auto min-w-max sm:grid sm:grid-cols-4 sm:max-w-lg">
            {CATEGORIES.map((cat) => {
              const Icon = CATEGORY_ICONS[cat.id] || Link2;
              const count = cat.id === "telegram" ? 0 : (instances || []).filter(
                (i) => i.category === cat.id
              ).length;
              const hasErrors = cat.id === "telegram" ? false : (instances || []).some(
                (i) => i.category === cat.id && i.status === "error"
              );
              return (
                <TabsTrigger key={cat.id} value={cat.id} className="flex items-center gap-1.5 text-xs sm:text-sm whitespace-nowrap px-3">
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{cat.label}</span>
                  {count > 0 && (
                    <span
                      className={`text-xs px-1.5 py-0.5 rounded-full ${
                        hasErrors
                          ? "bg-destructive/10 text-destructive"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {count}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {activeTab === "telegram" ? (
          <div className="mt-6 space-y-6">
          <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
            <Tabs defaultValue="bots" className="w-full">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4">
                <TabsList className="w-full sm:w-auto">
                  <TabsTrigger value="bots">Боты</TabsTrigger>
                  <TabsTrigger value="clubs">Клубы</TabsTrigger>
                  <TabsTrigger value="logs">Логи</TabsTrigger>
                </TabsList>
                <Button size="sm" onClick={() => setMassBroadcastOpen(true)}>
                  <Users className="h-4 w-4 sm:mr-2" />
                  <span className="hidden sm:inline">Массовая рассылка</span>
                </Button>
              </div>
              <TabsContent value="bots" className="mt-4">
                <TelegramBotsTab />
                </TabsContent>
                <TabsContent value="clubs" className="mt-4">
                  <TelegramClubsTab />
                </TabsContent>
                <TabsContent value="logs" className="mt-4">
                  <TelegramLogsTab />
                </TabsContent>
              </Tabs>
            </div>
          </div>
        ) : (
        <div className="mt-6 space-y-6">
          {/* All instances */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between pb-2">
              <CardTitle className="text-lg">Все подключения</CardTitle>
            </CardHeader>
            <CardContent>
              {isLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12 w-full" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ) : (
                <IntegrationInstanceList
                  instances={instances || []}
                  onEdit={setEditInstance}
                  onViewLogs={setLogsInstance}
                  onHealthCheck={handleHealthCheck}
                  onSyncSettings={setSyncSettingsInstance}
                />
              )}
            </CardContent>
          </Card>
        </div>
        )}
      </Tabs>

      {/* Dialogs */}
      <AddIntegrationDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        category={addDialogCategory}
        preselectedProvider={addDialogProvider}
      />

      <EditIntegrationDialog
        instance={editInstance}
        open={!!editInstance}
        onOpenChange={(open) => !open && setEditInstance(null)}
      />

      <IntegrationLogsSheet
        instance={logsInstance}
        open={!!logsInstance}
        onOpenChange={(open) => !open && setLogsInstance(null)}
      />

      <IntegrationSyncSettingsDialog
        instance={syncSettingsInstance}
        open={!!syncSettingsInstance}
        onOpenChange={(open) => !open && setSyncSettingsInstance(null)}
      />

      <MassBroadcastDialog
        open={massBroadcastOpen}
        onOpenChange={setMassBroadcastOpen}
      />

      <SmartImportWizard
        open={getcourseImportOpen}
        onOpenChange={setGetcourseImportOpen}
      />
    </div>
  );
}
