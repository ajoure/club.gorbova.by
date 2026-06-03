// UI-only PATCH (Phase 2): unified entry for payment provider connections.
// Shows the existing bePaid list (integration_instances, untouched) AND any
// Stripe connections from acquiring_connections, rendered in the same
// row-style layout as bePaid for visual parity.
//
// FREEZE: bePaid pipeline, integration_instances, payment_links, all bepaid-*
// edge functions, create-payment-checkout.ts, stripe-* edge functions, Vault
// shared layer — none of those are touched by this patch.

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  AlertCircle,
  CheckCircle,
  Clock,
  Copy,
  Link as LinkIcon,
  Loader2,
  MoreHorizontal,
  PowerOff,
  RefreshCw,
  Settings,
  XCircle,
} from "lucide-react";
import { format } from "date-fns";
import { ru } from "date-fns/locale";
import { cn } from "@/lib/utils";
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
  /** Externally-controlled signal to open the Stripe dialog. */
  stripeDialogOpen: boolean;
  onStripeDialogOpenChange: (open: boolean) => void;
}

function stripeStatusBadge(status: AcquiringConnectionRow["status"]) {
  switch (status) {
    case "active":
      return (
        <Badge variant="secondary" className="bg-green-100 text-green-700 border-green-200 gap-1">
          <CheckCircle className="h-3 w-3" />
          Подключено
        </Badge>
      );
    case "invalid":
      return (
        <Badge variant="destructive" className="gap-1">
          <XCircle className="h-3 w-3" />
          Ошибка
        </Badge>
      );
    case "disabled":
      return (
        <Badge variant="secondary" className="gap-1">
          <PowerOff className="h-3 w-3" />
          Отключено
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="gap-1">
          <Clock className="h-3 w-3" />
          Не настроено
        </Badge>
      );
  }
}

function modeBadge(testMode: boolean) {
  return testMode ? (
    <Badge variant="secondary" className="bg-amber-500/15 text-amber-700 hover:bg-amber-500/15">
      Тестовое подключение
    </Badge>
  ) : (
    <Badge variant="secondary" className="bg-emerald-500/15 text-emerald-700 hover:bg-emerald-500/15">
      Боевое подключение
    </Badge>
  );
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
  const [disableTarget, setDisableTarget] = useState<AcquiringConnectionRow | null>(null);
  const [expandedWebhookId, setExpandedWebhookId] = useState<string | null>(null);

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
      setDisableTarget(null);
    }
  };

  const projectId = (import.meta as any)?.env?.VITE_SUPABASE_PROJECT_ID ?? "";
  const stripeWebhookUrl = projectId
    ? `https://${projectId}.supabase.co/functions/v1/stripe-webhook`
    : "";

  const copyWebhook = async () => {
    if (!stripeWebhookUrl) return;
    try {
      await navigator.clipboard.writeText(stripeWebhookUrl);
      toast.success("URL для webhook скопирован");
    } catch {
      toast.error("Не удалось скопировать URL");
    }
  };

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

        {/* Stripe — same row-style layout as bePaid */}
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
              <div className="space-y-3">
                {stripeConnections.map((acc) => {
                  const isExpanded = expandedWebhookId === acc.id;
                  return (
                    <div
                      key={acc.id}
                      className={cn(
                        "rounded-xl p-4 transition-all duration-200",
                        "bg-card border hover:shadow-sm",
                        acc.status === "invalid"
                          ? "border-destructive/50"
                          : acc.status === "active"
                            ? "border-green-500/30"
                            : "border-border",
                      )}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              "h-10 w-10 rounded-lg flex items-center justify-center",
                              acc.status === "active"
                                ? "bg-green-100"
                                : acc.status === "invalid"
                                  ? "bg-destructive/10"
                                  : "bg-muted",
                            )}
                          >
                            <div
                              className={cn(
                                "h-3 w-3 rounded-full",
                                acc.status === "active"
                                  ? "bg-green-500"
                                  : acc.status === "invalid"
                                    ? "bg-destructive animate-pulse"
                                    : "bg-muted-foreground/30",
                              )}
                            />
                          </div>
                          <div>
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-medium text-foreground">{acc.account_name}</span>
                              {stripeStatusBadge(acc.status)}
                              {modeBadge(acc.test_mode)}
                              {acc.is_default && (
                                <Badge variant="outline" className="text-xs">
                                  По умолчанию
                                </Badge>
                              )}
                            </div>
                            {acc.last_error && (
                              <p className="text-xs text-destructive max-w-[400px] truncate">
                                {acc.last_error}
                              </p>
                            )}
                            <p className="text-xs text-muted-foreground">
                              {acc.last_verified_at
                                ? `Проверено ${format(new Date(acc.last_verified_at), "dd MMM, HH:mm", { locale: ru })}`
                                : "Ещё не проверялось"}
                              {!acc.test_mode && acc.status === "active" && (
                                <>
                                  {" · "}
                                  <span className="text-muted-foreground/80">
                                    Sandbox-checkout в Фазе 2 недоступен
                                  </span>
                                </>
                              )}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8"
                            onClick={() => setExpandedWebhookId(isExpanded ? null : acc.id)}
                            title="Показать Webhook URL"
                          >
                            <LinkIcon className="h-4 w-4" />
                          </Button>
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button variant="ghost" size="icon" className="h-8 w-8">
                                <MoreHorizontal className="h-4 w-4" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent
                              align="end"
                              className="w-48 bg-popover text-popover-foreground border shadow-md z-50"
                            >
                              <DropdownMenuItem
                                disabled={!canEdit || testingId === acc.id}
                                onClick={() => handleTest(acc.id)}
                                className="gap-2 cursor-pointer"
                              >
                                {testingId === acc.id ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-4 w-4" />
                                )}
                                <span>Проверить</span>
                              </DropdownMenuItem>
                              <DropdownMenuItem
                                disabled={!canEdit}
                                onClick={() => {
                                  setEditing(acc);
                                  onStripeDialogOpenChange(true);
                                }}
                                className="gap-2 cursor-pointer"
                              >
                                <Settings className="h-4 w-4" />
                                <span>Настройки</span>
                              </DropdownMenuItem>
                              <DropdownMenuSeparator />
                              <DropdownMenuItem
                                disabled={!canEdit || disablingId === acc.id}
                                onClick={() => setDisableTarget(acc)}
                                className="gap-2 cursor-pointer text-destructive focus:text-destructive"
                              >
                                <PowerOff className="h-4 w-4" />
                                <span>Отключить</span>
                              </DropdownMenuItem>
                            </DropdownMenuContent>
                          </DropdownMenu>
                        </div>
                      </div>

                      {isExpanded && stripeWebhookUrl && (
                        <div className="mt-4 pt-4 border-t border-border space-y-2">
                          <Label className="text-xs">URL для webhook в Stripe Dashboard</Label>
                          <div className="flex gap-2">
                            <code className="flex-1 bg-muted p-2 rounded text-xs text-foreground break-all">
                              {stripeWebhookUrl}
                            </code>
                            <Button type="button" variant="outline" size="sm" onClick={copyWebhook}>
                              <Copy className="h-3.5 w-3.5 mr-1" /> Копировать
                            </Button>
                          </div>
                          <p className="text-xs text-muted-foreground">
                            Вставьте этот URL в Stripe Dashboard → Developers → Webhooks.
                            Полученный <code>whsec_…</code> сохраните в настройках подключения.
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
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

      <AlertDialog open={!!disableTarget} onOpenChange={(open) => !open && setDisableTarget(null)}>
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
            <AlertDialogAction
              onClick={() => disableTarget && handleDisable(disableTarget.id)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Отключить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Tabs>
  );
}

// Local label helper to keep the per-row webhook reveal lightweight.
function Label({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("text-sm font-medium text-foreground", className)}>{children}</div>;
}


