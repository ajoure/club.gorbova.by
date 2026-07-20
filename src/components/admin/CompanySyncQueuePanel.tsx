import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock3, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { toast } from "sonner";

import { supabase } from "@/integrations/supabase/client";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";

type QueueStatus = Record<string, number>;

interface FailedJob {
  id: string;
  entity_id: string | null;
  status: "failed" | "dead_letter";
  attempts: number;
  updated_at: string;
  last_error: string;
}

interface SyncHealth {
  checked_at: string;
  queue: {
    total: number;
    by_status: QueueStatus;
    oldest_pending_next_run: string | null;
    stuck_running: number;
    dead_letter_count: number;
    failure_count: number;
  };
  recent_failures: FailedJob[];
}

type QueueAction = "retry" | "dismiss";

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("ru-BY", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

function actionLabel(action: QueueAction) {
  return action === "retry" ? "Повторить" : "Отклонить";
}

async function invokeQueueApi<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("company-sync-admin", { body });
  if (error) throw error;
  if (!data?.ok) throw new Error("Операция очереди не выполнена");
  return data as T;
}

export function CompanySyncQueuePanel({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const [action, setAction] = useState<{ type: QueueAction; job: FailedJob } | null>(null);
  const [reason, setReason] = useState("");

  const healthQuery = useQuery({
    queryKey: ["company-sync-health"],
    enabled: canManage,
    refetchInterval: 30_000,
    queryFn: async () => {
      const data = await invokeQueueApi<{ health: SyncHealth }>({ action: "health" });
      return data.health;
    },
  });

  const actionMutation = useMutation({
    mutationFn: async () => {
      if (!action) throw new Error("Не выбрана операция очереди");
      return invokeQueueApi({ action: action.type, jobId: action.job.id, reason });
    },
    onSuccess: () => {
      toast.success(action?.type === "retry" ? "Задача поставлена на повтор" : "Задача отклонена");
      setAction(null);
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["company-sync-health"] });
    },
    onError: () => toast.error("Не удалось выполнить операцию. Проверьте доступ и повторите позже."),
  });

  if (!canManage) return null;

  const health = healthQuery.data;
  const queue = health?.queue;
  const hasAttention = (queue?.dead_letter_count ?? 0) > 0 || (queue?.stuck_running ?? 0) > 0;

  return (
    <section className="rounded-xl border bg-card">
      <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-3">
          <div className={"rounded-lg p-2 " + (hasAttention ? "bg-destructive/10 text-destructive" : "bg-emerald-500/10 text-emerald-700")}>
            {hasAttention ? <AlertTriangle className="h-5 w-5" /> : <CheckCircle2 className="h-5 w-5" />}
          </div>
          <div>
            <h3 className="font-semibold">Синхронизация реквизитов</h3>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Очередь обновления компаний из billing-реквизитов. Данные очереди доступны только администраторам.
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={() => healthQuery.refetch()} disabled={healthQuery.isFetching}>
          <RefreshCw className={"mr-2 h-4 w-4 " + (healthQuery.isFetching ? "animate-spin" : "")} />
          Обновить
        </Button>
      </div>

      {healthQuery.isLoading && <div className="grid gap-3 p-4 sm:grid-cols-4">{Array.from({ length: 4 }).map((_, index) => <Skeleton key={index} className="h-20" />)}</div>}
      {healthQuery.isError && <p className="p-4 text-sm text-destructive">Состояние очереди сейчас недоступно. Очередь и доступы не менялись.</p>}
      {health && (
        <div className="space-y-4 p-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Всего задач" value={queue.total} />
            <Metric label="В ожидании" value={queue.by_status.queued ?? 0} />
            <Metric label="Зависшие" value={queue.stuck_running} danger={queue.stuck_running > 0} />
            <Metric label="Dead letter" value={queue.dead_letter_count} danger={queue.dead_letter_count > 0} />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5"><Clock3 className="h-4 w-4" />Старейшая pending: {formatDateTime(queue.oldest_pending_next_run)}</span>
            <span>Ошибок: {queue.failure_count}</span>
            <span>Проверено: {formatDateTime(health.checked_at)}</span>
          </div>

          <div className="overflow-hidden rounded-lg border">
            <div className="border-b bg-muted/40 px-3 py-2 text-sm font-medium">Последние ошибки</div>
            {health.recent_failures.length === 0 ? (
              <p className="px-3 py-5 text-sm text-muted-foreground">Ошибок и dead-letter задач нет.</p>
            ) : (
              <div className="divide-y">
                {health.recent_failures.map((job) => (
                  <div key={job.id} className="flex flex-col gap-3 p-3 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 space-y-1 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={job.status === "dead_letter" ? "destructive" : "secondary"}>{job.status}</Badge>
                        <span className="font-mono text-xs text-muted-foreground">{job.id}</span>
                      </div>
                      <p className="break-words text-muted-foreground">{job.last_error || "Ошибка без описания"}</p>
                      <p className="text-xs text-muted-foreground">Попыток: {job.attempts} · {formatDateTime(job.updated_at)}</p>
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="outline" onClick={() => { setReason(""); setAction({ type: "retry", job }); }}>
                        <RotateCcw className="mr-2 h-4 w-4" />Повторить
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => { setReason(""); setAction({ type: "dismiss", job }); }}>
                        <XCircle className="mr-2 h-4 w-4" />Отклонить
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      <Dialog open={!!action} onOpenChange={(open) => { if (!open && !actionMutation.isPending) setAction(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{action ? actionLabel(action.type) : "Операция очереди"}</DialogTitle>
            <DialogDescription>
              Укажите причину. Она попадёт в audit trail и журнал активности CRM.
            </DialogDescription>
          </DialogHeader>
          <label className="grid gap-2 py-2 text-sm font-medium">
            Причина
            <Input value={reason} onChange={(event) => setReason(event.target.value)} minLength={3} maxLength={500} autoFocus />
          </label>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAction(null)} disabled={actionMutation.isPending}>Отмена</Button>
            <Button onClick={() => actionMutation.mutate()} disabled={reason.trim().length < 3 || actionMutation.isPending}>
              {actionMutation.isPending && <RefreshCw className="mr-2 h-4 w-4 animate-spin" />}
              {action ? actionLabel(action.type) : "Подтвердить"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function Metric({ label, value, danger = false }: { label: string; value: number; danger?: boolean }) {
  return (
    <div className={"rounded-lg border p-3 " + (danger ? "border-destructive/30 bg-destructive/5" : "")}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={"mt-1 text-2xl font-semibold " + (danger ? "text-destructive" : "")}>{value}</div>
    </div>
  );
}
