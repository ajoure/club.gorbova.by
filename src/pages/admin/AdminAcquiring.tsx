// Phase 2 — Admin Integrations → Acquiring
// - Read connections from acquiring_connections (via acquiring-list-connections)
// - bePaid: read-only "Active" card (Phase 2 does not migrate bePaid storage)
// - Stripe: full self-service settings dialog + test-connection + disable + events tab

import { useEffect, useMemo, useState } from "react";
import { AdminLayout } from "@/components/layout/AdminLayout";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CreditCard, ShieldCheck, AlertCircle, Settings, Loader2, PowerOff, Plug } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { normalizeEdgeFunctionError } from "@/utils/normalizeEdgeFunctionError";
import {
  StripeConnectionDialog,
  type AcquiringConnectionRow,
} from "@/components/admin/integrations/StripeConnectionDialog";
import { StripeEventsTab } from "@/components/admin/integrations/StripeEventsTab";

const BEPAID_CARD: AcquiringConnectionRow = {
  id: "__bepaid_legacy__",
  provider: "bepaid",
  account_code: "bepaid_main",
  account_name: "bePaid (основной)",
  is_default: true,
  test_mode: false,
  status: "active",
  publishable_key: null,
  success_url: null,
  cancel_url: null,
  locale: null,
  has_secret_key: true,
  has_webhook_secret: true,
  last_error: null,
  last_verified_at: null,
};

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

export default function AdminAcquiring() {
  const [connections, setConnections] = useState<AcquiringConnectionRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<AcquiringConnectionRow | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [disablingId, setDisablingId] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke("acquiring-list-connections", {
        body: {},
      });
      if (error) throw error;
      setConnections((data?.connections as AcquiringConnectionRow[]) ?? []);
    } catch (e) {
      toast.error(normalizeEdgeFunctionError(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const stripeConn = useMemo(
    () => connections.find((c) => c.provider === "stripe" && c.account_code === "stripe_poland") ?? null,
    [connections],
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
      await load();
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
      await load();
    } catch (e) {
      toast.error(normalizeEdgeFunctionError(e));
    } finally {
      setDisablingId(null);
    }
  };

  const cards: AcquiringConnectionRow[] = [
    BEPAID_CARD,
    stripeConn ?? {
      ...BEPAID_CARD,
      id: "__stripe_pending__",
      provider: "stripe",
      account_code: "stripe_poland",
      account_name: "Stripe Poland",
      status: "pending",
      test_mode: true,
      is_default: false,
      has_secret_key: false,
      has_webhook_secret: false,
    },
  ];

  return (
    <AdminLayout>
      <div className="px-4 md:px-6 py-4 space-y-4">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <CreditCard className="h-6 w-6" />
            Интеграции — Эквайринг
          </h1>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Self-service подключение платёжных провайдеров. Секретные ключи хранятся в защищённом
            хранилище и не возвращаются в браузер.
          </p>
        </header>

        <Tabs defaultValue="connections">
          <TabsList>
            <TabsTrigger value="connections">Подключения</TabsTrigger>
            <TabsTrigger value="events">Stripe events</TabsTrigger>
          </TabsList>

          <TabsContent value="connections" className="space-y-4 pt-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {cards.map((acc) => {
                const isStripe = acc.provider === "stripe";
                const isStubStripe = acc.id === "__stripe_pending__";
                return (
                  <Card key={acc.account_code} className="flex flex-col">
                    <CardHeader className="space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <CardTitle className="text-lg">
                          {acc.provider === "stripe" ? "Stripe" : "bePaid"}
                        </CardTitle>
                        {statusBadge(acc.status)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Аккаунт: <code className="font-mono">{acc.account_code}</code>
                      </div>
                    </CardHeader>
                    <CardContent className="flex-1 space-y-3 text-sm">
                      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5">
                        <dt className="text-muted-foreground">Имя</dt>
                        <dd>{acc.account_name}</dd>
                        <dt className="text-muted-foreground">Режим</dt>
                        <dd>{acc.test_mode ? "test" : "live"}</dd>
                        <dt className="text-muted-foreground">По умолчанию</dt>
                        <dd>{acc.is_default ? "да" : "нет"}</dd>
                        {isStripe && (
                          <>
                            <dt className="text-muted-foreground">Secret key</dt>
                            <dd>{acc.has_secret_key ? "сохранён" : "—"}</dd>
                            <dt className="text-muted-foreground">Webhook secret</dt>
                            <dd>{acc.has_webhook_secret ? "сохранён" : "—"}</dd>
                            {acc.last_error && (
                              <>
                                <dt className="text-muted-foreground">Ошибка</dt>
                                <dd className="text-destructive text-xs font-mono">{acc.last_error}</dd>
                              </>
                            )}
                          </>
                        )}
                      </dl>

                      <div className="flex flex-wrap gap-2 pt-2">
                        {isStripe ? (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setEditing(isStubStripe ? null : acc);
                                setDialogOpen(true);
                              }}
                            >
                              <Settings className="h-4 w-4 mr-1" />
                              Настройки
                            </Button>
                            {!isStubStripe && (
                              <>
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => handleTest(acc.id)}
                                  disabled={testingId === acc.id}
                                >
                                  {testingId === acc.id && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
                                  Проверить подключение
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button size="sm" variant="ghost" className="text-destructive">
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
                                      <AlertDialogAction onClick={() => handleDisable(acc.id)} disabled={disablingId === acc.id}>
                                        Отключить
                                      </AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
                              </>
                            )}
                          </>
                        ) : (
                          <p className="text-xs text-muted-foreground">
                            bePaid настраивается в существующем разделе Интеграции → Платежи.
                            В Фазе 2 поведение bePaid не меняется.
                          </p>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            <Card className="border-dashed">
              <CardHeader>
                <CardTitle className="text-base">Фаза 2 — Stripe sandbox</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground space-y-1">
                <p>
                  Ключи хранятся в защищённом хранилище (Vault); secret_key и webhook signing secret
                  не возвращаются в браузер. Webhook URL для Stripe Dashboard:
                </p>
                <code className="block bg-muted p-2 rounded text-foreground text-xs break-all">
                  {`${import.meta.env.VITE_SUPABASE_URL ?? "https://<project-ref>.functions.supabase.co"}/functions/v1/stripe-webhook`}
                </code>
                <p className="pt-2">
                  События обработки видны во вкладке <strong>Stripe events</strong>.
                </p>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="events" className="pt-4">
            <StripeEventsTab />
          </TabsContent>
        </Tabs>
      </div>

      <StripeConnectionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        connection={editing}
        onSaved={load}
      />

      {loading && (
        <div className="fixed bottom-4 right-4 text-xs text-muted-foreground bg-background border rounded px-2 py-1 shadow">
          <Loader2 className="h-3 w-3 inline animate-spin mr-1" />
          Загрузка...
        </div>
      )}
    </AdminLayout>
  );
}
