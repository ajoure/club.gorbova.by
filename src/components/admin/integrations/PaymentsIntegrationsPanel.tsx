// UI-only PATCH (Phase 2): unified entry for payment provider connections.
// Shows the existing bePaid list (integration_instances, untouched) AND any
// Stripe connections from acquiring_connections. Stripe cards appear ONLY if
// rows exist in acquiring_connections (no stub). Multiple Stripe connections
// supported. Add/edit/test/disable Stripe is handled here without leaving
// /admin/integrations/payments.
//
// FREEZE: bePaid pipeline, integration_instances, payment_links, all bepaid-*
// edge functions, create-payment-checkout.ts, stripe-* edge functions, Vault
// shared layer — none of those are touched by this patch.

import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  AlertCircle,
  Loader2,
  PowerOff,
  Settings,
  ShieldCheck,
  Plug,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";
import { IntegrationInstanceList } from "@/components/integrations/IntegrationInstanceList";
import type { IntegrationInstance } from "@/hooks/useIntegrations";
import {
  StripeConnectionDialog,
  type AcquiringConnectionRow,
} from "./StripeConnectionDialog";
import { StripeEventsTab } from "./StripeEventsTab";

interface Props {
  bepaidInstances: IntegrationInstance[];
  isLoading: boolean;
  canEdit: boolean;
  onEditBepaid?: (i: IntegrationInstance) => void;
  onViewLogs?: (i: IntegrationInstance) => void;
  onHealthCheckBepaid?: (i: IntegrationInstance) => void;
  onSyncSettings?: (i: IntegrationInstance) => void;
  /** Externally-controlled signal to open the Stripe dialog (e.g. from
   * "Добавить подключение → Stripe" in AddIntegrationDialog). */
  stripeDialogOpen: boolean;
  onStripeDialogOpenChange: (open: boolean) => void;
}

function statusBadge(status: AcquiringConnectionRow["status"]) {
  switch (status) {
    case "active":
      return (
        <Badge variant="default" className="gap-1 bg-emerald-500/15 text-emerald-600 hover:bg-emerald-500/15">
          <ShieldCheck className="h-3 w-3" /> Активен
        </Badge>
      );
    case "pending":
      return (
        <Badge variant="outline" className="gap-1 text-muted-foreground">
          <Plug className="h-3 w-3" /> Не настроен
        </Badge>
      );
    case "disabled":
      return (
        <Badge variant="secondary" className="gap-1">
          <PowerOff className="h-3 w-3" /> Отключён
        </Badge>
      );
    case "invalid":
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertCircle className="h-3 w-3" /> Ошибка
        </Badge>
      );
  }
}

export function PaymentsIntegrationsPanel({
  bepaidInstances,
  isLoading,
  canEdit,
  onEditBepaid,
  onViewLogs,
  onHealthCheckBepaid,
  onSyncSettings,
  stripeDialogOpen,
  onStripeDialogOpenChange,
}: Props) {
  const [stripeConnections, setStripeConnections] = useState<AcquiringConnectionRow[]>([]);
  const [stripeLoading, setStripeLoading] = useState(true);
  const [editing, setEditing] = useState<AcquiringConnectionRow | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [disablingId, setDisablingId] = useState<string | null>(null);

  const loadStripe = useCallback(async () => {
    setStripeLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("acquiring-list-connections", {
        body: {},
      });
      if (error) throw error;
      const rows = ((data?.connections as AcquiringConnectionRow[]) ?? []).filter(
        (c) => c.provider === "stripe",
      );
      setStripeConnections(rows);
    } catch (e) {
      toast.error(normalizeEdgeFunctionError(e, "Не удалось загрузить Stripe-подключения"));
    } finally {
      setStripeLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStripe();
  }, [loadStripe]);

  const existingStripeCodes = useMemo(
    () => stripeConnections.map((c) => c.account_code),
    [stripeConnections],
  );

  const handleTest = async (id: string) => {
    setTestingId(id);
    try {
      const { data, error } = await supabase.functions.invoke("acquiring-test-connection", {
        body: { connection_id: id },
      });
      if (error) throw error;
      if (data?.ok) toast.success("Stripe доступен");
      else toast.error(`Проверка не пройдена: ${data?.code ?? "unknown"}`);
      await loadStripe();
    } catch (e) {
      toast.error(normalizeEdgeFunctionError(e));
    } finally {
      setTestingId(null);
    }
  };

  const handleDisable = async (id: string) => {
    setDisablingId(id);
    try {
      const { data, error } = await supabase.functions.invoke("acquiring-disable-connection", {
        body: { connection_id: id },
      });
      if (error) throw error;
      if (data?.ok) toast.success("Подключение отключено");
      await loadStripe();
    } catch (e) {
      toast.error(normalizeEdgeFunctionError(e));
    } finally {
      setDisablingId(null);
    }
  };

  const webhookUrl = `${
    import.meta.env.VITE_SUPABASE_URL ?? "https://<project-ref>.functions.supabase.co"
  }/functions/v1/stripe-webhook`;

  return (
    <Tabs defaultValue="connections" className="space-y-4">
      <TabsList>
        <TabsTrigger value="connections">Подключения</TabsTrigger>
        <TabsTrigger value="stripe-events">Stripe events</TabsTrigger>
      </TabsList>

      <TabsContent value="connections" className="space-y-6">
        {/* bePaid — existing flow, untouched */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">bePaid</CardTitle>
          </CardHeader>
          <CardContent>
            {isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : bepaidInstances.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Нет подключений bePaid. Нажмите «Добавить подключение» → bePaid.
              </p>
            ) : (
              <IntegrationInstanceList
                instances={bepaidInstances}
                onEdit={onEditBepaid}
                onViewLogs={onViewLogs}
                onHealthCheck={onHealthCheckBepaid}
                onSyncSettings={onSyncSettings}
              />
            )}
          </CardContent>
        </Card>

        {/* Stripe — appears only if rows exist in acquiring_connections */}
        {stripeLoading ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Stripe</CardTitle>
            </CardHeader>
            <CardContent>
              <Skeleton className="h-20 w-full" />
            </CardContent>
          </Card>
        ) : stripeConnections.length > 0 ? (
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-lg">Stripe</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {stripeConnections.map((acc) => (
                  <div
                    key={acc.id}
                    className="border rounded-lg p-3 space-y-2 bg-card"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="font-medium">{acc.account_name}</div>
                      {statusBadge(acc.status)}
                    </div>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
                      <dt className="text-muted-foreground">Account</dt>
                      <dd className="font-mono">{acc.account_code}</dd>
                      <dt className="text-muted-foreground">Режим</dt>
                      <dd>{acc.test_mode ? "test" : "live"}</dd>
                      <dt className="text-muted-foreground">По умолчанию</dt>
                      <dd>{acc.is_default ? "да" : "нет"}</dd>
                      <dt className="text-muted-foreground">Secret key</dt>
                      <dd>{acc.has_secret_key ? "сохранён" : "—"}</dd>
                      <dt className="text-muted-foreground">Webhook secret</dt>
                      <dd>{acc.has_webhook_secret ? "сохранён" : "—"}</dd>
                      {acc.last_error && (
                        <>
                          <dt className="text-muted-foreground">Ошибка</dt>
                          <dd className="text-destructive font-mono break-all">{acc.last_error}</dd>
                        </>
                      )}
                    </dl>
                    <div className="flex flex-wrap gap-1.5 pt-1">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!canEdit}
                        onClick={() => {
                          setEditing(acc);
                          onStripeDialogOpenChange(true);
                        }}
                      >
                        <Settings className="h-3.5 w-3.5 mr-1" />
                        Настройки
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!canEdit || testingId === acc.id}
                        onClick={() => handleTest(acc.id)}
                      >
                        {testingId === acc.id && (
                          <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
                        )}
                        Проверить
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive"
                            disabled={!canEdit || disablingId === acc.id}
                          >
                            Отключить
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Отключить Stripe?</AlertDialogTitle>
                            <AlertDialogDescription>
                              Секретные ключи будут удалены из защищённого хранилища.
                              Существующие платежи bePaid не затрагиваются.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Отмена</AlertDialogCancel>
                            <AlertDialogAction onClick={() => handleDisable(acc.id)}>
                              Отключить
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </div>
                ))}
              </div>
              <div className="mt-4 text-xs text-muted-foreground space-y-1">
                <p>
                  Webhook URL для Stripe Dashboard (test mode):
                </p>
                <code className="block bg-muted p-2 rounded text-foreground break-all">
                  {webhookUrl}
                </code>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </TabsContent>

      <TabsContent value="stripe-events">
        <StripeEventsTab />
      </TabsContent>

      <StripeConnectionDialog
        open={stripeDialogOpen}
        onOpenChange={(open) => {
          onStripeDialogOpenChange(open);
          if (!open) setEditing(null);
        }}
        connection={editing}
        existingStripeCodes={existingStripeCodes}
        onSaved={loadStripe}
      />
    </Tabs>
  );
}
