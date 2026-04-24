/**
 * DispatcherStatusPanel
 *
 * Read-only-by-default панель статуса диспетчера запланированных рассылок.
 *  - показывает enabled / production_approved
 *  - показывает последний tick cron job (через broadcast_runs)
 *  - показывает последний controlled_skip reason (через audit_logs)
 *
 * SAFETY:
 *  - production_approved НИКОГДА не включается автоматически.
 *  - Тумблер enabled требует одинарное подтверждение (включает только controlled-skip path,
 *    реальная отправка остаётся заблокирована до production_approved).
 *  - Тумблер production_approved требует двойное подтверждение через AlertDialog.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
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
} from "@/components/ui/alert-dialog";
import { Activity, Power, ShieldCheck, Clock, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { format } from "date-fns";
import { ru } from "date-fns/locale";

export function DispatcherStatusPanel() {
  const qc = useQueryClient();
  const [confirmProd, setConfirmProd] = useState(false);

  const { data: cfg, isLoading } = useQuery({
    queryKey: ["broadcast-dispatcher-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("broadcast_dispatcher_config")
        .select("id, enabled, production_approved, updated_at, updated_by")
        .eq("id", 1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    refetchInterval: 30_000,
  });

  // Last cron tick — из последней записи broadcast_runs
  const { data: lastRun } = useQuery({
    queryKey: ["broadcast-dispatcher-last-run"],
    queryFn: async () => {
      const { data } = await supabase
        .from("broadcast_runs")
        .select("created_at, dry_run, triggered_by, error, channel, template_id")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    refetchInterval: 30_000,
  });

  // Последний controlled-skip — из audit_logs
  const { data: lastSkip } = useQuery({
    queryKey: ["broadcast-dispatcher-last-skip"],
    queryFn: async () => {
      const { data } = await supabase
        .from("audit_logs")
        .select("created_at, action, meta")
        .in("action", ["broadcast_empty_audience_skip", "broadcast_dispatcher_run"])
        .eq("actor_type", "system")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    refetchInterval: 30_000,
  });

  const setEnabled = useMutation({
    mutationFn: async (next: boolean) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("broadcast_dispatcher_config")
        .update({ enabled: next, updated_at: new Date().toISOString(), updated_by: u.user?.id ?? null })
        .eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Статус диспетчера обновлён");
      qc.invalidateQueries({ queryKey: ["broadcast-dispatcher-config"] });
    },
    onError: (e) => toast.error("Ошибка: " + (e as Error).message),
  });

  const setProdApproved = useMutation({
    mutationFn: async (next: boolean) => {
      const { data: u } = await supabase.auth.getUser();
      const { error } = await supabase
        .from("broadcast_dispatcher_config")
        .update({ production_approved: next, updated_at: new Date().toISOString(), updated_by: u.user?.id ?? null })
        .eq("id", 1);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Production-approval изменён");
      qc.invalidateQueries({ queryKey: ["broadcast-dispatcher-config"] });
    },
    onError: (e) => toast.error("Ошибка: " + (e as Error).message),
  });

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Activity className="h-4 w-4" />
          Статус диспетчера
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Загрузка…</p>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {/* enabled */}
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <Power className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <Label className="text-sm font-medium">Диспетчер</Label>
                    <p className="text-xs text-muted-foreground">
                      Cron активен раз в минуту
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={cfg?.enabled ? "default" : "outline"}>
                    {cfg?.enabled ? "enabled" : "disabled"}
                  </Badge>
                  <Switch
                    checked={!!cfg?.enabled}
                    onCheckedChange={(v) => setEnabled.mutate(v)}
                    disabled={setEnabled.isPending}
                  />
                </div>
              </div>

              {/* production_approved */}
              <div className="flex items-center justify-between rounded-md border p-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <Label className="text-sm font-medium">Production approval</Label>
                    <p className="text-xs text-muted-foreground">
                      Разрешает реальные отправки. Без него — только dry-run.
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={cfg?.production_approved ? "default" : "outline"}>
                    {cfg?.production_approved ? "approved" : "not approved"}
                  </Badge>
                  <Button
                    size="sm"
                    variant={cfg?.production_approved ? "outline" : "default"}
                    onClick={() => {
                      if (cfg?.production_approved) {
                        // turn off — single confirm
                        if (window.confirm("Отозвать production approval?")) {
                          setProdApproved.mutate(false);
                        }
                      } else {
                        setConfirmProd(true);
                      }
                    }}
                    disabled={setProdApproved.isPending}
                  >
                    {cfg?.production_approved ? "Отозвать" : "Approve"}
                  </Button>
                </div>
              </div>
            </div>

            {/* Last tick + last skip */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
              <div className="rounded-md border p-3">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <Clock className="h-3 w-3" />
                  Последний запуск
                </div>
                {lastRun ? (
                  <div>
                    <div>
                      {format(new Date(lastRun.created_at), "dd MMM, HH:mm:ss", {
                        locale: ru,
                      })}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {lastRun.triggered_by} · {lastRun.channel}
                      {lastRun.dry_run ? " · dry-run" : ""}
                      {lastRun.error ? ` · ${lastRun.error}` : ""}
                    </div>
                  </div>
                ) : (
                  <span className="text-muted-foreground">нет данных</span>
                )}
              </div>

              <div className="rounded-md border p-3">
                <div className="flex items-center gap-2 text-muted-foreground text-xs mb-1">
                  <AlertCircle className="h-3 w-3" />
                  Последняя системная запись audit
                </div>
                {lastSkip ? (
                  <div>
                    <div className="text-xs">
                      {format(new Date(lastSkip.created_at), "dd MMM, HH:mm:ss", {
                        locale: ru,
                      })}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 truncate">
                      {lastSkip.action}
                    </div>
                  </div>
                ) : (
                  <span className="text-muted-foreground">нет данных</span>
                )}
              </div>
            </div>
          </>
        )}
      </CardContent>

      <AlertDialog open={confirmProd} onOpenChange={setConfirmProd}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Подтвердить production approval?</AlertDialogTitle>
            <AlertDialogDescription>
              После включения cron будет отправлять РЕАЛЬНЫЕ запланированные рассылки
              ученикам. Включайте только если все шаблоны проверены через dry-run.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setProdApproved.mutate(true);
                setConfirmProd(false);
              }}
            >
              Включить production
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
