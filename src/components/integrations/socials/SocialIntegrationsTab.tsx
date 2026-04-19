import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Instagram, Facebook, Copy, Check, ExternalLink, FlaskConical, ChevronDown, ChevronUp, Loader2, MessageCircle, Plus } from "lucide-react";
import { useIntegrations, PROVIDERS, IntegrationInstance } from "@/hooks/useIntegrations";
import { IntegrationInstanceList } from "@/components/integrations/IntegrationInstanceList";
import { AddIntegrationDialog } from "@/components/integrations/AddIntegrationDialog";
import { EditIntegrationDialog } from "@/components/integrations/EditIntegrationDialog";
import { IntegrationLogsSheet } from "@/components/integrations/IntegrationLogsSheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient, useQuery } from "@tanstack/react-query";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

function useWebhookEvents(instanceId: string | null) {
  return useQuery({
    queryKey: ["webhook-events", instanceId],
    queryFn: async () => {
      if (!instanceId) return [];
      const { data, error } = await supabase
        .from("integration_logs")
        .select("*")
        .eq("instance_id", instanceId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (error) throw error;
      return data as Array<{
        id: string;
        created_at: string;
        event_type: string;
        result: string;
        error_message: string | null;
        payload_meta: Record<string, any>;
      }>;
    },
    enabled: !!instanceId,
    refetchInterval: 15000, // auto-refresh every 15s
  });
}

export function SocialIntegrationsTab() {
  const { data: instances, isLoading } = useIntegrations("socials");
  const queryClient = useQueryClient();
  // addDialogProvider:
  //   - "apix_instagram_dm" / "manychat" → preselect конкретного провайдера
  //   - null + addDialogOpen → общий выбор провайдера
  //   - null + !addDialogOpen → диалог закрыт
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addDialogProvider, setAddDialogProvider] = useState<string | null>(null);
  const [editInstance, setEditInstance] = useState<IntegrationInstance | null>(null);
  const [logsInstance, setLogsInstance] = useState<IntegrationInstance | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [testingWebhook, setTestingWebhook] = useState(false);
  const [showEvents, setShowEvents] = useState(false);

  const instagramInstances = (instances || []).filter((i) => i.provider === "apix_instagram_dm");
  const manychatInstances = (instances || []).filter((i) => i.provider === "manychat");
  const currentInstance = instagramInstances[0] || null;

  const openAddDialog = (providerId: string | null) => {
    setAddDialogProvider(providerId);
    setAddDialogOpen(true);
  };

  const { data: webhookEvents, isLoading: eventsLoading } = useWebhookEvents(
    showEvents ? currentInstance?.id ?? null : null
  );

  const webhookUrl = instagramInstances.length > 0
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/instagram-webhook?integration_instance_id=${instagramInstances[0].id}`
    : null;

  const handleHealthCheck = async (instance: IntegrationInstance) => {
    toast.info("Проверяю подключение...");
    try {
      const { data, error } = await supabase.functions.invoke("integration-healthcheck", {
        body: {
          provider: instance.provider,
          instance_id: instance.id,
          config: instance.config,
        },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success("Подключение работает");
      } else {
        toast.error(data?.error || "Ошибка проверки");
      }
      queryClient.invalidateQueries({ queryKey: ["integration-instances"] });
    } catch (e) {
      toast.error(normalizeEdgeFunctionError(e));
    }
  };

  const handleTestWebhook = async () => {
    if (!currentInstance) return;
    setTestingWebhook(true);
    try {
      const { data, error } = await supabase.functions.invoke("instagram-webhook-test", {
        body: { instance_id: currentInstance.id },
      });
      if (error) throw error;
      if (data?.success) {
        toast.success(`Webhook OK (HTTP ${data.status_code})`);
      } else {
        toast.error(`Webhook ошибка: HTTP ${data.status_code}`);
      }
      queryClient.invalidateQueries({ queryKey: ["webhook-events", currentInstance.id] });
    } catch (e) {
      toast.error(normalizeEdgeFunctionError(e));
    } finally {
      setTestingWebhook(false);
    }
  };

  const handleCopyWebhook = () => {
    if (webhookUrl) {
      navigator.clipboard.writeText(webhookUrl);
      setCopiedWebhook(true);
      toast.success("Webhook URL скопирован");
      setTimeout(() => setCopiedWebhook(false), 2000);
    }
  };

  // Compute last request & last success from events
  const lastRequest = webhookEvents?.[0];
  const lastSuccess = webhookEvents?.find((e) => e.result === "success");

  return (
    <div className="space-y-6">
      {/* Instagram DM Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-gradient-to-br from-pink-500/20 to-purple-500/20">
                <Instagram className="h-5 w-5 text-pink-600" />
              </div>
              <div>
                <CardTitle className="text-lg">Instagram Direct Messages</CardTitle>
                <CardDescription>Двусторонний обмен сообщениями через ApiX-Drive</CardDescription>
              </div>
            </div>
            {instagramInstances.length === 0 && (
              <Button onClick={() => setAddDialogOpen(true)}>
                Подключить
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {isLoading ? (
            <Skeleton className="h-12 w-full" />
          ) : instagramInstances.length > 0 ? (
            <>
              <IntegrationInstanceList
                instances={instagramInstances}
                onEdit={setEditInstance}
                onViewLogs={setLogsInstance}
                onHealthCheck={handleHealthCheck}
              />

              {/* Webhook URL + Test button */}
              {webhookUrl && (
                <div className="p-3 rounded-lg bg-muted/50 border border-border/30 space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">
                    Webhook URL для ApiX-Drive:
                  </p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 text-xs p-2 rounded bg-background border border-border overflow-x-auto">
                      {webhookUrl}
                    </code>
                    <Button variant="outline" size="icon" className="shrink-0 h-8 w-8" onClick={handleCopyWebhook}>
                      {copiedWebhook ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                    </Button>
                  </div>
                  <div className="flex items-center gap-2 mt-3">
                    <Button
                      variant="default"
                      size="default"
                      onClick={handleTestWebhook}
                      disabled={testingWebhook}
                    >
                      {testingWebhook ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <FlaskConical className="h-4 w-4 mr-2" />
                      )}
                      Проверить webhook
                    </Button>
                    <Button
                      variant="outline"
                      size="default"
                      onClick={() => setShowEvents(!showEvents)}
                    >
                      {showEvents ? (
                        <ChevronUp className="h-4 w-4 mr-2" />
                      ) : (
                        <ChevronDown className="h-4 w-4 mr-2" />
                      )}
                      Webhook события
                    </Button>
                  </div>
                  <p className="text-[10px] text-muted-foreground">
                    Вставьте в настройку «Приём данных → Webhooks» в ApiX-Drive.
                    В теле запроса обязательно передавайте: <code>integration_instance_id</code>, <code>external_message_id</code>, <code>sender_id</code>, <code>message_text</code>.
                  </p>
                </div>
              )}

              {/* PATCH-6: Last request / Last success indicators */}
              {showEvents && webhookEvents && (
                <div className="flex gap-4 text-xs text-muted-foreground">
                  <div>
                    <span className="font-medium">Последний запрос:</span>{" "}
                    {lastRequest
                      ? format(new Date(lastRequest.created_at), "dd MMM HH:mm:ss", { locale: ru })
                      : "—"}
                  </div>
                  <div>
                    <span className="font-medium">Последний успех:</span>{" "}
                    {lastSuccess
                      ? format(new Date(lastSuccess.created_at), "dd MMM HH:mm:ss", { locale: ru })
                      : "—"}
                  </div>
                </div>
              )}

              {/* PATCH-3: Recent webhook events */}
              {showEvents && (
                <div className="space-y-2">
                  <h4 className="text-sm font-medium">Последние 20 webhook событий</h4>
                  {eventsLoading ? (
                    <Skeleton className="h-24 w-full" />
                  ) : webhookEvents && webhookEvents.length > 0 ? (
                    <div className="max-h-80 overflow-y-auto space-y-1.5">
                      {webhookEvents.map((ev) => {
                        const meta = ev.payload_meta || {};
                        const isInstagram = meta.provider === "apix_instagram_dm" || meta.channel === "instagram";
                        if (!isInstagram && ev.event_type !== "healthcheck" && ev.event_type !== "webhook_test") return null;
                        return (
                          <div
                            key={ev.id}
                            className="p-2 border rounded text-xs space-y-1"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant={ev.result === "success" ? "default" : "destructive"}
                                  className={ev.result === "success" ? "bg-green-500/10 text-green-600 border-green-500/20" : ""}
                                >
                                  {ev.result === "success" ? "OK" : "ERR"}
                                </Badge>
                                <span className="text-muted-foreground">{ev.event_type}</span>
                                {meta.source && (
                                  <Badge variant="secondary" className="text-[9px]">
                                    {meta.source}
                                  </Badge>
                                )}
                              </div>
                              <span className="text-muted-foreground">
                                {format(new Date(ev.created_at), "dd.MM HH:mm:ss", { locale: ru })}
                              </span>
                            </div>
                            {meta.reason && (
                              <div className="text-muted-foreground">
                                <span className="font-medium">Причина:</span> {meta.reason}
                                {meta.status_code && <span className="ml-1">(HTTP {meta.status_code})</span>}
                              </div>
                            )}
                            {ev.error_message && (
                              <div className="text-destructive bg-destructive/10 p-1 rounded">
                                {ev.error_message}
                              </div>
                            )}
                            {(meta.external_message_id || meta.sender_id) && (
                              <div className="text-muted-foreground">
                                {meta.sender_id && <span>sender: {meta.sender_id} </span>}
                                {meta.external_message_id && <span>msg: {meta.external_message_id}</span>}
                              </div>
                            )}
                            {meta.body_keys && (
                              <div className="text-muted-foreground">
                                keys: [{(meta.body_keys as string[]).join(", ")}]
                                {meta.has_auth_header !== undefined && (
                                  <span className="ml-1">auth: {meta.has_auth_header ? "✓" : "✗"} ({meta.auth_scheme})</span>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground py-2">
                      Нет событий. После подключения ApiX-Drive здесь появятся записи о входящих запросах.
                    </p>
                  )}
                </div>
              )}
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Подключите Instagram через ApiX-Drive для приёма и отправки Direct Messages.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Facebook Placeholder */}
      <Card className="opacity-60">
        <CardHeader>
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-blue-500/20">
              <Facebook className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                Facebook Messenger
                <Badge variant="secondary" className="text-[10px]">Скоро</Badge>
              </CardTitle>
              <CardDescription>Интеграция с Facebook Messenger</CardDescription>
            </div>
          </div>
        </CardHeader>
      </Card>

      {/* Dialogs */}
      <AddIntegrationDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        category="socials"
        preselectedProvider="apix_instagram_dm"
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
