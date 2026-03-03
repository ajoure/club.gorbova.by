import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Instagram, Facebook, Copy, Check, ExternalLink } from "lucide-react";
import { useIntegrations, PROVIDERS, IntegrationInstance } from "@/hooks/useIntegrations";
import { IntegrationInstanceList } from "@/components/integrations/IntegrationInstanceList";
import { AddIntegrationDialog } from "@/components/integrations/AddIntegrationDialog";
import { EditIntegrationDialog } from "@/components/integrations/EditIntegrationDialog";
import { IntegrationLogsSheet } from "@/components/integrations/IntegrationLogsSheet";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";

export function SocialIntegrationsTab() {
  const { data: instances, isLoading } = useIntegrations("socials");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [editInstance, setEditInstance] = useState<IntegrationInstance | null>(null);
  const [logsInstance, setLogsInstance] = useState<IntegrationInstance | null>(null);
  const [copiedWebhook, setCopiedWebhook] = useState(false);

  const instagramInstances = (instances || []).filter((i) => i.provider === "apix_instagram_dm");
  const webhookUrl = instagramInstances.length > 0
    ? `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/instagram-webhook`
    : null;

  const handleCopyWebhook = () => {
    if (webhookUrl) {
      navigator.clipboard.writeText(webhookUrl);
      setCopiedWebhook(true);
      toast.success("Webhook URL скопирован");
      setTimeout(() => setCopiedWebhook(false), 2000);
    }
  };

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
                onHealthCheck={() => {}}
              />
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
                  <p className="text-[10px] text-muted-foreground">
                    Вставьте в настройку «Приём данных → Webhooks» в ApiX-Drive.
                    В теле запроса обязательно передавайте: <code>integration_instance_id</code>, <code>external_message_id</code>, <code>sender_id</code>, <code>message_text</code>.
                  </p>
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
