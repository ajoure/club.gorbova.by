import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Shield,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  RefreshCw,
  Ban,
  CreditCard,
  Server,
  FileWarning,
  ClipboardList,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

interface BepaidSubscription {
  id: string;
  plan_title: string;
  status: string;
  amount: number;
  currency: string;
  customer_email?: string;
  created_at?: string;
}

interface AuditReport {
  external: {
    total_found: number;
    cancelled: number;
    subscriptions: BepaidSubscription[];
    error?: string;
  };
  internal: {
    total_checked: number;
    at_risk: number;
    issues: Array<{
      subscription_id: string;
      user_id?: string;
      issue_type: string;
      description: string;
    }>;
  };
  run_at: string;
  mode: string;
}

export default function PaymentSecurityTab() {
  const [isRunningAudit, setIsRunningAudit] = useState(false);
  const [auditMode, setAuditMode] = useState<'report' | 'cancel_all'>('report');
  const [auditResult, setAuditResult] = useState<AuditReport | null>(null);
  const queryClient = useQueryClient();

  // Fetch at-risk subscriptions (ghost tokens, missing payment methods, etc.)
  const { data: atRiskSubscriptions, isLoading: isLoadingAtRisk, refetch: refetchAtRisk } = useQuery({
    queryKey: ["at-risk-subscriptions"],
    queryFn: async () => {
      // Find subscriptions with auto_renew=true but no payment_method_id
      const { data, error } = await supabase
        .from("subscriptions_v2")
        .select(`
          id,
          user_id,
          status,
          auto_renew,
          payment_method_id,
          payment_token,
          next_charge_at,
          created_at,
          profiles:profiles!subscriptions_v2_profile_id_fkey(full_name, email)
        `)
        .in("status", ["active", "trial", "past_due"])
        .eq("auto_renew", true)
        .is("payment_method_id", null)
        .order("next_charge_at", { ascending: true })
        .limit(50);

      if (error) throw error;
      return data || [];
    },
  });

  // Fetch orphan tokens (payment_token set but no corresponding payment_method)
  const { data: orphanTokens, isLoading: isLoadingOrphans } = useQuery({
    queryKey: ["orphan-payment-tokens"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("subscriptions_v2")
        .select(`
          id,
          user_id,
          payment_token,
          status,
          profiles:profiles!subscriptions_v2_profile_id_fkey(full_name, email)
        `)
        .in("status", ["active", "trial"])
        .not("payment_token", "is", null)
        .is("payment_method_id", null)
        .limit(50);

      if (error) throw error;
      return data || [];
    },
  });

  // Run bePaid subscription audit
  const runAudit = async () => {
    setIsRunningAudit(true);
    try {
      const { data, error } = await supabase.functions.invoke("bepaid-subscription-audit", {
        body: { action: auditMode },
      });

      if (error) throw error;

      setAuditResult(data);
      toast.success(`Аудит завершён: найдено ${data.external?.total_found || 0} внешних подписок`);
      
      // Refetch at-risk data
      await refetchAtRisk();
      queryClient.invalidateQueries({ queryKey: ["orphan-payment-tokens"] });
    } catch (e: any) {
      console.error("Audit error:", e);
      toast.error("Ошибка аудита: " + (e.message || "Неизвестная ошибка"));
    } finally {
      setIsRunningAudit(false);
    }
  };

  // Fix a single at-risk subscription (disable auto_renew)
  const fixSubscription = useMutation({
    mutationFn: async (subscriptionId: string) => {
      const { error } = await supabase
        .from("subscriptions_v2")
        .update({
          auto_renew: false,
        })
        .eq("id", subscriptionId);

      if (error) throw error;

      // Create audit log
      await supabase.from("audit_logs").insert({
        action: "subscription.security_fix",
        actor_type: "admin",
        actor_user_id: (await supabase.auth.getUser()).data.user?.id,
        meta: {
          subscription_id: subscriptionId,
          fix_type: "disable_auto_renew_no_payment_method",
        },
      });
    },
    onSuccess: () => {
      toast.success("Подписка исправлена: автопродление отключено");
      refetchAtRisk();
    },
    onError: (e: any) => {
      toast.error("Ошибка: " + e.message);
    },
  });

  // Bulk fix all at-risk subscriptions
  const bulkFix = useMutation({
    mutationFn: async () => {
      if (!atRiskSubscriptions?.length) return;

      const ids = atRiskSubscriptions.map((s: any) => s.id);
      
      const { error } = await supabase
        .from("subscriptions_v2")
        .update({
          auto_renew: false,
        })
        .in("id", ids);

      if (error) throw error;

      // Create audit log
      await supabase.from("audit_logs").insert({
        action: "subscription.bulk_security_fix",
        actor_type: "admin",
        actor_user_id: (await supabase.auth.getUser()).data.user?.id,
        meta: {
          fixed_count: ids.length,
          fix_type: "disable_auto_renew_bulk",
        },
      });
    },
    onSuccess: () => {
      toast.success(`Исправлено ${atRiskSubscriptions?.length || 0} подписок`);
      refetchAtRisk();
    },
    onError: (e: any) => {
      toast.error("Ошибка: " + e.message);
    },
  });

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-gradient-to-br from-amber-500/10 to-orange-500/10 border-amber-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Подписки в зоне риска
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoadingAtRisk ? <Loader2 className="h-5 w-5 animate-spin" /> : atRiskSubscriptions?.length || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              auto_renew=true, но карта не привязана
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-red-500/10 to-rose-500/10 border-red-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <FileWarning className="h-4 w-4 text-red-500" />
              Orphan-токены
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {isLoadingOrphans ? <Loader2 className="h-5 w-5 animate-spin" /> : orphanTokens?.length || 0}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Токены без payment_method
            </p>
          </CardContent>
        </Card>

        <Card className="bg-gradient-to-br from-emerald-500/10 to-green-500/10 border-emerald-500/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium flex items-center gap-2">
              <Shield className="h-4 w-4 text-emerald-500" />
              Последний аудит
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="text-lg font-bold">
              {auditResult?.run_at && !isNaN(new Date(auditResult.run_at).getTime())
                ? format(new Date(auditResult.run_at), "dd.MM HH:mm", { locale: ru })
                : "—"}
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              {auditResult ? `${auditResult.mode} режим` : "Не запускался"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Audit Actions */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Server className="h-5 w-5" />
            Аудит bePaid (внешний контур)
          </CardTitle>
          <CardDescription>
            Проверка активных подписок на стороне платёжного шлюза
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <Button
                variant={auditMode === "report" ? "default" : "outline"}
                size="sm"
                onClick={() => setAuditMode("report")}
              >
                <ClipboardList className="h-4 w-4 mr-2" />
                Только отчёт
              </Button>
              <Button
                variant={auditMode === "cancel_all" ? "destructive" : "outline"}
                size="sm"
                onClick={() => setAuditMode("cancel_all")}
              >
                <Ban className="h-4 w-4 mr-2" />
                Отменить все
              </Button>
            </div>
            <Button onClick={runAudit} disabled={isRunningAudit}>
              {isRunningAudit ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4 mr-2" />
              )}
              Запустить аудит
            </Button>
          </div>

          {auditMode === "cancel_all" && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Внимание!</AlertTitle>
              <AlertDescription>
                Режим "Отменить все" отменит ВСЕ активные подписки на стороне bePaid.
                Это безопасная операция — токены карт сохранятся, но автоматические списания прекратятся.
              </AlertDescription>
            </Alert>
          )}

          {/* Audit Results */}
          {auditResult && (
            <div className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4">
                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">Внешний контур (bePaid)</CardTitle>
                  </CardHeader>
                  <CardContent className="py-2">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Найдено подписок:</span>
                        <Badge variant="outline">{auditResult.external?.total_found ?? 0}</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span>Отменено:</span>
                        <Badge variant={(auditResult.external?.cancelled ?? 0) > 0 ? "destructive" : "secondary"}>
                          {auditResult.external?.cancelled ?? 0}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">Внутренний контур</CardTitle>
                  </CardHeader>
                  <CardContent className="py-2">
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span>Проверено:</span>
                        <Badge variant="outline">{auditResult.internal?.total_checked ?? 0}</Badge>
                      </div>
                      <div className="flex justify-between">
                        <span>Проблем:</span>
                        <Badge variant={(auditResult.internal?.at_risk ?? 0) > 0 ? "destructive" : "secondary"}>
                          {auditResult.internal?.at_risk ?? 0}
                        </Badge>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>

              {/* External subscriptions list */}
              {(auditResult.external?.subscriptions?.length ?? 0) > 0 && (
                <div>
                  <h4 className="font-medium mb-2">Подписки bePaid</h4>
                  <ScrollArea className="h-48">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>ID</TableHead>
                          <TableHead>План</TableHead>
                          <TableHead>Статус</TableHead>
                          <TableHead>Сумма</TableHead>
                          <TableHead>Email</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {(auditResult.external?.subscriptions ?? []).map((sub) => (
                          <TableRow key={sub.id}>
                            <TableCell className="font-mono text-xs">{sub.id}</TableCell>
                            <TableCell>{sub.plan_title}</TableCell>
                            <TableCell>
                              <Badge variant={sub.status === "active" ? "default" : "secondary"}>
                                {sub.status}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              {sub.amount} {sub.currency}
                            </TableCell>
                            <TableCell className="text-muted-foreground">{sub.customer_email || "—"}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </ScrollArea>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* At-Risk Subscriptions Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <CreditCard className="h-5 w-5" />
                Подписки в зоне риска
              </CardTitle>
              <CardDescription>
                Автопродление включено, но карта не привязана или отозвана
              </CardDescription>
            </div>
            {(atRiskSubscriptions?.length || 0) > 0 && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => bulkFix.mutate()}
                disabled={bulkFix.isPending}
              >
                {bulkFix.isPending ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Ban className="h-4 w-4 mr-2" />
                )}
                Отключить все ({atRiskSubscriptions?.length})
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {isLoadingAtRisk ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          ) : (atRiskSubscriptions?.length || 0) === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <CheckCircle2 className="h-12 w-12 mx-auto mb-4 text-emerald-500" />
              <p>Все подписки в безопасности</p>
            </div>
          ) : (
            <ScrollArea className="h-64">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Контакт</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Следующее списание</TableHead>
                    <TableHead>Токен</TableHead>
                    <TableHead className="text-right">Действия</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {atRiskSubscriptions?.map((sub: any) => (
                    <TableRow key={sub.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{sub.profiles?.full_name || "—"}</p>
                          <p className="text-xs text-muted-foreground">{sub.profiles?.email}</p>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={sub.status === "active" ? "default" : "secondary"}>
                          {sub.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        {sub.next_charge_at && !isNaN(new Date(sub.next_charge_at).getTime())
                          ? format(new Date(sub.next_charge_at), "dd.MM.yyyy", { locale: ru })
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {sub.payment_token ? (
                          <Badge variant="outline" className="font-mono text-xs">
                            ...{sub.payment_token.slice(-8)}
                          </Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => fixSubscription.mutate(sub.id)}
                          disabled={fixSubscription.isPending}
                        >
                          <XCircle className="h-4 w-4 mr-1" />
                          Отключить
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollArea>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
