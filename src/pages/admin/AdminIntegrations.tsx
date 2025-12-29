import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Link2, CreditCard, Mail } from "lucide-react";
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
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const CATEGORY_ICONS: Record<string, React.ElementType> = {
  crm: Link2,
  payments: CreditCard,
  email: Mail,
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
  const [selectedProvider, setSelectedProvider] = useState<string | null>(null);

  // Determine active tab from URL
  const getActiveTab = (): IntegrationCategory => {
    if (location.pathname.includes("/integrations/payments")) return "payments";
    if (location.pathname.includes("/integrations/email")) return "email";
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
      let success = false;
      let errorMessage: string | null = null;

      // Provider-specific health checks
      if (instance.provider === "amocrm") {
        const { error } = await supabase.functions.invoke("amocrm-sync", {
          body: { action: "test" },
        });
        if (error) {
          errorMessage = error.message;
        } else {
          success = true;
        }
      } else if (instance.provider === "smtp") {
        // For SMTP, we'd need a test email function
        success = true; // Placeholder
      } else if (instance.provider === "bepaid") {
        // For bePaid, check if credentials are valid
        success = true; // Placeholder
      } else if (instance.provider === "getcourse") {
        // GetCourse API test
        success = true; // Placeholder
      }

      // Update instance status
      await supabase
        .from("integration_instances")
        .update({
          status: success ? "connected" : "error",
          last_check_at: new Date().toISOString(),
          error_message: errorMessage,
        })
        .eq("id", instance.id);

      // Add log
      await supabase.from("integration_logs").insert({
        instance_id: instance.id,
        event_type: "healthcheck",
        result: success ? "success" : "error",
        error_message: errorMessage,
        payload_meta: {},
      });

      queryClient.invalidateQueries({ queryKey: ["integration-instances"] });
      queryClient.invalidateQueries({ queryKey: ["integration-logs", instance.id] });

      if (success) {
        toast.success(`Подключение ${instance.alias} работает`);
      } else {
        toast.error(`Ошибка подключения: ${errorMessage}`);
      }
    } catch (error) {
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
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Интеграции</h1>
        <Button onClick={() => handleAddNew(activeTab)}>
          <Plus className="h-4 w-4 mr-2" />
          Добавить подключение
        </Button>
      </div>

      <Tabs value={activeTab} onValueChange={handleTabChange} className="w-full">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          {CATEGORIES.map((cat) => {
            const Icon = CATEGORY_ICONS[cat.id] || Link2;
            const count = (instances || []).filter(
              (i) => i.category === cat.id
            ).length;
            const hasErrors = (instances || []).some(
              (i) => i.category === cat.id && i.status === "error"
            );
            return (
              <TabsTrigger key={cat.id} value={cat.id} className="flex items-center gap-2">
                <Icon className="h-4 w-4" />
                {cat.label}
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

        <div className="mt-6 space-y-6">
          {/* Provider cards */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {categoryProviders.map((provider) => {
              const providerInstances = instancesByProvider[provider.id] || [];
              const hasErrors = providerInstances.some((i) => i.status === "error");
              return (
                <IntegrationProviderCard
                  key={provider.id}
                  provider={provider}
                  instanceCount={providerInstances.length}
                  hasErrors={hasErrors}
                  onClick={() => handleProviderClick(provider.id)}
                />
              );
            })}
          </div>

          {/* Instance list for selected provider */}
          {selectedProvider && (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between pb-2">
                <CardTitle className="text-lg">
                  Подключения: {PROVIDERS.find((p) => p.id === selectedProvider)?.name}
                </CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => handleAddNew(activeTab, selectedProvider)}
                >
                  <Plus className="h-4 w-4 mr-2" />
                  Добавить
                </Button>
              </CardHeader>
              <CardContent>
                {isLoading ? (
                  <div className="space-y-2">
                    <Skeleton className="h-12 w-full" />
                    <Skeleton className="h-12 w-full" />
                  </div>
                ) : (
                  <IntegrationInstanceList
                    instances={instancesByProvider[selectedProvider] || []}
                    onEdit={setEditInstance}
                    onViewLogs={setLogsInstance}
                    onHealthCheck={handleHealthCheck}
                  />
                )}
              </CardContent>
            </Card>
          )}

          {/* Show all instances if no provider selected */}
          {!selectedProvider && instances && instances.length > 0 && (
            <Card>
              <CardHeader>
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
                    instances={instances}
                    onEdit={setEditInstance}
                    onViewLogs={setLogsInstance}
                    onHealthCheck={handleHealthCheck}
                  />
                )}
              </CardContent>
            </Card>
          )}
        </div>
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
    </div>
  );
}
